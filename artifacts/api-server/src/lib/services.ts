import nodemailer from "nodemailer";
import { createHmac } from "node:crypto";
import { q, config, transaction, move, event, record, uid, assert, getRecords } from "./platform";
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
export async function sendEmail(to:string,template:string,data:any) {
  const cfg=await config(true),smtp=cfg.smtp;
  assert(smtp?.host&&smtp?.from_email,"SMTP is not configured",503);
  const templates=await getRecords("email_template"),tmpl=templates.find(t=>t.key===template&&t.language===(data.language??"en"))??templates.find(t=>t.key===template&&t.language==="en");
  const replace=(s:string)=>s.replace(/\{\{\s*([\w]+)\s*\}\}/g,(_,key)=>escapeHtml(key==="site_name"?cfg.site_name:data[key]??""));
  const subject=replace(tmpl?.subject??data.title??cfg.site_name);
  const link=data.token&&data.origin?`${String(data.origin).replace(/\/$/,"")}${data.path}?token=${encodeURIComponent(data.token)}`:null;
  const content=(tmpl?replace(tmpl.body_html):`<h1 style="font-size:24px">${escapeHtml(data.title)}</h1><p style="line-height:1.7">${escapeHtml(data.body)}</p>`)+
    (link?`<p><a href="${escapeHtml(link)}" style="background:#14b8a6;color:#06101d;padding:12px 20px;border-radius:10px;display:inline-block">Continue securely</a></p>`:"");
  const transport=nodemailer.createTransport({host:smtp.host,port:Number(smtp.port??587),secure:Number(smtp.port??587)===465,requireTLS:Number(smtp.port??587)!==465,
    ...(smtp.username?{auth:{user:smtp.username,pass:cfg.smtp_password}}:{}),connectionTimeout:15000,socketTimeout:20000});
  const color=/^#[\da-f]{6}$/i.test(cfg.brand_color)?cfg.brand_color:"#14b8a6";
  await transport.sendMail({from:{name:smtp.from_name||cfg.site_name,address:smtp.from_email},to,subject,html:
    `<div style="background:#06101d;padding:36px 16px;font-family:Arial,sans-serif;color:#e8f0f7"><div style="max-width:560px;margin:auto;background:#0b1a2e;padding:32px;border-radius:20px;border-top:4px solid ${color}"><div style="color:${color};font-size:20px;font-weight:bold">${escapeHtml(cfg.site_name)}</div>${content}<hr style="border:0;border-top:1px solid #294153;margin-top:30px"><p style="font-size:12px;color:#8fa3b8">© ${new Date().getFullYear()} ${escapeHtml(cfg.site_name)}. Cryptocurrency involves risk. Returns are not guaranteed.</p></div></div>`});
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
async function depositHints(){
  const cfg=await config(true);
  if(!cfg.binance?.deposit_hints||!cfg.binance_api_key)return;
  const pending=await q("SELECT * FROM deposits WHERE status IN ('pending_review','needs_info') AND data->>'binance_hint_checked' IS NULL LIMIT 30");
  if(!pending.length)return;
  try{
    const history=await binance("/sapi/v1/capital/deposit/hisrec");
    if(!Array.isArray(history))return;
    for(const d of pending){
      const match=history.find((h:any)=>h.coin===d.currency&&String(h.txId).toLowerCase().replace(/^0x/,"")===String(d.txid).toLowerCase().replace(/^0x/,""));
      if(match)await q("UPDATE deposits SET data=data||$1::jsonb WHERE id=$2",[JSON.stringify({binance_hint_checked:new Date().toISOString(),binance_hint:{possible_match:true,txid:match.txId,status:match.status}}),d.id]);
    }
  }catch{logger.warn("Binance deposit hints unavailable");}
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
        await q("UPDATE assets SET minute_rate=$1,hour_rate=$2,day_rate=$3,data=jsonb_set(data,'{scheduled_changes}',$4::jsonb) WHERE id=$5",
          [rates.minute===null?"0":rates.minute??current.minute_rate,rates.hour===null?"0":rates.hour??current.hour_rate,rates.day===null?"0":rates.day??current.day_rate,JSON.stringify(updates),a.id],c);
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
      for(const [name,run] of Object.entries({rates:scheduledRates,billing:billRentals,confirmations:expireWithdrawalConfirmations,withdrawals:withdrawalWorker,deposit_hints:depositHints,email:emailWorker,telegram:telegramWorker})){
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
