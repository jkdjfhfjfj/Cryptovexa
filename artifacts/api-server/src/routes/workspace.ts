import { Router, type IRouter } from "express";
import { randomBytes } from "node:crypto";
import PDFDocument from "pdfkit";
import { RequestUploadBody } from "@workspace/api-zod";
import { q, uid, config, safeUser, session, requireUser, getRecords, assert, audit } from "../lib/platform";
import { ObjectStorageService } from "../lib/objectStorage";
import { marketRates } from "../lib/services";

export const workspace: IRouter=Router();

function addPrincipalAmounts(entries:any[],rentals:any[]){
  const byId=new Map(rentals.map(r=>[String(r.id),r]));
  return entries.map(entry=>{
    if(!["rental_principal_lock","rental_principal_release"].includes(String(entry.type)))return entry;
    const rental=byId.get(String(entry.ref_id));
    return {...entry,principal_amount:String(rental?.data?.principal_amount??"0")};
  });
}
const storage=new ObjectStorageService();
const isZero=(value:unknown)=>/^0(?:\.0*)?$/.test(String(value??"0"));
const assetView=(a:any)=>{
  const capital=String(a.data?.capital_required??"0");
  const configured=!isZero(capital)&&["minute","hour","day"].some(k=>!isZero(a[`${k}_rate`]));
  return {...a,...a.data,capital_required:capital,profit_model_configured:configured,
    rates:Object.fromEntries(["minute","hour","day"].map(k=>[k,configured&&!isZero(a[`${k}_rate`])?String(a[`${k}_rate`]):null]))};
};
const rentalView=(r:any)=>({...r,...r.data});
async function baseState(admin=false){
  const cfg=await config();
  const publicKeys=["site_name","short_name","brand_color","logo","favicon","app_icon","maintenance","registration_mode","twofa_mode","api_keys_enabled","deposit_terms","withdrawal_terms","billing","withdrawal_rules","referral_config","translations","email_verification_required","txid_required","captcha_enabled","captcha_site_key"];
  const settings=admin?{...cfg}:Object.fromEntries(publicKeys.map(k=>[k,cfg[k]]));
  if(!admin&&settings.withdrawal_rules)settings.withdrawal_rules={...settings.withdrawal_rules,blacklist:undefined};
  if(admin){
    settings.security={...settings.security,...Object.fromEntries(["twofa_mode","admin_twofa_mode","api_keys_enabled","registration_mode","email_verification_required","captcha_enabled","captcha_site_key","login_lockout_attempts"].map(k=>[k,cfg[k]])),deposit_txid_required:cfg.txid_required};
    settings.billing={...cfg.billing,early_stop_penalty_percent:cfg.billing.early_stop_penalty,grace_period_minutes:cfg.billing.grace_minutes};
     settings.withdrawal_rules={...cfg.withdrawal_rules,daily_limit_user:cfg.withdrawal_rules.daily_user_limit,daily_limit_global:cfg.withdrawal_rules.daily_global_limit,new_address_cooldown_hours:cfg.withdrawal_rules.cooldown_hours,new_address_cooldown_value:cfg.withdrawal_rules.cooldown_value??cfg.withdrawal_rules.cooldown_hours??24,new_address_cooldown_unit:cfg.withdrawal_rules.cooldown_unit??"hours",address_blacklist:cfg.withdrawal_rules.blacklist};
    settings.terms=cfg.terms??{en:{deposit:cfg.deposit_terms,withdrawal:cfg.withdrawal_terms}};
    settings.binance={...cfg.binance,force_manual:cfg.force_manual};
    for(const key of ["binance_api_key","binance_api_secret","smtp_password","captcha_secret","telegram_bot_token"]){
      const [exists]=await q("SELECT key FROM settings WHERE key=$1 AND is_secret=true",[key]);
      settings[`${key}_configured`]=Boolean(exists);
    }
    settings.binance={...settings.binance,api_key_configured:settings.binance_api_key_configured,api_secret_configured:settings.binance_api_secret_configured};
    settings.smtp={...settings.smtp,password_configured:settings.smtp_password_configured};
    settings.security={...settings.security,captcha_secret_configured:settings.captcha_secret_configured};
    settings.notifications={...settings.notifications,telegram_bot_token_configured:settings.telegram_bot_token_configured};
  }
  const prices=await marketRates();
  return {settings,assets:(await q(`SELECT * FROM assets ${admin?"":"WHERE status IN ('active','coming_soon')"} ORDER BY created_at`)).map(assetView),
    currencies:(await getRecords("currency")).map(c=>({...c,usd_price:prices[c.code]??null})),articles:(await getRecords("article")).filter(a=>admin||a.published),
    announcements:(await getRecords("announcement")).filter(a=>admin||(a.active&&(!a.start||new Date(a.start).getTime()<=Date.now())&&(!a.end||new Date(a.end).getTime()>Date.now()))),
    legalPages:(await getRecords("legal")).map(l=>({...l,body:String(l.body??"").replaceAll("{{site_name}}",String(cfg.site_name).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]!)))}))};
}
workspace.get("/v1/bootstrap",async(req,res):Promise<void>=>{
  let csrfToken=req.cookies?.vexa_csrf;
  if(!csrfToken){csrfToken=randomBytes(32).toString("hex");res.cookie("vexa_csrf",csrfToken,{httpOnly:true,secure:true,sameSite:"strict",path:"/",maxAge:86400000});}
  const [u,admin,state]=await Promise.all([session(req),session(req,"admin"),baseState()]);
  const [admins]=await q("SELECT count(*)::integer AS n FROM users WHERE role!='user'");
  res.set("Cache-Control","no-store").json({...state,user:safeUser(u),admin:safeUser(admin),adminUser:safeUser(admin),csrfToken,
    adminSetupAvailable:process.env.NODE_ENV!=="production"&&admins.n===0,
    serviceStatus:{deposits:state.currencies.some(c=>c.networks?.some((n:any)=>n.address)),withdrawals:"manual_review",email:undefined}});
});
workspace.get("/v1/workspace",async(req,res):Promise<void>=>{
  const u=await requireUser(req),cfg=await config();
  const [wallets,rentals,deposits,withdrawals,ledger,tickets,notifications,kycRequests,addressBook,sessions,apiKeys,referrals,commissions]=await Promise.all([
    q("SELECT currency,balance,locked FROM wallets WHERE user_id=$1 ORDER BY currency",[u.id]),
    q("SELECT r.*,a.title AS asset_title,a.images,a.type FROM rentals r JOIN assets a ON a.id=r.asset_id WHERE r.user_id=$1 ORDER BY r.start_at DESC",[u.id]),
    q("SELECT * FROM deposits WHERE user_id=$1 ORDER BY created_at DESC",[u.id]),
    q("SELECT id,currency,network,address,memo,amount,fee,status,txid,fail_reason,created_at FROM withdrawals WHERE user_id=$1 ORDER BY created_at DESC",[u.id]),
    q("SELECT * FROM ledger WHERE user_id=$1 ORDER BY created_at DESC LIMIT 500",[u.id]),
    getRecords("ticket",u.id),getRecords("notification",u.id),getRecords("kyc",u.id),getRecords("address",u.id),
    q("SELECT id,ip,device,created_at,expires_at,revoked FROM login_sessions WHERE user_id=$1 ORDER BY created_at DESC",[u.id]),
    getRecords("api_key",u.id),getRecords("referral",u.id),getRecords("commission",u.id),
  ]);
  const ledgerWithPrincipal=addPrincipalAmounts(ledger,rentals);
  res.set("Cache-Control","no-store").json({
    user:safeUser(u),settings:Object.fromEntries(["site_name","short_name","brand_color","twofa_mode","api_keys_enabled","billing","referral_config"].map(k=>[k,cfg[k]])),
    wallets,rentals:rentals.map(rentalView),deposits,withdrawals,ledger:ledgerWithPrincipal,
    tickets:tickets.map(t=>({...t,messages:t.messages.filter((m:any)=>!m.is_internal)})),
    notifications,kycRequests,addressBook,sessions:sessions.map(s=>({...s,current:s.id===u.session_id})),
    apiKeys:apiKeys.map(({key_hash,...a})=>a),referrals,commissions,
  });
});
workspace.get("/admin/workspace",async(req,res):Promise<void>=>{
  const u=await requireUser(req,"admin"),state=await baseState(true);
  if(state.settings.admin_twofa_mode==="required"&&!u.twofa_enabled){
    res.set("Cache-Control","no-store").json({user:safeUser(u),admin:safeUser(u),requiresTwofaSetup:true,settings:Object.fromEntries(["site_name","short_name","brand_color","logo","favicon","app_icon","admin_twofa_mode"].map(k=>[k,state.settings[k]]))});return;
  }
  const finance=["superadmin","finance"].includes(u.role),support=["superadmin","support"].includes(u.role);
  const [counts]=await q(`SELECT
    (SELECT count(*) FROM users WHERE role='user')::integer AS users,
    (SELECT count(*) FROM users WHERE created_at>=date_trunc('day',now()))::integer AS new_today,
    (SELECT count(*) FROM deposits WHERE status IN ('pending_review','needs_info'))::integer AS pending_deposits,
    (SELECT count(*) FROM withdrawals WHERE status NOT IN ('sent','rejected','failed'))::integer AS pending_withdrawals,
    (SELECT count(*) FROM withdrawals WHERE status='manual_fallback')::integer AS manual_fallback,
    (SELECT count(*) FROM rentals WHERE status='active')::integer AS active_rentals,
    (SELECT count(*) FROM platform_records WHERE kind='ticket' AND data->>'status' IN ('open','awaiting_user'))::integer AS open_tickets,
    (SELECT count(*) FROM platform_records WHERE kind='kyc' AND data->>'status'='submitted')::integer AS pending_kyc`);
  const revenue=await q("SELECT currency,(-sum(amount))::text AS total FROM ledger WHERE type IN ('rental_charge','rental_extension','rental_refund','rental_profit') GROUP BY currency");
  const series=await q(`SELECT to_char(d,'Mon DD') AS date,
    (SELECT COALESCE(sum(amount_credited),0)::text FROM deposits WHERE currency='USDT' AND status='approved' AND created_at::date=d::date) AS deposits,
    (SELECT COALESCE(sum(amount),0)::text FROM withdrawals WHERE currency='USDT' AND status='sent' AND created_at::date=d::date) AS withdrawals,
    (SELECT COALESCE(-sum(amount),0)::text FROM ledger WHERE currency='USDT' AND type IN ('rental_charge','rental_refund','rental_extension','rental_profit') AND created_at::date=d::date) AS revenue,
    (SELECT count(*)::integer FROM users WHERE created_at::date=d::date AND role='user') AS signups
    FROM generate_series(date_trunc('day',now())-interval '13 days',date_trunc('day',now()),interval '1 day') d`);
  const totals=await q("SELECT currency,sum(amount)::text AS total FROM ledger GROUP BY currency");
  const [lastReconciliation]=(await getRecords("reconciliation"));
  const users=(await q("SELECT * FROM users ORDER BY created_at DESC")).map(u=>({...safeUser(u),notes:u.data.notes??""}));
  const adminRentals=await q("SELECT r.*,a.title AS asset_title FROM rentals r JOIN assets a ON a.id=r.asset_id ORDER BY start_at DESC");
  const result:any={...state,user:safeUser(u),admin:safeUser(u),users,stats:{...counts,revenue:Object.fromEntries(revenue.map(r=>[r.currency,r.total])),series,daily:series,ledger_totals:totals,reconciliation:lastReconciliation??{},
    binance:{configured:Boolean(state.settings.binance_api_key_configured),connected:Boolean(state.settings.binance_status?.connected),balance:state.settings.binance_status?.balances??null}},roles:["superadmin","finance","support"],
    rentals:adminRentals.map(rentalView)};
  if(finance)Object.assign(result,{
    deposits:await q("SELECT d.*,u.email,u.username FROM deposits d JOIN users u ON u.id=d.user_id ORDER BY d.created_at DESC"),
    withdrawals:await q("SELECT w.*,u.email,u.username FROM withdrawals w JOIN users u ON u.id=w.user_id ORDER BY w.created_at DESC"),
    ledger:addPrincipalAmounts(await q("SELECT * FROM ledger ORDER BY created_at DESC LIMIT 1000"),adminRentals),wallets:await q("SELECT * FROM wallets"),
    reconciliations:await getRecords("reconciliation"),
  });
  if(support)Object.assign(result,{tickets:await getRecords("ticket"),kycRequests:await getRecords("kyc"),cannedReplies:await getRecords("canned_reply")});
  if(u.role==="superadmin")Object.assign(result,{
    emailLogs:(await q('SELECT id,"to",template,status,attempts,error,created_at FROM email_logs ORDER BY created_at DESC LIMIT 500')),
    auditLogs:await q("SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 1000"),
    emailTemplates:await getRecords("email_template"),referrals:await getRecords("referral"),commissions:await getRecords("commission"),
    sessions:await q("SELECT id,user_id,scope,ip,device,created_at,revoked FROM login_sessions ORDER BY created_at DESC LIMIT 500"),
    loginLogs:await q("SELECT id,user_id,scope,ip,device,created_at,revoked FROM login_sessions ORDER BY created_at DESC LIMIT 500"),
    workerLogs:await getRecords("worker_log"),errorLogs:await getRecords("error_log"),
    admins:users.filter(u=>u.role!=="user"),
  });
  else result.settings=Object.fromEntries(["site_name","short_name","brand_color","logo","favicon","app_icon"].map(k=>[k,state.settings[k]]));
  res.set("Cache-Control","no-store").json(result);
});
workspace.post("/v1/uploads",async(req,res):Promise<void>=>{
  const u=await requireUser(req,req.get("x-auth-scope")==="admin"?"admin":"user");
  const b=RequestUploadBody.parse(req.body);
  assert(b.size>0&&b.size<=10485760,"Files must be smaller than 10 MB");
  assert(["image/jpeg","image/png","image/webp","application/pdf"].includes(b.contentType),"Upload a PNG, JPEG, WebP or PDF");
  const uploadURL=await storage.getObjectEntityUploadURL({
    origin:`${req.protocol}://${req.get("host")}`,
    contentType:b.contentType,
    size:b.size,
  }),objectPath=storage.normalizeObjectEntityPath(uploadURL),id=uid();
  await q("INSERT INTO private_files(id,user_id,object_path,name,content_type,size) VALUES($1,$2,$3,$4,$5,$6)",[id,u.id,objectPath,b.name,b.contentType,b.size]);
  res.json({uploadURL,objectPath,id,url:`/api/v1/files/${id}`});
});
workspace.put("/v1/uploads/local/:id",async(req,res):Promise<void>=>{
  assert(storage.isLocalStorageEnabled(),"Local document storage is not configured",503);
  const id=Array.isArray(req.params.id)?req.params.id[0]:req.params.id;
  const expires=typeof req.query.expires==="string"?req.query.expires:"";
  const contentType=typeof req.query.contentType==="string"?req.query.contentType:"";
  const sizeValue=typeof req.query.size==="string"?req.query.size:"";
  const signature=typeof req.query.signature==="string"?req.query.signature:"";
  const size=/^\d+$/.test(sizeValue)?Number(sizeValue):NaN;
  const result=await storage.storeLocalUpload({
    objectId:id,expires,contentType,size,signature,
    requestContentType:req.get("content-type"),stream:req,
  });
  if(result!=="stored"){
    const status=result==="unavailable"?503:result==="exists"?409:
      result==="forbidden"||result==="expired"?403:400;
    assert(false,result==="exists"?"This upload link has already been used":
      result==="unavailable"?"Local document storage is not configured":
      "This upload link is invalid, expired, or does not match the file",status);
    return;
  }
  res.status(200).json({ok:true});
});
workspace.get("/v1/files/{*path}",async(req,res):Promise<void>=>{
  const p=req.params.path;const raw=Array.isArray(p)?p.join("/"):String(p);
  const [f]=await q("SELECT * FROM private_files WHERE id=$1 OR object_path=$1",[raw.startsWith("objects/")?`/${raw}`:raw]);
  assert(f,"File not found",404);
  const cfg=await config(),publicUrl=`/api/v1/files/${f.id}`;
  const publicBrand=["logo","favicon","app_icon"].some(k=>[publicUrl,f.object_path,`/api/v1/files${f.object_path}`].includes(cfg[k]));
  const publicAsset=(await q("SELECT id FROM assets WHERE images @> $1::jsonb OR images @> $2::jsonb LIMIT 1",[JSON.stringify([f.object_path]),JSON.stringify([publicUrl])])).length>0;
  const u=await session(req,"admin")??await session(req);
  const financeProof=u?.role==="finance"&&(await q("SELECT id FROM deposits WHERE proof_image=$1 LIMIT 1",[f.object_path])).length>0;
  assert(publicBrand||publicAsset||(u&&(u.id===f.user_id||["superadmin","support"].includes(u.role)||financeProof)),"You cannot access this document",403);
  if(u&&u.id!==f.user_id&&!publicBrand)await audit(u,"private_document_view",f.id,req);
  const file=await storage.getObjectEntityFile(f.object_path);
  const [metadata]=await file.getMetadata();
  assert(metadata.contentType===f.content_type&&Number(metadata.size)<=10485760,"Upload metadata mismatch",400);
  res.set("Content-Type",f.content_type).set("X-Content-Type-Options","nosniff").set("Cache-Control","private, no-store");
  if(f.content_type==="application/pdf")res.set("Content-Disposition",`attachment; filename="${String(f.name).replace(/[^a-zA-Z0-9._-]/g,"_")}"`);
  file.createReadStream().pipe(res);
});
workspace.get("/v1/rentals/:id/invoice",async(req,res):Promise<void>=>{
  const u=await requireUser(req);
  const [r]=await q("SELECT r.*,a.title FROM rentals r JOIN assets a ON a.id=r.asset_id WHERE r.id=$1 AND r.user_id=$2",[req.params.id,u.id]);
  assert(r,"Rental not found",404);
  const cfg=await config();
  res.set("Content-Type","application/pdf").set("Content-Disposition",`attachment; filename="rental-${r.id}.pdf"`).set("Cache-Control","no-store");
  const doc=new PDFDocument({margin:50});doc.pipe(res);
  doc.fillColor("#0B1A2E").fontSize(26).text(cfg.site_name).moveDown().fontSize(18).text("Rental invoice").moveDown();
  doc.fontSize(11).text(`Invoice: ${r.id}`).text(`Customer: ${u.email}`).text(`Asset: ${r.title}`).text(`Billing: ${r.billing_mode}`).text(`Units: ${r.units}`)
    .text(`Started: ${new Date(r.start_at).toISOString()}`).text(`Ends: ${new Date(r.end_at).toISOString()}`).text(`Status: ${r.status}`).moveDown();
  if(r.data?.rental_model_version===2){
    doc.fontSize(12).text(`Principal locked: ${r.data.principal_amount} ${r.data.currency}`)
      .text(`Estimated term profit: ${r.data.expected_profit} ${r.data.currency}`)
      .text(`Profit paid: ${r.data.profit_paid??r.total_cost} ${r.data.currency}`)
      .text(`Settlement: ${r.data.settlement??(r.status==="active"?"Pending maturity":"Pending")}`);
  }else doc.fontSize(16).text(`Total charged: ${r.total_cost} ${r.data.currency}`);
  doc.end();
});
const csv=(rows:any[])=>{
  if(!rows.length)return "No records\n";
  const keys=Object.keys(rows[0]).filter(k=>!["data","password_hash","twofa_secret","token_hash"].includes(k));
  const cell=(v:any)=>`"${String(typeof v==="object"?JSON.stringify(v):v??"").replace(/"/g,'""').replace(/^([=+\-@\t\r])/,"'$1")}"`;
  return [keys.map(cell).join(","),...rows.map(r=>keys.map(k=>cell(r[k])).join(","))].join("\n");
};
workspace.get(["/v1/export/:kind","/admin/export/:kind"],async(req,res):Promise<void>=>{
  const admin=req.path.startsWith("/admin"),u=await requireUser(req,admin?"admin":"user"),kind=String(req.params.kind);
  assert(["ledger","rentals","deposits","withdrawals","users","audit_logs","email_logs","revenue","commissions","referrals"].includes(kind),"Unknown export",404);
  assert(admin||!["users","audit_logs","email_logs"].includes(kind),"Not allowed",403);
  if(admin)assert(u.role==="superadmin"||(["ledger","rentals","deposits","withdrawals","revenue"].includes(kind)&&u.role==="finance"),"Not allowed",403);
  const rows=kind==="revenue"?await q(`SELECT currency,type,sum(amount)::text AS total FROM ledger WHERE type IN ('rental_charge','rental_refund','rental_extension','rental_profit') ${admin?"":"AND user_id=$1"} GROUP BY currency,type`,admin?[]:[u.id]):
    kind==="commissions"||kind==="referrals"?await getRecords(kind==="commissions"?"commission":"referral",admin?undefined:u.id):
    await q(`SELECT * FROM ${kind} ${admin?"":"WHERE user_id=$1"} LIMIT 10000`,admin?[]:[u.id]);
  if(admin)await audit(u,"csv_export",kind,req);
  res.set("Content-Type","text/csv").set("Content-Disposition",`attachment; filename="${kind}.csv"`).send(csv(rows));
});
workspace.get("/v1/manifest.webmanifest",async(_req,res):Promise<void>=>{
  const cfg=await config();
  const icon=typeof cfg.app_icon==="string"&&cfg.app_icon.startsWith("/objects/")?`/api/v1/files${cfg.app_icon}`:cfg.app_icon;
  res.type("application/manifest+json").json({name:cfg.site_name,short_name:cfg.short_name,start_url:"/",scope:"/",display:"standalone",
    background_color:"#0B1A2E",theme_color:cfg.brand_color,icons:cfg.app_icon&&cfg.app_icon!=="/brand-icon.svg"?
      [{src:icon,sizes:"192x192 512x512",purpose:"any maskable"}]:
      [{src:"/icon-192.png",sizes:"192x192",type:"image/png",purpose:"any"},{src:"/icon-512.png",sizes:"512x512",type:"image/png",purpose:"any"},{src:"/icon-maskable-512.png",sizes:"512x512",type:"image/png",purpose:"maskable"}]});
});
workspace.get("/admin/backup",async(req,res):Promise<void>=>{
  const u=await requireUser(req,"admin");
  assert(u.role==="superadmin","Only superadmins may export platform data",403);
  const output:Record<string,any>={exported_at:new Date().toISOString(),format:"vexa-data-export",note:"Credentials and password hashes are intentionally excluded. Private file bytes are not included; back up the configured file storage separately."};
  for(const table of ["users","wallets","ledger","assets","rentals","deposits","withdrawals","platform_records","audit_logs"]){
    const rows=await q(`SELECT * FROM ${table}`);
    output[table]=rows.map(({password_hash,twofa_secret,...r})=>{
      if(table==="platform_records"&&["api_key","request"].includes(r.kind))return {...r,data:{redacted:true}};
      return r;
    });
  }
  output.settings=await config();
  await audit(u,"platform_data_export",null,req);
  res.set("Content-Type","application/json").set("Content-Disposition",`attachment; filename="vexa-data-${new Date().toISOString().slice(0,10)}.json"`).send(JSON.stringify(output,null,2));
});
