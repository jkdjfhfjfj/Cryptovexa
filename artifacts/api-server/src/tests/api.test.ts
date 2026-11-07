import test from "node:test";
import strict from "node:assert/strict";
import { randomBytes } from "node:crypto";
import type { Server } from "node:http";
import { pool } from "@workspace/db";
import app from "../app";
import { hash, q, uid, transaction, move } from "../lib/platform";
import { ObjectStorageService } from "../lib/objectStorage";

strict.notEqual(process.env.NODE_ENV,"production","API fixtures must never run against a production runtime");

// Full HTTP/SQL boundary checks, without external transfers or global settings changes.
const people=new Map<string,{id:string;email:string;cookie:string;csrf:string}>();
let server:Server,origin="",kycId="",fileId="",assetId="",rentalId="";
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
    await q("INSERT INTO assets(id,type,title,description,location,category,total_units,available_units) VALUES($1,'machine','Isolated API fixture','Test only','Test only','Test only',1,0)",[assetId],c);
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
    if(role==="support"){strict.equal(body.withdrawals,undefined);strict.equal(body.wallets,undefined);}
    if(role==="finance"){strict.equal(body.kycRequests,undefined);strict.equal(body.emailTemplates,undefined);}
  }
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
test("Concurrent HTTP rental request replay returns the same real response and debit",async()=>{
  const user=people.get("user")!,requestId=uid();
  await transaction(async c=>{
    await move(c,user.id,"USDT","20","test_funding","api-fixture",`api-fund:${user.id}`);
    await q("UPDATE assets SET hour_rate='1' WHERE id=$1",[assetId],c);
  });
  const denied=await request("user","/v1/actions/rent",{asset_id:assetId,billing_mode:"hour",duration:1,units:1});
  strict.equal(denied.status,400);
  const body={asset_id:assetId,billing_mode:"hour",duration:1,units:1,request_id:requestId,virtual_terms_accepted:true};
  const [a,b]=await Promise.all([request("user","/v1/actions/rent",body),request("user","/v1/actions/rent",body)]);
  strict.equal(a.status,200);strict.equal(b.status,200);
  const first:any=await a.json(),second:any=await b.json();
  strict.deepEqual(second,first);strict.equal(first.success,true);strict.equal(typeof first.id,"string");
  const [{n}]=await q("SELECT count(*)::integer AS n FROM ledger WHERE user_id=$1 AND type='rental_charge'",[user.id]);strict.equal(n,1);
  const [wallet]=await q("SELECT balance FROM wallets WHERE user_id=$1 AND currency='USDT'",[user.id]);strict.equal(wallet.balance,"19.000000000000000000");
});
test("Manual-only withdrawal fixtures reject submission and release their reserve exactly once",async()=>{
  const user=people.get("user")!,id=uid(),requestId=uid();
  await transaction(async c=>{
    await move(c,user.id,"USDT","0","withdrawal_lock",id,`api-lock:${id}`,"11");
    await q(`INSERT INTO withdrawals(id,user_id,currency,network,address,amount,fee,status,data) VALUES($1,$2,'USDT','BEP20','TEST ONLY','10','1','manual_fallback',$3::jsonb)`,[id,user.id,JSON.stringify({total:"11",test_only:true})],c);
  });
  strict.equal((await request("superadmin","/admin/actions/withdrawal-approve",{id})).status,403);
  const body={id,reason:"Isolated fixture rejection",request_id:requestId};
  strict.equal((await request("superadmin","/admin/actions/withdrawal-reject",body)).status,200);
  strict.equal((await request("superadmin","/admin/actions/withdrawal-reject",body)).status,200);
  const [wallet]=await q("SELECT balance,locked FROM wallets WHERE user_id=$1 AND currency='USDT'",[user.id]);
  strict.equal(wallet.balance,"19.000000000000000000");strict.equal(wallet.locked,"0.000000000000000000");
  const [{n}]=await q("SELECT count(*)::integer AS n FROM ledger WHERE ref_id=$1 AND type='withdrawal_rejected'",[id]);strict.equal(n,1);
});
test("A real private upload is owner/reviewer-only until attached as a finance proof",async()=>{
  const bytes=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZ9kAAAAASUVORK5CYII=","base64");
  const r=await request("user","/v1/uploads",{name:"isolated-api-regression.png",contentType:"image/png",size:bytes.length});
  strict.equal(r.status,200);
  const upload=await r.json() as {uploadURL:string;objectPath:string;id:string};
  try{
    const put=await fetch(upload.uploadURL,{method:"PUT",headers:{"Content-Type":"image/png"},body:new Uint8Array(bytes)});
    strict.equal(put.status,200);
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
      await q("DELETE FROM ledger WHERE user_id=ANY($1::text[])",[ids],c);
      await q("DELETE FROM private_files WHERE user_id=ANY($1::text[])",[ids],c);
      await q("DELETE FROM platform_records WHERE user_id=ANY($1::text[])",[ids],c);
      await q('DELETE FROM email_logs WHERE "to"=ANY($1::text[])',[emails],c);
      await q("DELETE FROM audit_logs WHERE actor_id=ANY($1::text[])",[ids],c);
      await q("DELETE FROM security_tokens WHERE user_id=ANY($1::text[])",[ids],c);
      await q("DELETE FROM login_sessions WHERE user_id=ANY($1::text[])",[ids],c);
      await q("DELETE FROM wallets WHERE user_id=ANY($1::text[])",[ids],c);
      await q("DELETE FROM users WHERE id=ANY($1::text[])",[ids],c);
    });
  }finally{await pool.end();}
});
