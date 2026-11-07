import nodemailer from "nodemailer";
import { createHash, createHmac } from "node:crypto";
import { q, config, transaction, move, event, record, uid, assert, getRecords, defaultEmailTemplateBody } from "./platform";
import { billRentals } from "./rentals";
import { logger } from "./logger";

const escapeHtml=(s:unknown)=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]!));
let priceCache:Record<string,string>={USDT:"1",USDC:"1"},priceExpires=0;
export async function marketRates(){
  if(Date.now()<priceExpires)return priceCache;
  priceExpires=Date.now()+60000;
  try{
    const response=await fetch('https://api.binance.com/api/v3/ticker/price?symbols=%5B%22BTCUSDT%22,%22ETHUSDT%22,%22BNBUSDT%22%5D',{signal:AbortSignal.timeout(3000)});
    if(response.ok){
      const data:any=await response.json();
      if(Array.isArray(data))for(const r of data)if(typeof r.price==="string")priceCache[r.symbol.replace(/USDT$/,"")]=r.price;
    }
  }catch{/* USD estimates remain unavailable rather than invented. */}
  return priceCache;
}
export async function binance(path:string,params:Record<string,string>={},method="GET"){
  const cfg=await config(true);
  assert(cfg.binance_api_key&&cfg.binance_api_secret,"Binance credentials are not configured",503);
  const data=new URLSearchParams({...params,timestamp:String(Date.now()),recvWindow:"10000"});
  const signature=createHmac("sha256",cfg.binance_api_secret).update(data.toString()).digest("hex");
  const r=await fetch(`https://api.binance.com${path}?${data}&signature=${signature}`,{method,headers:{"X-MBX-APIKEY":cfg.binance_api_key},signal:AbortSignal.timeout(15000)});
  const body:any=await r.json();
  assert(r.ok,`Binance rejected the request (${r.status}). Review IP restrictions, permissions and account status.`,503);
  return body;
}
const binanceNetworkAliases:Record<string,string>={TRC20:"TRX",ERC20:"ETH",BEP20:"BSC",BEP2:"BNB",BITCOIN:"BTC",BTC:"BTC",ETH:"ETH",BSC:"BSC",TRX:"TRX"};
const binanceAddressInFlight=new Map<string,Promise<any|null>>();
export function binanceNetworkCode(network:any):string{
  const explicit=String(network?.binance_network??"").trim();
  if(explicit)return explicit;
  const name=String(network?.name??"").trim();
  return binanceNetworkAliases[name.toUpperCase().replace(/[\s_-]/g,"")]??name;
}
const accountFingerprint=(apiKey:string)=>createHash("sha256").update(apiKey).digest("hex").slice(0,24);
const depositAddressRecordId=(currency:string,network:string,fingerprint:string)=>`binance-deposit-address:${currency.toUpperCase()}:${encodeURIComponent(network)}:${fingerprint}`;

export async function getCachedBinanceDepositAddress(currency:string,network:any,c:any=undefined){
  const cfg=await config(true,c);
  const networkCode=binanceNetworkCode(network);
  if(!networkCode)return null;
  const hasCredentials=!!(cfg.binance_api_key&&cfg.binance_api_secret);
  const fingerprint=hasCredentials?accountFingerprint(cfg.binance_api_key):"";
  let row:any;
  if(hasCredentials){
    const id=depositAddressRecordId(currency,networkCode,fingerprint);
    [row]=await q("SELECT data FROM platform_records WHERE id=$1 AND kind='binance_deposit_address'",[id],c);
  }
  if(!row){
    [row]=await q("SELECT data FROM platform_records WHERE kind='binance_deposit_address' AND data->>'currency'=$1 AND data->>'app_network'=$2 ORDER BY created_at DESC LIMIT 1",[currency,String(network.name??"")],c);
  }
  if(!row?.data?.address)return null;
  try{
    if(network.address_regex&&!new RegExp(String(network.address_regex)).test(String(row.data.address)))return null;
  }catch{return null;}
  if(network.memo_required&&!String(row.data.tag??""))return null;
  return {...row.data,current_account:hasCredentials&&row.data.account_fingerprint===fingerprint,current_network:row.data.network===networkCode};
}

