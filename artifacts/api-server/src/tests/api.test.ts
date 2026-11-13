import test from "node:test";
import strict from "node:assert/strict";
import { randomBytes } from "node:crypto";
import type { Server } from "node:http";
import argon2 from "argon2";
import { pool } from "@workspace/db";
import app from "../app";
import { hash, q, uid, transaction, move, record } from "../lib/platform";
import { ObjectStorageService } from "../lib/objectStorage";
import { ADMIN_SECURITY_ALERT_EMAIL } from "../lib/admin-access";
import { withdrawalCooldownMinutes, cooldownLabel } from "../routes/user-actions";

strict.notEqual(process.env.NODE_ENV,"production","API fixtures must never run against a production runtime");

test("Withdrawal-address cooldown accepts administrator minutes, hours, and legacy hour settings",()=>{
  strict.equal(withdrawalCooldownMinutes({cooldown_value:15,cooldown_unit:"minutes"}),15);
  strict.equal(withdrawalCooldownMinutes({cooldown_value:2,cooldown_unit:"hours"}),120);
  strict.equal(withdrawalCooldownMinutes({cooldown_hours:24}),1440);
  strict.equal(cooldownLabel(15),"15 minutes");
  strict.equal(cooldownLabel(120),"2 hours");
});

// Full HTTP/SQL boundary checks, without external transfers or global settings changes.
const people=new Map<string,{id:string;email:string;cookie:string;csrf:string}>();
let server:Server,origin="",kycId="",fileId="",assetId="",rentalId="",profitAssetId="",announcementId="";
const adminAccessEventIds:string[]=[];
test.before(async()=>{
  await transaction(async c=>{
    for(const role of ["user","superadmin","finance","support"]){
      const id=uid(),email=`api-regression-${id}@test.invalid`,raw=randomBytes(32).toString("hex"),csrf=randomBytes(32).toString("hex"),scope=role==="user"?"user":"admin";
      await q("INSERT INTO users(id,email,username,password_hash,role,referral_code) VALUES($1,$2,'Isolated API regression','unused',$3,$4)",[id,email,role,uid()],c);
      await q("INSERT INTO login_sessions(id,user_id,token_hash,scope,expires_at) VALUES($1,$2,$3,$4,now()+interval '1 hour')",[uid(),id,hash(`${scope}:${raw}`),scope],c);
      people.set(role,{id,email,csrf,cookie:`vexa_${scope}=${raw}; vexa_csrf=${csrf}`});
    }
    const user=people.get("user")!;
    fileId=uid();kycId=uid();
    const objectPath=`/objects/api-regression-${uid()}`;
    await q("INSERT INTO private_files(id,user_id,object_path,name,content_type,size) VALUES($1,$2,$3,'TEST ONLY.png','image/png',24)",[fileId,user.id,objectPath],c);
    await q("INSERT INTO platform_records(id,kind,user_id,data) VALUES($1,'kyc',$2,$3::jsonb)",[kycId,user.id,JSON.stringify({status:"submitted",required_items:["selfie"],block_withdrawals:true,documents:[{id:"selfie",type:"selfie",objectPath,status:"submitted"}]})],c);
    await q("UPDATE users SET kyc_status='submitted',withdrawals_blocked=true WHERE id=$1",[user.id],c);
    assetId=uid();rentalId=uid();
    await q("INSERT INTO assets(id,type,title,description,location,category,total_units,available_units,data) VALUES($1,'machine','Isolated API fixture','Test only','Test only','Test only',1,0,$2::jsonb)",
      [assetId,JSON.stringify({capital_required:"10",profit_rate_basis:"hour",profit_rate_value:"1"})],c);
    await q("INSERT INTO rentals(id,user_id,asset_id,billing_mode,rate_snapshot,end_at,billed_until,data) VALUES($1,$2,$3,'hour','0',now()+interval '1 hour',now()+interval '1 hour',$4::jsonb)",[rentalId,user.id,assetId,JSON.stringify({currency:"USDT",asset_title:"Isolated API fixture",billing:{proration:false}})],c);
  });
  await new Promise<void>((resolve,reject)=>{server=app.listen(0,"127.0.0.1",()=>resolve());server.once("error",reject);});
  const address=server.address();strict.ok(address&&typeof address!=="string");
  origin=`http://127.0.0.1:${address.port}`;
});
async function request(role:string,path:string,body?:any,csrf=true){
  const p=people.get(role)!;
  return fetch(`${origin}/api${path}`,{method:body?"POST":"GET",headers:{cookie:p.cookie,...(body?{"Content-Type":"application/json",...(csrf?{"x-csrf-token":p.csrf}:{})}:{})},...(body?{body:JSON.stringify({request_id:uid(),...body})}:{})});
}
test("Reset mail cannot be sent with an attacker-controlled Origin",async()=>{
  const p=people.get("user")!;
  const r=await fetch(`${origin}/api/v1/auth/forgot-password`,{method:"POST",headers:{"Content-Type":"application/json",origin:"https://attacker.invalid",cookie:p.cookie,"x-csrf-token":p.csrf},body:JSON.stringify({email:p.email})});
  strict.equal(r.status,403);
  const body:any=await r.json();strict.doesNotMatch(body.error,/Security token expired/);
  const [{n}]=await q("SELECT count(*)::integer AS n FROM email_logs WHERE \"to\"=$1 AND template='password_reset'",[people.get("user")!.email]);strict.equal(n,0);
});
test("Signed-in user workspace queries actual schema and excludes authentication material",async()=>{
  const r=await request("user","/v1/workspace");
  strict.equal(r.status,200);
  const body:any=await r.json();strict.equal(body.user.id,people.get("user")!.id);
  strict.ok(Array.isArray(body.rentals)&&Array.isArray(body.sessions));
  strict.doesNotMatch(JSON.stringify(body),/"(?:password_hash|twofa_secret|token_hash|key_hash)"\s*:/);
});
test("Every staff workspace reads successfully against the actual database",async()=>{
  for(const role of ["superadmin","finance","support"]){
    const r=await request(role,"/admin/workspace");strict.equal(r.status,200,`${role} workspace`);
    const body:any=await r.json();strict.equal(body.admin.role,role);
    strict.doesNotMatch(JSON.stringify(body),/"(?:password_hash|twofa_secret|token_hash|key_hash)"\s*:/);
    if(role==="superadmin")strict.ok(Array.isArray(body.adminAccessEvents));
    else strict.equal(body.adminAccessEvents,undefined);
    if(role==="support"){strict.equal(body.withdrawals,undefined);strict.equal(body.wallets,undefined);}
    if(role==="finance"){strict.equal(body.kycRequests,undefined);strict.equal(body.emailTemplates,undefined);}
  }
});
test("Admin access and login events capture consented location and notify the fixed security mailbox",async()=>{
  const page=await request("superadmin","/admin/auth/access",{});
  strict.equal(page.status,200);
  const pageBody:any=await page.json();
  adminAccessEventIds.push(pageBody.event_id);

  const location=await request("superadmin","/admin/auth/location",{geo:{latitude:40.7128,longitude:-74.006,accuracy:14}});
  strict.equal(location.status,200);
  const locationBody:any=await location.json();
  adminAccessEventIds.push(locationBody.event_id);
  const [savedLocation]=await q("SELECT data FROM platform_records WHERE id=$1 AND kind='admin_access'",[locationBody.event_id]);
  strict.equal(savedLocation.data.geo.latitude,40.7128);
  strict.equal(savedLocation.data.geo.accuracy,14);
  strict.ok(savedLocation.data.ip);

  const person=people.get("superadmin")!,password="TestOnlyAdminPassword!123";
  await q("UPDATE users SET password_hash=$1 WHERE id=$2",[await argon2.hash(password),person.id]);
  const failed=await request("superadmin","/admin/auth/login",{email:person.email,password:"incorrect-password"});
  strict.equal(failed.status,401);
  const success=await request("superadmin","/admin/auth/login",{email:person.email,password});
  strict.equal(success.status,200);

  const savedEvents=await q("SELECT id,data FROM platform_records WHERE kind='admin_access' AND user_id=$1 ORDER BY created_at",[person.id]);
  const failedEvent=savedEvents.find((row:any)=>row.data.event==="login_failed");
  const successEvent=savedEvents.find((row:any)=>row.data.event==="login_success");
  strict.ok(failedEvent);
  strict.ok(successEvent);
  strict.equal(failedEvent.data.email,`${person.email[0]}***${person.email.slice(person.email.lastIndexOf("@"))}`);
  strict.equal(successEvent.data.email,person.email);
  adminAccessEventIds.push(...savedEvents.map((row:any)=>row.id));

  const superadmin=await request("superadmin","/admin/workspace");
  const superState:any=await superadmin.json();
  strict.ok(superState.adminAccessEvents.some((row:any)=>row.id===pageBody.event_id));
  strict.ok(superState.adminAccessEvents.some((row:any)=>row.id===successEvent.id));

  const alerts=await q(`SELECT data FROM email_logs WHERE "to"=$1 AND template='admin_security_alert'
    AND data->>'event_id'=ANY($2::text[])`,[ADMIN_SECURITY_ALERT_EMAIL,adminAccessEventIds]);
  strict.ok(alerts.some((row:any)=>row.data.event==="page_access"));
  strict.ok(alerts.some((row:any)=>row.data.event==="location_shared"));
  strict.ok(alerts.some((row:any)=>row.data.event==="login_success"));
});
test("User cookies cannot authorize staff data or actions",async()=>{
  strict.equal((await request("user","/admin/workspace")).status,401);
  strict.equal((await request("user","/admin/actions/balance-adjust",{user_id:people.get("user")!.id,currency:"USDT",amount:"1",reason:"Unauthorized test"})).status,401);
});
test("Support and finance cannot cross their action permissions",async()=>{
  strict.equal((await request("support","/admin/actions/deposit-approve",{id:uid()})).status,403);
  strict.equal((await request("finance","/admin/actions/settings-save",{section:"general",values:{site_name:"Never applied"}})).status,403);
  strict.equal((await request("finance","/admin/actions/kyc-review",{id:kycId,status:"approved"})).status,403);
});
test("Admin asset editor converts one profit rate into minute, hour, and day rates",async()=>{
  profitAssetId=uid();
  const body={id:profitAssetId,type:"machine",title:"Isolated rate conversion",description:"Test only",location:"Test only",category:"Test only",status:"active",
    total_units:1,available_units:1,currency:"USDT",capital_required:"100",profit_rate_basis:"hour",profit_rate_value:"12",
    rates:{minute:"0.2",hour:"12",day:"288"},min_duration:1,max_duration:43200,images:[],specs:{},discount_rules:[],scheduled_changes:[]};
  strict.equal((await request("superadmin","/admin/actions/asset-save",body)).status,200);
  let [saved]=await q("SELECT minute_rate,hour_rate,day_rate,data FROM assets WHERE id=$1",[profitAssetId]);
  strict.equal(saved.minute_rate,"0.200000000000000000");strict.equal(saved.hour_rate,"12.000000000000000000");strict.equal(saved.day_rate,"288.000000000000000000");
  strict.equal(saved.data.capital_required,"100");
  strict.equal((await request("superadmin","/admin/actions/asset-save",{...body,profit_rate_basis:"day",profit_rate_value:"144",rates:{minute:"0.1",hour:"6",day:"144"}})).status,200);
  [saved]=await q("SELECT minute_rate,hour_rate,day_rate FROM assets WHERE id=$1",[profitAssetId]);
  strict.equal(saved.minute_rate,"0.100000000000000000");strict.equal(saved.hour_rate,"6.000000000000000000");strict.equal(saved.day_rate,"144.000000000000000000");
});
test("Rich announcements are sanitized before saving",async()=>{
  const r=await request("superadmin","/admin/actions/announcement-save",{title:"Safe announcement",body:"<p>Read <strong>this</strong></p><script>alert(1)</script>",type:"info",active:true});
  strict.equal(r.status,200);const response:any=await r.json();announcementId=response.id;
  const [saved]=await q("SELECT data FROM platform_records WHERE id=$1 AND kind='announcement'",[announcementId]);
  strict.match(saved.data.body,/<strong>this<\/strong>/);strict.doesNotMatch(saved.data.body,/<script|alert\(1\)/i);
});
test("CSRF denial happens before mutation",async()=>{
  strict.equal((await request("superadmin","/admin/actions/user-update",{id:people.get("user")!.id,status:"suspended"},false)).status,403);
  const [u]=await q("SELECT status FROM users WHERE id=$1",[people.get("user")!.id]);strict.equal(u.status,"active");
});
test("Finance cannot fetch identity documents",async()=>{
  strict.equal((await request("finance",`/v1/files/${fileId}`)).status,403);
});
test("Document review preserves the original file and unblocks only after overall approval",async()=>{
  let r=await request("support","/admin/actions/kyc-document-review",{id:kycId,type:"selfie",status:"approved",objectPath:"/objects/forged"});
  strict.equal(r.status,200);
  const [before]=await q("SELECT data FROM platform_records WHERE id=$1",[kycId]);
  strict.match(before.data.documents[0].objectPath,/^\/objects\/api-regression-/);
  strict.equal(before.data.status,"submitted");
  r=await request("support","/admin/actions/kyc-review",{id:kycId,status:"approved"});
  strict.equal(r.status,200);
  const [u]=await q("SELECT kyc_status,withdrawals_blocked FROM users WHERE id=$1",[people.get("user")!.id]);
  strict.equal(u.kyc_status,"approved");strict.equal(u.withdrawals_blocked,false);
});
test("Financial actions reject missing idempotency identifiers",async()=>{
  const p=people.get("user")!;
  const r=await fetch(`${origin}/api/v1/actions/rent`,{method:"POST",headers:{cookie:p.cookie,"x-csrf-token":p.csrf,"Content-Type":"application/json"},body:JSON.stringify({asset_id:uid(),billing_mode:"hour",duration:1,units:1})});
  strict.equal(r.status,400);const body:any=await r.json();strict.match(body.error,/request ID/);
});
test("Staff force-stop requires a reason and records it in the audit trail",async()=>{
  strict.equal((await request("superadmin","/admin/actions/rental-stop",{id:rentalId})).status,400);
  const reason="Isolated regression test cleanup";
  strict.equal((await request("superadmin","/admin/actions/rental-stop",{id:rentalId,reason})).status,200);
  const [r]=await q("SELECT status FROM rentals WHERE id=$1",[rentalId]);strict.equal(r.status,"cancelled");
  const [log]=await q("SELECT meta FROM audit_logs WHERE actor_id=$1 AND action='rental-stop' AND entity_id=$2",[people.get("superadmin")!.id,rentalId]);strict.equal(log.meta.reason,reason);
});
test("Concurrent HTTP rental request replay returns the same response and capital lock",async()=>{
  const user=people.get("user")!,requestId=uid();
  await transaction(async c=>{
    await move(c,user.id,"USDT","20","test_funding","api-fixture",`api-fund:${user.id}`);
    await q("UPDATE assets SET hour_rate='1' WHERE id=$1",[assetId],c);
  });
  const denied=await request("user","/v1/actions/rent",{asset_id:assetId,billing_mode:"hour",duration:1,units:1});
  strict.equal(denied.status,400);
  const body={asset_id:assetId,billing_mode:"hour",duration:1,units:1,request_id:requestId,rental_terms_accepted:true};
  const [a,b]=await Promise.all([request("user","/v1/actions/rent",body),request("user","/v1/actions/rent",body)]);
  strict.equal(a.status,200);strict.equal(b.status,200);
  const first:any=await a.json(),second:any=await b.json();
  strict.deepEqual(second,first);strict.equal(first.success,true);strict.equal(typeof first.id,"string");
  const [{n}]=await q("SELECT count(*)::integer AS n FROM ledger WHERE user_id=$1 AND type='rental_principal_lock'",[user.id]);strict.equal(n,1);
   const history:any=await (await request("user","/v1/workspace")).json();
   const lockEntry=history.ledger.find((entry:any)=>entry.ref_id===first.id&&entry.type==="rental_principal_lock");
   strict.ok(lockEntry);strict.equal(Number(lockEntry.amount),0);strict.equal(lockEntry.principal_amount,"10");
  const [wallet]=await q("SELECT balance,locked FROM wallets WHERE user_id=$1 AND currency='USDT'",[user.id]);
  strict.equal(wallet.balance,"20.000000000000000000");strict.equal(wallet.locked,"10.000000000000000000");
});
test("Manual-only withdrawal fixtures reject submission and release their reserve exactly once",async()=>{
  const user=people.get("user")!,id=uid(),requestId=uid();
  await transaction(async c=>{
    await move(c,user.id,"USDT","20","test_funding","withdrawal-fixture",`withdrawal-fund:${user.id}`, "0");
    await move(c,user.id,"USDT","0","withdrawal_lock",id,`api-lock:${id}`,"11");
    await q(`INSERT INTO withdrawals(id,user_id,currency,network,address,amount,fee,status,data) VALUES($1,$2,'USDT','BEP20','TEST ONLY','10','1','manual_fallback',$3::jsonb)`,[id,user.id,JSON.stringify({total:"11",test_only:true})],c);
  });
  strict.equal((await request("superadmin","/admin/actions/withdrawal-approve",{id})).status,403);
  const body={id,reason:"Isolated fixture rejection",request_id:requestId};
  strict.equal((await request("superadmin","/admin/actions/withdrawal-reject",body)).status,200);
  strict.equal((await request("superadmin","/admin/actions/withdrawal-reject",body)).status,200);
  const [wallet]=await q("SELECT balance,locked FROM wallets WHERE user_id=$1 AND currency='USDT'",[user.id]);
  strict.equal(wallet.balance,"40.000000000000000000");strict.equal(wallet.locked,"10.000000000000000000");
  const [{n}]=await q("SELECT count(*)::integer AS n FROM ledger WHERE ref_id=$1 AND type='withdrawal_rejected'",[id]);strict.equal(n,1);
});
test("Finance can manually pay or block one pending referral commission with audit and replay protection",async()=>{
  const user=people.get("user")!,paidId=uid(),blockedId=uid(),sourceId=uid(),payRequestId=uid(),blockRequestId=uid();
  await transaction(async c=>{
    await record("commission",{source_user_id:uid(),source_id:`manual-pay-${sourceId}`,source_value:"25",source_type:"first_deposit",amount:"2.500000000000000000",currency:"USDT",level:1,status:"pending"},user.id,paidId,c);
    await record("commission",{source_user_id:uid(),source_id:`manual-block-${sourceId}`,source_value:"25",source_type:"first_deposit",amount:"2.500000000000000000",currency:"USDT",level:1,status:"pending"},user.id,blockedId,c);
  });
  const pay={id:paidId,decision:"pay",reason:"Verified the referral record",request_id:payRequestId};
  const [first,replay]=await Promise.all([request("finance","/admin/actions/commission-review",pay),request("finance","/admin/actions/commission-review",pay)]);
  strict.equal(first.status,200);strict.equal(replay.status,200);strict.deepEqual(await replay.json(),await first.json());
  strict.equal((await request("finance","/admin/actions/commission-review",{id:blockedId,decision:"block",reason:"Confirmed duplicate account",request_id:blockRequestId})).status,200);
  const [paid]=await q("SELECT data FROM platform_records WHERE id=$1",[paidId]);strict.equal(paid.data.status,"paid");strict.equal(paid.data.manual_override,"pay");
  const [blocked]=await q("SELECT data FROM platform_records WHERE id=$1",[blockedId]);strict.equal(blocked.data.status,"blocked");strict.equal(blocked.data.manual_override,"block");
  const [{n}]=await q("SELECT count(*)::integer AS n FROM ledger WHERE idempotency_key=$1",[`${"referral"}:${paid.data.source_id}:1`]);strict.equal(n,1);
  const [wallet]=await q("SELECT balance,locked FROM wallets WHERE user_id=$1 AND currency='USDT'",[user.id]);
  strict.equal(wallet.balance,"42.500000000000000000");strict.equal(wallet.locked,"10.000000000000000000");
  const [{valid}]=await q("SELECT balance=(SELECT sum(amount) FROM ledger WHERE user_id=$1 AND currency='USDT') AS valid FROM wallets WHERE user_id=$1 AND currency='USDT'",[user.id]);strict.equal(valid,true);
});
test("A real private upload is owner/reviewer-only until attached as a finance proof",async()=>{
  const bytes=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZ9kAAAAASUVORK5CYII=","base64");
  const r=await request("user","/v1/uploads",{name:"isolated-api-regression.png",contentType:"image/png",size:bytes.length});
  strict.equal(r.status,200);
  const upload=await r.json() as {uploadURL:string;objectPath:string;id:string};
  try{
    const put=await fetch(upload.uploadURL,{method:"PUT",headers:{"Content-Type":"image/png"},body:new Uint8Array(bytes)});
    strict.equal(put.status,200);
    const replay=await fetch(upload.uploadURL,{method:"PUT",headers:{"Content-Type":"image/png"},body:new Uint8Array(bytes)});
    strict.equal(replay.status,409);
    const own=await request("user",`/v1/files/${upload.id}`);strict.equal(own.status,200);
    strict.equal(own.headers.get("content-type"),"image/png");
    strict.deepEqual(Buffer.from(await own.arrayBuffer()),bytes);
    strict.equal((await request("finance",`/v1/files/${upload.id}`)).status,403);
    const review=await request("support",`/v1/files/${upload.id}`);strict.equal(review.status,200);await review.arrayBuffer();
    const [{n}]=await q("SELECT count(*)::integer AS n FROM audit_logs WHERE actor_id=$1 AND action='private_document_view' AND entity_id=$2",[people.get("support")!.id,upload.id]);
    strict.equal(n,1);
    await q(`INSERT INTO deposits(id,user_id,currency,network,address_used,amount_claimed,txid,proof_image) VALUES($1,$2,'USDT','BEP20','TEST ONLY - NO FUNDS','0.00000001',$3,$4)`,[uid(),people.get("user")!.id,uid(),upload.objectPath]);
    const proofReview=await request("finance",`/v1/files/${upload.id}`);strict.equal(proofReview.status,200);await proofReview.arrayBuffer();
  }finally{
    const file=await new ObjectStorageService().getObjectEntityFile(upload.objectPath);
    await file.delete({ignoreNotFound:true});
  }
});
test.after(async()=>{
  if(server)await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));
  const ids=[...people.values()].map(p=>p.id),emails=[...people.values()].map(p=>p.email);
  try{
    await transaction(async c=>{
      await q("DELETE FROM rentals WHERE user_id=ANY($1::text[])",[ids],c);
      await q("DELETE FROM deposits WHERE user_id=ANY($1::text[])",[ids],c);
      await q("DELETE FROM withdrawals WHERE user_id=ANY($1::text[])",[ids],c);
      await q("DELETE FROM assets WHERE id=$1",[assetId],c);
      if(profitAssetId)await q("DELETE FROM assets WHERE id=$1",[profitAssetId],c);
      if(announcementId)await q("DELETE FROM platform_records WHERE id=$1 AND kind='announcement'",[announcementId],c);
      await q("DELETE FROM ledger WHERE user_id=ANY($1::text[])",[ids],c);
      await q("DELETE FROM private_files WHERE user_id=ANY($1::text[])",[ids],c);
      await q("DELETE FROM platform_records WHERE user_id=ANY($1::text[])",[ids],c);
      if(adminAccessEventIds.length){
        await q("DELETE FROM email_logs WHERE data->>'event_id'=ANY($1::text[])",[adminAccessEventIds],c);
        await q("DELETE FROM platform_records WHERE id=ANY($1::text[]) AND kind='admin_access'",[adminAccessEventIds],c);
      }
      await q('DELETE FROM email_logs WHERE "to"=ANY($1::text[])',[emails],c);
      await q("DELETE FROM audit_logs WHERE actor_id=ANY($1::text[])",[ids],c);
      await q("DELETE FROM security_tokens WHERE user_id=ANY($1::text[])",[ids],c);
      await q("DELETE FROM login_sessions WHERE user_id=ANY($1::text[])",[ids],c);
      await q("DELETE FROM wallets WHERE user_id=ANY($1::text[])",[ids],c);
      await q("DELETE FROM users WHERE id=ANY($1::text[])",[ids],c);
    });
  }finally{await pool.end();}
});
