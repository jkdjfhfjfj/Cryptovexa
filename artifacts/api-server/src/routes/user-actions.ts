import { Router, type IRouter } from "express";
import { randomInt } from "node:crypto";
import { UserActionBody } from "@workspace/api-zod";
import { z } from "zod";
import { q, uid, hash, config, requireUser, amount, str, assert, transaction, record, ownedRecord, getRecords, move, event, token, replayRequest } from "../lib/platform";
import { startRental, stopRental, extendRental, billRental } from "../lib/rentals";
import { checkTwofa } from "./accounts";
import { getBinanceDepositAddress, getCachedBinanceDepositAddress, marketRates } from "../lib/services";

export const userActions: IRouter = Router();
export function withdrawalCooldownMinutes(rules:any){
  const saved=Number(rules?.cooldown_minutes);
  if(Number.isFinite(saved)&&saved>=1)return Math.ceil(saved);
  const value=Number(rules?.cooldown_value??rules?.cooldown_hours??24);
  const minutes=value*(rules?.cooldown_unit==="minutes"?1:60);
  return Number.isFinite(minutes)&&minutes>=1?Math.ceil(minutes):1440;
}
export function cooldownLabel(minutes:number){return minutes%60===0?`${minutes/60} hour${minutes===60?"":"s"}`:`${minutes} minute${minutes===1?"":"s"}`;}
function cooldownAdjective(minutes:number){return minutes%60===0?`${minutes/60}-hour`:`${minutes}-minute`;}
export async function currencyNetwork(currency: unknown,network: unknown,c?:any) {
  assert(["BNB","USDT","USDC","BTC","ETH"].includes(String(currency)),"Unsupported currency");
  const cur=await ownedRecord(`currency-${currency}`,"currency",undefined,c);
  assert(cur.enabled,"Currency is disabled");
  const net=cur.networks.find((n:any)=>n.name===network&&n.enabled);
  assert(net,"Network is unavailable"); return {cur,net};
}
export async function ownedFile(path:unknown,u:any,c?:any) {
  if(!path)return null;
  const [f]=await q("SELECT * FROM private_files WHERE (object_path=$1 OR id=$1) AND user_id=$2",[str(path),u.id],c);
  assert(f,"Upload not found or not owned by you"); return f.object_path;
}
userActions.post("/v1/actions/:action",async(req,res):Promise<void>=>{
  const u=await requireUser(req),cfg=await config(true),action=String(req.params.action);
  const b=UserActionBody.passthrough().parse(req.body) as Record<string,any>;
  assert(!cfg.maintenance,"The platform is in maintenance mode. Please try again later.",503);
  if(cfg.email_verification_required&&["deposit","withdraw","rent"].includes(action))assert(u.email_verified,"Verify your email before making payments or rentals",403);
  if(cfg.twofa_mode==="required"&&["withdraw","rent"].includes(action))assert(u.twofa_enabled,"Enable two-factor authentication in your profile first",403);
  if(action==="deposit-address"){
    const {net}=await currencyNetwork(b.currency,b.network);
    if(cfg.binance?.auto_deposits!==false){
      const address=await getBinanceDepositAddress(String(b.currency),net);
      if(address){
        res.json({success:true,available:true,address:address.address,tag:address.tag,source:"binance",auto_eligible:true,memo_required:!!net.memo_required});
        return;
      }
    }
    const manualAddress=[net.address,...(net.fallback_addresses??[])].find((value:any)=>typeof value==="string"&&value.trim());
    const manualAddressUsable=!!manualAddress&&(!net.memo_required||!!String(net.memo??"").trim());
    res.json({
      success:true,available:manualAddressUsable,address:manualAddressUsable?manualAddress:"",tag:manualAddressUsable?String(net.memo??""):"",
      source:manualAddressUsable?(cfg.binance?.auto_deposits===false?"manual":"manual_fallback"):"unavailable",
      auto_eligible:false,memo_required:!!net.memo_required,
      message:manualAddressUsable
        ?(cfg.binance?.auto_deposits===false?"This deposit will be reviewed manually.":"Binance could not provide an address; this manually configured address will be reviewed by an administrator.")
        :manualAddress&&net.memo_required?"The manual fallback is missing its required memo/tag. Contact an administrator.":"No Binance or manual deposit address is currently available for this network.",
    });
    return;
  }
  let result:any={success:true,message:"Saved"};
  await transaction(async c=>{
    const requestId=b.request_id?z.string().uuid().parse(b.request_id):null;
    if(["deposit","withdraw","confirm-withdrawal","rent","rental-stop","rental-extend"].includes(action))assert(requestId,"A unique request ID is required for financial actions");
    const requestKey=requestId?`request:${u.id}:${action}:${requestId}`:null;
    if(requestKey){
      const saved=await replayRequest(c,requestKey);
      if(saved){result=saved;return;}
    }
    if(action==="deposit"){
      assert(b.terms===true,"Accept the deposit terms");
      const {cur,net}=await currencyNetwork(b.currency,b.network,c),value=amount(b.amount);
      const cachedBinanceAddress=await getCachedBinanceDepositAddress(String(b.currency),net,c);
      const addresses=[net.address,...(net.fallback_addresses??[]),cachedBinanceAddress?.address].filter(Boolean);
      const addressUsed=b.address_used?str(b.address_used,10,256):net.address||addresses[0];
      assert(addressUsed&&addresses.includes(addressUsed),"No valid deposit address is configured for this network. Refresh the address or contact support.");
      const usingBinanceAddress=!!cachedBinanceAddress&&addressUsed===cachedBinanceAddress.address;
      const addressTag=usingBinanceAddress?String(cachedBinanceAddress.tag??""):String(net.memo??"");
      assert(!(net.memo_required||addressTag)||b.memo_confirmed===true,"Confirm that you included the required memo or tag");
      assert(!net.memo_required||!!addressTag,"This network's required memo or tag is not configured");
      const [{valid}]=await q("SELECT $1::numeric >= $2::numeric AS valid",[value,cur.min_deposit],c);
      assert(valid,`Minimum deposit is ${cur.min_deposit} ${b.currency}`);
      const rawTxid=b.txid?str(b.txid,5,256).trim():null;
      const txid=rawTxid&&/^(?:0x)?[a-f0-9]{64}$/i.test(rawTxid)?rawTxid.toLowerCase().replace(/^0x/,""):rawTxid;
      assert(!cfg.txid_required||txid,"Transaction ID is required");
      if(cfg.binance?.auto_deposits!==false&&usingBinanceAddress)assert(!!txid,"A transaction ID is required for automatic Binance verification");
      if(txid){
        await q("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`deposit-txid:${txid}`],c);
        const duplicate=await q("SELECT id FROM deposits WHERE txid=$1 OR regexp_replace(lower(txid),'^0x','')=$1 LIMIT 1",[txid],c);
        assert(!duplicate.length,"This transaction ID has already been submitted",409);
      }
      const id=uid(),proof=await ownedFile(b.proof_image,u,c);
      const autoEligible=cfg.binance?.auto_deposits!==false&&usingBinanceAddress&&cachedBinanceAddress.current_account===true&&cachedBinanceAddress.current_network===true&&!!txid&&(!net.memo_required||!!cachedBinanceAddress.tag);
      await q("INSERT INTO deposits(id,user_id,currency,network,address_used,amount_claimed,txid,proof_image,data) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)",
        [id,u.id,b.currency,b.network,addressUsed,value,txid,proof,JSON.stringify({
          terms:cfg.deposit_terms,address_kind:autoEligible?"binance":addressUsed===net.address?"primary":"fallback",
          memo_used:addressTag,binance_auto_eligible:autoEligible,
          ...(autoEligible?{binance_network:cachedBinanceAddress.network,binance_account_fingerprint:cachedBinanceAddress.account_fingerprint}:{}),
        })],c);
      await event(u.id,"Deposit submitted",autoEligible
        ?"Binance is checking your transaction. The deposit will be credited only after an exact confirmed match; anything unverified remains in manual review."
        :"Your deposit is awaiting manual review. Funds are not yet credited.","deposit_submitted",c);
      result={...result,id,message:autoEligible?"Deposit submitted for Binance verification":"Deposit submitted for manual review"};
    }else if(action==="deposit-reply"){
      const [d]=await q("SELECT * FROM deposits WHERE id=$1 AND user_id=$2 FOR UPDATE",[str(b.id),u.id],c);
      assert(d&&d.status==="needs_info","This deposit is not awaiting more information");
      const proof=await ownedFile(b.proof_image,u,c);
      await q("UPDATE deposits SET status='pending_review',data=data||$1::jsonb,proof_image=COALESCE($2,proof_image) WHERE id=$3",
        [JSON.stringify({reply:str(b.body)}),proof,d.id],c);
      await event(u.id,"Deposit information updated","Your reply has been sent for review.","deposit_submitted",c);
    }else if(action==="address-create"){
      const {net}=await currencyNetwork(b.currency,b.network,c);
      const address=str(b.address,10,256);
      assert(new RegExp(net.address_regex).test(address),"Address format does not match the network");
      if(net.memo_required)str(b.memo,1,100);
      const cooldown=withdrawalCooldownMinutes(cfg.withdrawal_rules);
      const id=await record("address",{label:str(b.label,1,100),currency:b.currency,network:b.network,address,memo:b.memo??"",usable_after:new Date(Date.now()+cooldown*60000).toISOString()},u.id,uid(),c);
      result={...result,id,message:`Address saved. Security cooldown: ${cooldownLabel(cooldown)}.`};
    }else if(action==="address-delete"){
      await q("DELETE FROM platform_records WHERE id=$1 AND user_id=$2 AND kind='address'",[str(b.id),u.id],c);
    }else if(action==="withdraw"){
      assert(!u.withdrawals_blocked,"Withdrawals are blocked pending verification. Visit verification or contact support.",403);
      if(cfg.withdrawal_rules.kyc_required)assert(u.kyc_status==="approved","Complete identity verification before withdrawing",403);
      assert(b.terms===true,"Accept the withdrawal terms");
      const {cur,net}=await currencyNetwork(b.currency,b.network,c),value=amount(b.amount),address=str(b.address,10,256);
      assert(new RegExp(net.address_regex).test(address),"Address format does not match the selected network");
      assert(!(cfg.withdrawal_rules.blacklist??[]).includes(address),"This address cannot receive withdrawals");
      const addresses=await getRecords("address",u.id,c), saved=addresses.find(a=>a.address===address&&a.currency===b.currency&&a.network===b.network);
      assert(saved&&new Date(saved.usable_after).getTime()<=Date.now(),`This address has not completed its ${cooldownAdjective(withdrawalCooldownMinutes(cfg.withdrawal_rules))} security cooldown.`);
      if(net.memo_required)str(saved.memo,1,100);
      const [{valid}]=await q("SELECT $1::numeric BETWEEN $2::numeric AND $3::numeric AS valid",[value,cur.min_withdraw,cur.max_withdraw],c);
      assert(valid,`Withdrawal must be between ${cur.min_withdraw} and ${cur.max_withdraw} ${b.currency}`);
      const prices=await marketRates(),price=prices[String(b.currency)];
      assert(price,"USD conversion is temporarily unavailable. Try again before withdrawing.");
      const [{usdValue}]=await q('SELECT ($1::numeric*$2::numeric)::text AS "usdValue"',[value,price],c);
      await q("SELECT pg_advisory_xact_lock(735742)",[],c);
      const [{allowed}]=await q(`SELECT
        COALESCE(sum((data->>'usd_value')::numeric) FILTER(WHERE user_id=$1),0)+$2::numeric<=$3::numeric AND COALESCE(sum((data->>'usd_value')::numeric),0)+$2::numeric<=$4::numeric AS allowed
        FROM withdrawals WHERE created_at>=date_trunc('day',now()) AND status NOT IN ('rejected','failed')`,
        [u.id,usdValue,cfg.withdrawal_rules.daily_user_limit,cfg.withdrawal_rules.daily_global_limit],c);
      assert(allowed,"Daily withdrawal limit reached");
      const [{fee,total}]=await q(`SELECT ${cur.fee_type==="percent"?"round($1::numeric*$2::numeric/100,18)":"$2::numeric"} AS fee,
        $1::numeric+${cur.fee_type==="percent"?"round($1::numeric*$2::numeric/100,18)":"$2::numeric"} AS total`,[value,cur.fee],c);
      const id=uid();
      if(u.twofa_enabled)await checkTwofa(u,b.code,cfg.site_name,c);
      else assert(cfg.smtp?.host&&cfg.smtp_password,"Email confirmation is unavailable until SMTP is configured. Enable authenticator 2FA or contact support.");
      await move(c,u.id,b.currency,"0","withdrawal_lock",id,`withdraw-lock:${id}`,total);
      await q("INSERT INTO withdrawals(id,user_id,currency,network,address,memo,amount,fee,status,data) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)",
        [id,u.id,b.currency,b.network,address,saved.memo??null,value,fee,u.twofa_enabled?"queued":"pending_confirm",JSON.stringify({total,usd_value:usdValue,terms:cfg.withdrawal_terms})],c);
      if(!u.twofa_enabled){
        const code=String(randomInt(100000,1000000));
        await q("INSERT INTO security_tokens(id,user_id,kind,hash,expires_at,data) VALUES($1,$2,'withdrawal',$3,now()+interval '10 minutes',$4::jsonb)",
          [uid(),u.id,hash(code),JSON.stringify({withdrawal_id:id})],c);
        await event(u.id,"Confirm your withdrawal",`Your confirmation code is ${code}. It expires in 10 minutes.`,"withdrawal_confirmation",c);
      }
      await event(u.id,"Withdrawal requested","The amount and fee have been reserved in your wallet.","withdrawal_requested",c);
      const [{large}]=await q("SELECT $1::numeric>=$2::numeric AS large",[usdValue,cfg.withdrawal_rules.large_alert_threshold??cfg.withdrawal_rules.auto_threshold??"1000"],c);
      if(large)await event(u.id,"Large withdrawal requires attention","Your withdrawal was flagged for finance review under the configured alert threshold.","large_withdrawal",c);
      result={...result,id,requires_confirmation:!u.twofa_enabled,withdrawal:{id,status:u.twofa_enabled?"queued":"pending_confirm"},message:u.twofa_enabled?"Withdrawal queued":"Enter the confirmation code sent by email"};
    }else if(action==="confirm-withdrawal"){
      const [t]=await q("SELECT * FROM security_tokens WHERE user_id=$1 AND kind='withdrawal' AND hash=$2 AND used=false AND expires_at>now() AND data->>'withdrawal_id'=$3 FOR UPDATE",
        [u.id,hash(str(b.code)),str(b.id)],c);
      assert(t,"Invalid or expired confirmation code");
      await q("UPDATE security_tokens SET used=true WHERE id=$1",[t.id],c);
      await q("UPDATE withdrawals SET status='queued' WHERE id=$1 AND user_id=$2 AND status='pending_confirm'",[b.id,u.id],c);
      result.message="Withdrawal confirmed and queued";
    }else if(action==="rent"){
      assert(b.rental_terms_accepted===true,"Accept the rental capital and profit settlement terms");
      const rental=await startRental(u,b,c);result={...result,id:rental.id,message:"Rental started"};
    }else if(action==="rental-stop"){await stopRental(u,b,c);result.message="Rental stopped";}
    else if(action==="rental-extend"){await extendRental(u,b,c);result.message="Rental extended";}
    else if(action==="rental-renew"){
      const rows=await q("UPDATE rentals SET auto_renew=$1 WHERE id=$2 AND user_id=$3 AND status='active' RETURNING id,data",[Boolean(b.auto_renew),str(b.id),u.id],c);
      assert(rows.length,"Active rental not found");
      if(rows[0].data?.rental_model_version===2)await billRental(c,rows[0].id,new Date());
    }else if(action==="ticket-create"){
      const subject=str(b.subject,3,200),body=str(b.body,3,10000);
      for(const p of b.attachments??[])await ownedFile(p,u,c);
      const id=await record("ticket",{subject,category:str(b.category??"General"),priority:z.enum(["low","normal","high","urgent"]).parse(b.priority??"normal"),status:"open",
        messages:[{id:uid(),body,author_type:"user",created_at:new Date().toISOString(),is_internal:false,attachments:b.attachments??[]}]},u.id,uid(),c);
      await event(u.id,"Support ticket created",subject,"ticket_created",c);
      result={...result,id,message:"Ticket created"};
    }else if(action==="ticket-reply"){
      const t=await ownedRecord(str(b.id),"ticket",u.id,c);
      assert(t.status!=="closed","This ticket is closed");
      for(const p of b.attachments??[])await ownedFile(p,u,c);
      t.messages.push({id:uid(),body:str(b.body,1,10000),author_type:"user",created_at:new Date().toISOString(),is_internal:false,attachments:b.attachments??[]});
      await record("ticket",{...t,status:"open"},u.id,t.id,c);
      await event(u.id,"Reply added","Your support reply has been saved.","ticket_reply",c);
    }else if(action==="ticket-close"){
      const t=await ownedRecord(str(b.id),"ticket",u.id,c);
      await record("ticket",{...t,status:"closed"},u.id,t.id,c);
    }else if(action==="kyc-submit"){
      const k=await ownedRecord(str(b.id),"kyc",u.id,c);
      assert(["requested","rejected"].includes(k.status),"Verification is not awaiting documents");
      assert(Array.isArray(b.documents),"Documents are required");
      const docs=[];
      for(const type of k.required_items){
        const doc=b.documents.find((d:any)=>d.type===type);
        assert(doc,`Upload ${type.replaceAll("_"," ")}`);
        const objectPath=await ownedFile(doc.objectPath,u,c);
        assert(objectPath,`Upload a file for ${type.replaceAll("_"," ")}`);
        docs.push({id:type,type,objectPath,status:"submitted"});
      }
      await record("kyc",{...k,documents:docs,status:"submitted"},u.id,k.id,c);
      await q("UPDATE users SET kyc_status='submitted' WHERE id=$1",[u.id],c);
      await event(u.id,"Documents submitted","Your verification documents are awaiting review.","kyc_submitted",c);
      result.message="Verification documents submitted";
    }else if(action==="notifications-read"){
      await q("UPDATE platform_records SET data=jsonb_set(data,'{read}','true') WHERE user_id=$1 AND kind='notification'",[u.id],c);
    }else if(action==="article-vote"){
      const a=await ownedRecord(str(b.id),"article",undefined,c);
      const key=b.helpful?"helpful_yes":"helpful_no";
      await record("article",{...a,[key]:Number(a[key]??0)+1},null,a.id,c);
    }else if(action==="profile-preferences"){
      const preferences={
        language:z.enum(["en","es","fr","pt","ar","sw","zh","hi"]).parse(b.language??u.language),
        theme:z.enum(["light","dark","system"]).parse(b.theme??"dark"),
        notifications:z.object({deposits:z.boolean().optional(),withdrawals:z.boolean().optional(),rentals:z.boolean().optional(),referrals:z.boolean().optional(),security:z.literal(true).optional(),marketing:z.boolean().optional()}).parse({...b.notifications,security:true}),
      };
      await q("UPDATE users SET data=jsonb_set(data,'{preferences}',$1::jsonb),language=$2 WHERE id=$3",[JSON.stringify(preferences),preferences.language,u.id],c);
    }else assert(false,"Unknown action",404);
    if(requestKey)await record("request",result,u.id,requestKey,c);
  });
  res.json(result);
});