/** Fetches/caches the pooled Binance address for one enabled app currency/network. */
export async function getBinanceDepositAddress(currency:string,network:any){
  const cfg=await config(true);
  if(!cfg.binance_api_key||!cfg.binance_api_secret)return null;
  const networkCode=binanceNetworkCode(network);
  if(!networkCode)return null;
  const fingerprint=accountFingerprint(cfg.binance_api_key);
  const id=depositAddressRecordId(currency,networkCode,fingerprint);
  const [cached]=await q("SELECT data FROM platform_records WHERE id=$1 AND kind='binance_deposit_address'",[id]);
  if(cached?.data?.address&&cached.data.account_fingerprint===fingerprint&&Date.now()-Date.parse(String(cached.data.fetched_at||""))<86400000){
    try{
      if((!network.address_regex||new RegExp(String(network.address_regex)).test(String(cached.data.address)))&&(!network.memo_required||!!String(cached.data.tag??"")))return cached.data;
    }catch{/* Invalid new network rules require a fresh, reviewed configuration. */}
  }
  const existing=binanceAddressInFlight.get(id);
  if(existing)return existing;
  const request=(async()=>{
    try{
      const response:any=await binance("/sapi/v1/capital/deposit/address",{coin:currency,network:networkCode});
      const address=String(response?.address??"").trim();
      const tag=String(response?.tag??response?.addressTag??"").trim();
      assert(address.length>=10,"Binance did not return a usable deposit address",503);
      if(network.address_regex)assert(new RegExp(String(network.address_regex)).test(address),"Binance returned an address that does not match this network's configured format",503);
      if(network.memo_required)assert(!!tag,"Binance did not return the required memo or tag for this network",503);
      const value={address,tag,currency:currency.toUpperCase(),app_network:String(network.name??""),network:networkCode,account_fingerprint:fingerprint,fetched_at:new Date().toISOString()};
      await q("INSERT INTO platform_records(id,kind,user_id,data) VALUES($1,'binance_deposit_address',NULL,$2::jsonb) ON CONFLICT(id) DO UPDATE SET data=EXCLUDED.data",[id,JSON.stringify(value)]);
      return value;
    }catch{
      logger.warn({currency,network:networkCode},"Binance deposit address unavailable; manual fallback may be used");
      return null;
    }
  })();
  binanceAddressInFlight.set(id,request);
  try{return await request;}finally{if(binanceAddressInFlight.get(id)===request)binanceAddressInFlight.delete(id);}
}

function canonicalDecimal(value:unknown):string|null{
  const raw=String(value??"").trim();
  if(!/^\d+(?:\.\d+)?$/.test(raw))return null;
  const [whole,decimal=""]=raw.split(".");
  const normalizedWhole=whole.replace(/^0+(?=\d)/,"");
  const normalizedDecimal=decimal.replace(/0+$/,"");
  return normalizedDecimal?`${normalizedWhole}.${normalizedDecimal}`:normalizedWhole;
}
const normalizedTxid=(value:unknown)=>String(value??"").trim().toLowerCase().replace(/^0x/,"");

/** Exact matching only; anything missing, ambiguous, pending, or mismatched stays in review. */
export function findVerifiedBinanceDeposit(deposit:any,history:any[]):any|null{
  const candidates=history.filter((item:any)=>
    String(item?.coin??"").toUpperCase()===String(deposit.currency??"").toUpperCase()&&
    normalizedTxid(item?.txId)===normalizedTxid(deposit.txid));
  if(candidates.length!==1)return null;
  const item=candidates[0],data=deposit.data??{};
  const expectedTag=String(data.memo_used??"").trim();
  if(Number(item.status)!==1||
    String(item.network??"").toUpperCase()!==String(data.binance_network??"").toUpperCase()||
    String(item.address??"")!==String(deposit.address_used??"")||
    canonicalDecimal(item.amount)!==canonicalDecimal(deposit.amount_claimed)||
    String(item.addressTag??item.tag??"").trim()!==expectedTag)return null;
  return item;
}
export async function creditVerifiedBinanceDeposit(id:string,fingerprint:string,match:any,readCurrentConfig:(c:any)=>Promise<Record<string,any>>=(c)=>config(true,c)){
  return transaction(async c=>{
    await q("SELECT key FROM settings WHERE key=ANY($1::text[]) FOR SHARE",[["binance","binance_api_key","binance_api_secret"]],c);
    const currentConfig=await readCurrentConfig(c);
    if(currentConfig.binance?.auto_deposits===false||!currentConfig.binance_api_key||!currentConfig.binance_api_secret||accountFingerprint(currentConfig.binance_api_key)!==fingerprint){
      return {alreadyCredited:false,deposit:null};
    }
    const [locked]=await q("SELECT * FROM deposits WHERE id=$1 FOR UPDATE",[id],c);
    if(!locked||locked.status!=="pending_review"||locked.data?.binance_auto_eligible!==true||locked.data?.binance_account_fingerprint!==fingerprint){
      return {alreadyCredited:locked?.status==="approved",deposit:locked??null};
    }
    const {approveDeposit}=await import("./deposits");
    const result=await approveDeposit(c,id,null,String(match.amount),"Automatically verified by Binance deposit history");
    if(!result.alreadyCredited){
      await q("UPDATE deposits SET data=data||$1::jsonb WHERE id=$2",[
        JSON.stringify({binance_verified_at:new Date().toISOString(),binance_verified_status:Number(match.status),binance_verified_amount:String(match.amount),binance_verified_network:String(match.network)}),id,
      ],c);
    }
    return result;
  });
}
export async function sendEmail(to:string,template:string,data:any) {
  const cfg=await config(true),smtp=cfg.smtp;
  assert(smtp?.host&&smtp?.from_email,"SMTP is not configured",503);
  const templates=await getRecords("email_template"),tmpl=templates.find(t=>t.key===template&&t.language===(data.language??"en"))??templates.find(t=>t.key===template&&t.language==="en");
  const rendered=renderEmailMessage(template,tmpl,data,cfg);
  const transport=nodemailer.createTransport({host:smtp.host,port:Number(smtp.port??587),secure:Number(smtp.port??587)===465,requireTLS:Number(smtp.port??587)!==465,
    ...(smtp.username?{auth:{user:smtp.username,pass:cfg.smtp_password}}:{}),connectionTimeout:15000,socketTimeout:20000});
  await transport.sendMail({
    from:{name:smtp.from_name||cfg.site_name,address:smtp.from_email},to,subject:rendered.subject,
    ...(rendered.replyTo?{replyTo:rendered.replyTo}:{}),html:rendered.html,text:rendered.text,
  });
}
function mailUrl(value:unknown,allowLocal=false):URL|null{
  try{
    const parsed=new URL(String(value??""));
    const local=allowLocal&&parsed.protocol==="http:"&&["localhost","127.0.0.1","::1"].includes(parsed.hostname);
    if((parsed.protocol!=="https:"&&!local)||parsed.username||parsed.password)return null;
    return parsed;
  }catch{return null;}
}
function mailOrigin(value:unknown,allowLocal=false):string{
  const parsed=mailUrl(value,allowLocal);
  return parsed&&parsed.pathname==="/"&&!parsed.search&&!parsed.hash?parsed.origin:"";
}
function plainText(html:string):string{
  return html.replace(/<style[\s\S]*?<\/style>/gi,"").replace(/<br\s*\/?>/gi,"\n").replace(/<\/(p|h[1-6]|tr|li|td|div)>/gi,"\n")
    .replace(/<[^>]*>/g," ").replace(/&nbsp;/gi," ").replace(/&amp;/gi,"&").replace(/&lt;/gi,"<")
    .replace(/&gt;/gi,">").replace(/&quot;/gi,'"').replace(/&#39;|&#x27;/gi,"'").replace(/[ \t]+\n/g,"\n").replace(/\n{3,}/g,"\n\n").trim();
}
export function renderEmailMessage(templateKey:string,tmpl:any,data:any,cfg:any){
  const smtp=cfg.smtp??{},development=process.env.NODE_ENV!=="production";
  const appOrigin=mailOrigin(smtp.public_url) || mailOrigin(data.origin,development);
  const linkOrigin=mailOrigin(data.origin,development) || mailOrigin(smtp.public_url);
  let link="";
  if(data.token&&data.path&&linkOrigin){
    const path=String(data.path);
    if(path.startsWith("/")&&!path.startsWith("//")){
      const url=new URL(path,linkOrigin);url.searchParams.set("token",String(data.token));link=url.toString();
    }
  }else if(data.link){
    const candidate=mailUrl(data.link,development);
    if(candidate&&linkOrigin&&candidate.origin===linkOrigin)link=candidate.toString();
  }
  const supportEmail=/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(cfg.support_email??""))
    ?String(cfg.support_email):/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(smtp.from_email??""))?String(smtp.from_email):"";
  const emailLogo=mailUrl(smtp.email_logo_url) || mailUrl(/^https:\/\//i.test(String(cfg.logo??""))?cfg.logo:"") || null;
  const relativeLogo="/icon-192.png";
  const logoUrl=emailLogo?.toString() || (appOrigin?new URL(relativeLogo,appOrigin).toString():"");
  const siteName=String(cfg.site_name??"MyCryptoVexa");
  const siteUrl=appOrigin;
  const values:Record<string,unknown>={...data,site_name:siteName,username:data.username||"there",logo_url:logoUrl,support_email:supportEmail,site_url:siteUrl,year:new Date().getFullYear(),link};
  const replace=(source:string,escape:boolean)=>source.replace(/\{\{\s*([\w]+)\s*\}\}/g,(_,key)=>{const value=String(values[key]??"");return escape?escapeHtml(value):value.replace(/[\r\n]+/g," ");});
  const subject=replace(String(tmpl?.subject??"{{title}} — {{site_name}}"),false).replace(/[\r\n]+/g," ").trim();
  const body=replace(String(tmpl?.body_html??defaultEmailTemplateBody(templateKey)),true);
  const color=/^#[\da-f]{6}$/i.test(String(cfg.brand_color??""))?String(cfg.brand_color):"#14b8a6";
  const logo=logoUrl
    ?`<img src="${escapeHtml(logoUrl)}" width="44" height="44" alt="${escapeHtml(siteName)} logo" style="display:block;width:44px;height:44px;border:0;border-radius:12px">`
    :`<span style="display:inline-block;width:44px;height:44px;line-height:44px;text-align:center;background:${color};color:#06101d;font-weight:700;font-size:15px;border-radius:12px">MCV</span>`;
  const ctaLabel=({verify_email:"Verify email",password_reset:"Reset password",withdrawal_confirmation:"Confirm withdrawal"} as Record<string,string>)[templateKey]??"Open your account";
  const button=link?`<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:26px 0 8px"><tr><td bgcolor="${color}" style="border-radius:8px"><a href="${escapeHtml(link)}" style="display:inline-block;padding:13px 22px;color:#06101d;text-decoration:none;font-weight:700;font-family:Arial,sans-serif">${ctaLabel}</a></td></tr></table><p style="font-size:12px;color:#64748b;line-height:1.6">If the button does not work, copy and paste this address into your browser:<br><a href="${escapeHtml(link)}" style="color:#0f766e;word-break:break-all">${escapeHtml(link)}</a></p>`:"";
  const helpLine=supportEmail
    ?`Contact <a href="mailto:${escapeHtml(supportEmail)}" style="color:#0f766e;text-decoration:underline">${escapeHtml(supportEmail)}</a>.`
    :"Reply to this email for help.";
  const website=siteUrl?`<a href="${escapeHtml(siteUrl)}" style="color:#0f766e;text-decoration:underline">${escapeHtml(siteUrl)}</a>`:"";
  const html=`<!doctype html><html lang="${escapeHtml(String(data.language??"en"))}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(subject)}</title></head><body style="margin:0;padding:0;background:#f1f5f9;color:#152238;font-family:Arial,Helvetica,sans-serif"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f1f5f9" style="background:#f1f5f9;padding:28px 12px"><tr><td align="center"><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:#ffffff;border:1px solid #dbe4ee;border-radius:16px;overflow:hidden"><tr><td bgcolor="#0b1a2e" style="padding:22px 28px;background:#0b1a2e"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td valign="middle">${logo}</td><td valign="middle" style="padding-left:12px;color:#ffffff;font-size:19px;font-weight:700">${escapeHtml(siteName)}</td></tr></table></td></tr><tr><td style="padding:32px 28px 30px;color:#152238;font-size:15px;line-height:1.7">${body}${button}</td></tr><tr><td bgcolor="#f8fafc" style="padding:20px 28px;background:#f8fafc;border-top:1px solid #e2e8f0;color:#64748b;font-size:12px;line-height:1.7"><p style="margin:0 0 8px;color:#334155;font-weight:700">Need help?</p><p style="margin:0 0 12px">${helpLine}</p>${website?`<p style="margin:0 0 12px">${website}</p>`:""}<p style="margin:0">© ${new Date().getFullYear()} ${escapeHtml(siteName)}. This is an operational message from ${escapeHtml(siteName)}. If you did not request this email, contact support.</p></td></tr></table></td></tr></table></body></html>`;
  const text=plainText(html);
  return {subject,html,text,replyTo:supportEmail||String(smtp.from_email??"")};
}
/** Claim and deliver one item; injectable delivery/client allow rollback-isolated retry tests. */
export async function deliverQueuedEmail(id:string,deliver=sendEmail,c?:any,now=new Date()) {
  const [e]=await q(`UPDATE email_logs SET status='sending',attempts=attempts+1,
    data=data||jsonb_build_object('delivery_started_at',$2::text)
    WHERE id=$1 AND status IN ('queued','failed') AND attempts<5
    AND (data->>'next_attempt_at' IS NULL OR (data->>'next_attempt_at')::timestamptz<=$2::timestamptz) RETURNING *`,[id,now.toISOString()],c);
  if(!e)return false;
  try{
    await deliver(e.to,e.template,e.data);
    await q("UPDATE email_logs SET status='sent',error=NULL,data=(data-'next_attempt_at')||jsonb_build_object('sent_at',$2::text) WHERE id=$1",[id,now.toISOString()],c);
  }catch{
    await q("UPDATE email_logs SET status='failed',error='SMTP delivery failed. Verify credentials and sender configuration.',data=data||$2::jsonb WHERE id=$1",
      [id,JSON.stringify({next_attempt_at:new Date(now.getTime()+Math.min(3600000,60000*2**e.attempts)).toISOString()})],c);
  }
  return true;
}
async function emailWorker(){
  const cfg=await config(true);
  if(!cfg.smtp?.host)return;
  await q("UPDATE email_logs SET status='failed' WHERE status='sending' AND (data->>'delivery_started_at')::timestamptz<now()-interval '5 minutes'");
  const ids=await q("SELECT id FROM email_logs WHERE status IN ('queued','failed') AND attempts<5 AND (data->>'next_attempt_at' IS NULL OR (data->>'next_attempt_at')::timestamptz<=now()) ORDER BY created_at LIMIT 10");
  for(const {id} of ids)await deliverQueuedEmail(id);
}
async function expireWithdrawalConfirmations(){
  const ids=await q("SELECT id FROM withdrawals WHERE status='pending_confirm' AND created_at<now()-interval '1 hour' LIMIT 100");
  for(const {id} of ids)await transaction(async c=>{
    const [w]=await q("SELECT * FROM withdrawals WHERE id=$1 AND status='pending_confirm' FOR UPDATE",[id],c);if(!w)return;
    await move(c,w.user_id,w.currency,"0","withdrawal_unlocked",id,`expired:${id}`,`-${w.data.total}`);
    await q("UPDATE withdrawals SET status='rejected',fail_reason='Confirmation expired; reserved funds released' WHERE id=$1",[id],c);
  });
}
async function withdrawalWorker(){
  const cfg=await config(true);
  await q(`UPDATE withdrawals SET status='manual_fallback',fail_reason='Processing was interrupted. Check Binance history before sending, refunding or retrying.',
    data=data||'{"outcome_unknown":true}'::jsonb WHERE status='processing' AND binance_id IS NULL
    AND COALESCE((data->>'processing_started_at')::timestamptz,created_at)<now()-interval '5 minutes'`);
  // Claim each row once. An ambiguous network outcome is NOT automatically retried.
  const list=await q("SELECT id FROM withdrawals WHERE status='queued' AND COALESCE((data->>'test_only')::boolean,false)=false LIMIT 20");
  for(const {id} of list){
    const [w]=await q("UPDATE withdrawals SET status='processing',data=data||jsonb_build_object('processing_started_at',now()) WHERE id=$1 AND status='queued' RETURNING *",[id]);if(!w)continue;
    const [{overThreshold}]=await q('SELECT $1::numeric>$2::numeric AS "overThreshold"',[w.data.usd_value??"0",cfg.withdrawal_rules.auto_threshold??"1000"]);
    const [owner]=await q("SELECT * FROM users WHERE id=$1",[w.user_id]);
    const [currency]=await q("SELECT data FROM platform_records WHERE id=$1 AND kind='currency'",[`currency-${w.currency}`]);
    const network=currency?.data?.networks?.find((n:any)=>n.name===w.network&&n.enabled);
    const policyHold=!owner||owner.status!=="active"||owner.withdrawals_blocked||(cfg.withdrawal_rules.kyc_required&&owner.kyc_status!=="approved")||(cfg.withdrawal_rules.blacklist??[]).includes(w.address)||!currency?.data?.enabled||!network;
    if(policyHold||cfg.force_manual||!cfg.binance_api_key||!cfg.binance_api_secret||overThreshold){
      await q("UPDATE withdrawals SET status='manual_fallback',fail_reason=$1 WHERE id=$2",[policyHold?"Current account, KYC, network or blacklist policy blocks this withdrawal":cfg.force_manual?"Manual withdrawal processing is enabled":overThreshold?"Withdrawal exceeds the automatic processing threshold":"Binance credentials not configured",id]);
      await event(w.user_id,"Withdrawal awaiting manual processing","The finance team will send your withdrawal and provide a transaction ID.","withdrawal_manual");
      continue;
    }
    try{
      const networkMap:Record<string,string>={BEP20:"BSC",TRC20:"TRX",ERC20:"ETH",Bitcoin:"BTC"};
      const result=await binance("/sapi/v1/capital/withdraw/apply",{coin:w.currency,network:networkMap[w.network]??w.network,address:w.address,amount:w.amount,withdrawOrderId:w.id,...(w.memo?{addressTag:w.memo}:{})},"POST");
      assert(result.id,"Binance did not return a withdrawal ID");
      await q("UPDATE withdrawals SET binance_id=$1,fail_reason=NULL WHERE id=$2",[result.id,id]);
    }catch{
      await q("UPDATE withdrawals SET status='manual_fallback',fail_reason='Automatic request failed or its outcome is unknown. Check Binance history before sending, refunding or retrying.',data=data||'{\"outcome_unknown\":true}'::jsonb WHERE id=$1",[id]);
      await event(w.user_id,"Withdrawal requires review","Automatic processing could not be confirmed. Finance will review the request.","withdrawal_manual");
    }
  }
  const pending=await q("SELECT * FROM withdrawals WHERE status='processing' AND binance_id IS NOT NULL LIMIT 30");
  if(pending.length&&cfg.binance_api_key){
    try{
      const history=await binance("/sapi/v1/capital/withdraw/history");
      for(const w of pending){
        const h=Array.isArray(history)?history.find((x:any)=>x.id===w.binance_id):null;
        if(h&&h.status===6&&h.txId)await settleWithdrawal(w.id,h.txId);
        if(h&&[1,3,5].includes(h.status))await transaction(async c=>{
          const [current]=await q("SELECT * FROM withdrawals WHERE id=$1 AND status='processing' FOR UPDATE",[w.id],c);if(!current)return;
          await move(c,w.user_id,w.currency,"0","withdrawal_failed",w.id,`withdraw-failed:${w.id}`,`-${w.data.total}`);
          await q("UPDATE withdrawals SET status='failed',fail_reason='Binance confirmed the withdrawal was cancelled, rejected or failed. Reserved funds released.' WHERE id=$1",[w.id],c);
          await event(w.user_id,"Withdrawal failed","Binance confirmed the transfer did not complete. Reserved funds have been released.","withdrawal_rejected",c);
        });
      }
    }catch{logger.warn("Binance withdrawal history unavailable");}
  }
}
export async function settleWithdrawal(id:string,txid:string,c?:any){
  const settle=async(conn:any)=>{
    const [w]=await q("SELECT * FROM withdrawals WHERE id=$1 FOR UPDATE",[id],conn);
    assert(w,"Withdrawal not found",404);
    if(w.status==="sent")return;
    assert(["processing","manual_fallback","queued"].includes(w.status),"Withdrawal cannot be marked sent");
    await move(conn,w.user_id,w.currency,`-${w.data.total}`,"withdrawal_sent",id,`withdrawal-sent:${id}`,`-${w.data.total}`);
    await q("UPDATE withdrawals SET status='sent',txid=$1,fail_reason=NULL WHERE id=$2",[txid,id],conn);
    await event(w.user_id,"Withdrawal sent",`Your withdrawal has been sent. Transaction ID: ${txid}`,"withdrawal_sent",conn);
  };
  if(c)await settle(c);else await transaction(settle);
}
export async function referralCommission(c:any,uId:string,sourceId:string,value:string,currency:string,trigger:string){
  const cfg=await config(false,c),rc=cfg.referral_config;
  const triggers=rc?.triggers??[rc?.trigger];
  if(!rc?.enabled||!(triggers.includes(trigger)||(trigger==="first_deposit"&&triggers.includes("every_deposit"))))return;
  let [u]=await q("SELECT * FROM users WHERE id=$1",[uId],c);
  const seen=new Set([uId]);
  for(let level=1;level<=Math.min(3,Number(rc.levels));level++){
    if(!u?.referred_by)return;
    const [parent]=await q("SELECT * FROM users WHERE id=$1",[u.referred_by],c);
    if(!parent||seen.has(parent.id))return;seen.add(parent.id);
    const id=`commission-${sourceId}-${level}`,key=`referral:${sourceId}:${level}`;
    if((await q("SELECT id FROM ledger WHERE idempotency_key=$1",[key],c)).length){u=parent;continue;}
    const [ref]=await q("SELECT * FROM platform_records WHERE kind='referral' AND user_id=$1 AND data->>'referred_id'=$2 ORDER BY created_at LIMIT 1 FOR UPDATE",[parent.id,uId],c);
    await q("SELECT id FROM users WHERE id=$1 FOR UPDATE",[parent.id],c);
    const [{commission}]=await q(`SELECT GREATEST(0,LEAST($1::numeric*$2::numeric/100,
      COALESCE($3::numeric-(SELECT COALESCE(sum((data->>'amount')::numeric),0) FROM platform_records WHERE kind='commission' AND user_id=$4 AND data->>'source_user_id'=$5 AND data->>'currency'=$6 AND data->>'status'='paid'),$1::numeric*$2::numeric/100)))::text AS commission`,
      [value,String((rc.percentages??rc.percents??[])[level-1]??"0"),rc.cap,parent.id,uId,currency],c);
    if(!/^0(?:\.0*)?$/.test(commission)){
      const status=ref?.data.review_decision==="block"?"blocked":ref?.data.suspicious&&ref.data.review_decision!=="allow"?"pending":"paid";
      if(status==="paid")await move(c,parent.id,currency,commission,"referral_commission",sourceId,key);
      await record("commission",{source_user_id:uId,source_id:sourceId,source_value:value,source_type:trigger,amount:commission,currency,level,status},parent.id,id,c);
      if(status==="paid")await event(parent.id,"Referral commission earned",`${commission} ${currency} was credited to your wallet.`,"commission_earned",c);
    }
    u=parent;
  }
}
export async function reconcile(){
  const differences=await q(`SELECT w.user_id,w.currency,w.balance,COALESCE(sum(l.amount),0)::text AS ledger_total
    FROM wallets w LEFT JOIN ledger l ON l.user_id=w.user_id AND l.currency=w.currency
    GROUP BY w.id HAVING w.balance<>COALESCE(sum(l.amount),0)`);
  const id=await record("reconciliation",{status:differences.length?"mismatch":"balanced",differences,checked_at:new Date().toISOString()});
  if(differences.length){
    const [a]=await q("SELECT id FROM users WHERE role='superadmin' AND status='active' LIMIT 1");
    if(a)await event(a.id,"Ledger reconciliation mismatch","Reconciliation found a mismatch. Review the finance reports before processing further transactions.","reconciliation_mismatch");
  }
  return {id,status:differences.length?"mismatch":"balanced",differences};
}
async function binanceDepositWorker(){
  const cfg=await config(true);
  if(cfg.binance?.auto_deposits===false||!cfg.binance_api_key||!cfg.binance_api_secret)return;
  const fingerprint=accountFingerprint(cfg.binance_api_key);
  const pending=await q("SELECT * FROM deposits WHERE status='pending_review' AND data->>'binance_auto_eligible'='true' AND (data->>'binance_next_check_at' IS NULL OR (data->>'binance_next_check_at')::timestamptz<=now()) ORDER BY created_at LIMIT 100");
  if(!pending.length)return;
  let history:any[];
  try{
    const response=await binance("/sapi/v1/capital/deposit/hisrec");
    if(!Array.isArray(response))return;
    history=response;
  }catch{logger.warn("Binance deposit history unavailable; deposits remain in manual review");return;}
  for(const d of pending){
    const data=d.data??{};
    if(data.binance_account_fingerprint!==fingerprint)continue;
    const match=findVerifiedBinanceDeposit(d,history);
    if(!match){
      const possible=history.find((item:any)=>String(item?.coin??"").toUpperCase()===String(d.currency??"").toUpperCase()&&normalizedTxid(item?.txId)===normalizedTxid(d.txid));
      const attempts=Number(data.binance_check_attempts??0)+1;
      const nextCheck=new Date(Date.now()+Math.min(30,2+attempts)*60000).toISOString();
      await q("UPDATE deposits SET data=data||$1::jsonb WHERE id=$2 AND status='pending_review'",[JSON.stringify({
        binance_hint_checked:new Date().toISOString(),
        binance_hint:possible?{possible_match:true,status:String(possible.status??""),network:String(possible.network??"")}:{possible_match:false},
        binance_check_attempts:attempts,binance_next_check_at:nextCheck,
      }),d.id]);
      continue;
    }
    await creditVerifiedBinanceDeposit(d.id,fingerprint,match);
  }
}
async function scheduledRates(){
  const list=await q("SELECT * FROM assets WHERE data->'scheduled_changes' IS NOT NULL");
  for(const a of list){
    const changes=a.data.scheduled_changes;
    if(!Array.isArray(changes))continue;
    for(const change of changes){
      if(change.applied||!change.at||new Date(change.at).getTime()>Date.now())continue;
      const rates=change.rates??change;
      if(!rates||!["minute","hour","day"].every(k=>rates[k]===undefined||rates[k]===null||/^\d{1,18}(\.\d{1,18})?$/.test(String(rates[k]))))continue;
      await transaction(async c=>{
        const [current]=await q("SELECT * FROM assets WHERE id=$1 FOR UPDATE",[a.id],c);
        if(!current?.data.scheduled_changes?.some((ch:any)=>ch.at===change.at&&!ch.applied))return;
        const updates=current.data.scheduled_changes.map((ch:any)=>ch.at===change.at?{...ch,applied:true}:ch);
        const changed=["minute","hour","day"].filter(k=>rates[k]!==undefined);
        const basis=change.profit_rate_basis??(changed.includes(current.data?.profit_rate_basis)?current.data.profit_rate_basis:changed[0]??"hour");
        const entered=rates[basis];
        if(entered===undefined)return;
        const value=entered===null?"0":String(entered);
        const [converted]=await q(`SELECT
          (CASE WHEN $1='minute' THEN $2::numeric WHEN $1='hour' THEN round($2::numeric/60,18) ELSE round($2::numeric/1440,18) END)::text AS minute,
          (CASE WHEN $1='minute' THEN $2::numeric*60 WHEN $1='hour' THEN $2::numeric ELSE round($2::numeric/24,18) END)::text AS hour,
          (CASE WHEN $1='minute' THEN $2::numeric*1440 WHEN $1='hour' THEN $2::numeric*24 ELSE $2::numeric END)::text AS day`,[basis,value],c);
        await q("UPDATE assets SET minute_rate=$1,hour_rate=$2,day_rate=$3,data=data||$4::jsonb WHERE id=$5",
          [converted.minute,converted.hour,converted.day,JSON.stringify({scheduled_changes:updates,profit_rate_basis:basis,profit_rate_value:value}),a.id],c);
      });
    }
  }
}
async function telegramWorker(){
  const cfg=await config(true);
  if(!cfg.telegram_bot_token||!cfg.notifications?.telegram_chat_id)return;
  const queued=await q("SELECT id FROM platform_records WHERE kind='telegram_outbox' AND data->>'status'='queued' AND COALESCE((data->>'attempts')::integer,0)<5 AND (data->>'next_attempt_at' IS NULL OR (data->>'next_attempt_at')::timestamptz<=now()) LIMIT 10");
  for(const {id} of queued){
    const [r]=await q("UPDATE platform_records SET data=data||jsonb_build_object('status','sending','attempts',COALESCE((data->>'attempts')::integer,0)+1) WHERE id=$1 AND data->>'status'='queued' RETURNING *",[id]);
    if(!r)continue;
    try{
      const response=await fetch(`https://api.telegram.org/bot${cfg.telegram_bot_token}/sendMessage`,{
        method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({chat_id:cfg.notifications.telegram_chat_id,text:`${cfg.site_name}: ${r.data.title}\n${r.data.body}`}),signal:AbortSignal.timeout(10000),
      });
      const body:any=await response.json();assert(response.ok&&body.ok,"Telegram delivery failed");
      await q("UPDATE platform_records SET data=data||'{\"status\":\"sent\"}'::jsonb WHERE id=$1",[id]);
    }catch{
      await q("UPDATE platform_records SET data=data||$2::jsonb WHERE id=$1",[id,JSON.stringify({status:"queued",next_attempt_at:new Date(Date.now()+60000*2**r.data.attempts).toISOString(),error:"Telegram delivery failed. Check bot and chat configuration."})]);
    }
  }
}
let running=false;
export function startWorkers(){
  const tick=async()=>{
    if(running)return;running=true;
    try{
      const failures:string[]=[];
      for(const [name,run] of Object.entries({rates:scheduledRates,billing:billRentals,confirmations:expireWithdrawalConfirmations,withdrawals:withdrawalWorker,binance_deposits:binanceDepositWorker,email:emailWorker,telegram:telegramWorker})){
        try{await run();}
        catch(err){
          failures.push(name);
          logger.error({source:name,type:err instanceof Error?err.name:"unknown"},"Worker service failed");
          await record("error_log",{source:name,message:"A worker service failed. Review server diagnostics.",created_at:new Date().toISOString()},null,`worker-error:${name}`).catch(()=>undefined);
        }
      }
      await record("worker_log",{status:failures.length?"degraded":"healthy",failures,message:"Worker services checked independently.",checked_at:new Date().toISOString()},null,"worker-health");
    }finally{running=false;}
  };
  setInterval(tick,30000).unref();
  setInterval(()=>reconcile().catch(()=>logger.error("Reconciliation failed")),86400000).unref();
}
