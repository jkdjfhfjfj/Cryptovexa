import { Router, type IRouter } from "express";
import argon2 from "argon2";
import { z } from "zod";
import sanitizeHtml from "sanitize-html";
import { AdminActionBody } from "@workspace/api-zod";
import { q, uid, config, requireUser, amount, amountSchema, str, assert, transaction, record, ownedRecord, getRecords, move, event, audit, putSetting, defaultSettings, token, replayRequest, accountLinkOrigin } from "../lib/platform";
import { binance, sendEmail, settleWithdrawal, referralCommission, reconcile } from "../lib/services";
import { stopRental, extendRental } from "../lib/rentals";
import { reviewDocuments } from "../lib/verification";
import { approveDeposit } from "../lib/deposits";

export const adminActions: IRouter=Router();
const amountOrZero=(v:unknown)=>amountSchema.parse(String(v));
const financeActions=["deposit-approve","deposit-reject","deposit-info","withdrawal-approve","withdrawal-reject","withdrawal-sent","withdrawal-retry","reconcile"];
const supportActions=["ticket-reply","ticket-update","kyc-request","kyc-review","kyc-document-review","article-save","article-delete"];
adminActions.post("/admin/actions/:action",async(req,res):Promise<void>=>{
  const u=await requireUser(req,"admin"),action=String(req.params.action),cfg=await config(true);
  assert(cfg.admin_twofa_mode!=="required"||u.twofa_enabled,"Enable administrator two-factor authentication before performing actions",403);
  assert(u.role==="superadmin"||(u.role==="finance"&&financeActions.includes(action))||(u.role==="support"&&supportActions.includes(action)),"You do not have permission for this action",403);
  const b=AdminActionBody.passthrough().parse(req.body) as Record<string,any>;
  let result:any={success:true,message:"Saved"};
  if(action==="binance-test"){
    try{
      const balances=await binance("/sapi/v1/capital/config/getall");
      await putSetting("binance_status",{connected:true,checked_at:new Date().toISOString(),balances:Array.isArray(balances)?balances.filter((b:any)=>["BNB","USDT","USDC","BTC","ETH"].includes(b.coin)).map((b:any)=>({currency:b.coin,free:String(b.free??"0"),locked:String(b.locked??"0")})):[]});
    }catch(e){
      await putSetting("binance_status",{connected:false,checked_at:new Date().toISOString()});
      await audit(u,"binance_test_failed",null,req);throw e;
    }
    await audit(u,action,null,req);
    res.json({...result,message:"Binance connection verified"});return;
  }
  if(action==="email-test"){
    if(b.resend_log_id){
      const [old]=await q("UPDATE email_logs SET status='queued',attempts=0,error=NULL,data=data-'next_attempt_at'-'delivery_started_at' WHERE id=$1 RETURNING id",[str(b.resend_log_id)]);
      assert(old,"Email log not found",404);
      await audit(u,"email_resend",old.id,req);
      res.json({...result,message:"Original email queued for retry"});return;
    }
    await sendEmail(z.string().email().parse(b.to),"test",{title:"SMTP connection verified",body:"This test confirms your email configuration can send messages."});
    await audit(u,action,null,req);
    res.json({...result,message:"Test email sent"});return;
  }
  if(action==="reconcile"){
    result={...result,...await reconcile(),message:"Ledger reconciliation completed"};
    await audit(u,action,result.id,req);
    res.json(result);return;
  }
  await transaction(async c=>{
    const requestId=b.request_id?z.string().uuid().parse(b.request_id):null;
    if(["balance-adjust","deposit-approve","withdrawal-approve","withdrawal-retry","withdrawal-reject","withdrawal-sent","rental-stop","rental-extend"].includes(action))assert(requestId,"A unique request ID is required for financial actions");
    const requestKey=requestId?`admin-request:${u.id}:${action}:${requestId}`:null;
    if(requestKey){
      const saved=await replayRequest(c,requestKey);
      if(saved){result=saved;return;}
    }
    if(action==="settings-save"){
      const section=str(b.section,1,100),v=z.record(z.unknown()).parse(b.values) as any;
      const allowedSections=["general","branding","security","billing","withdrawal_rules","withdrawal","referral","referral_config","notifications","smtp","binance","translations","terms"];
      assert(allowedSections.includes(section),"Unknown settings section");
      const secretFields:Record<string,string>={api_key:"binance_api_key",api_secret:"binance_api_secret",password:"smtp_password",captcha_secret:"captcha_secret",telegram_bot_token:"telegram_bot_token"};
      for(const [field,key] of Object.entries(secretFields)){
        if(v[field])await putSetting(key,str(v[field],1,4000),true,c);
        delete v[field];
      }
      const aliases:Record<string,string>={deposit_txid_required:"txid_required",early_stop_penalty_percent:"early_stop_penalty",grace_period_minutes:"grace_minutes",daily_limit_user:"daily_user_limit",daily_limit_global:"daily_global_limit",new_address_cooldown_hours:"cooldown_hours",address_blacklist:"blacklist"};
      for(const [old,key] of Object.entries(aliases))if(v[old]!==undefined)v[key]=v[old];
      if(section==="terms"){
        await putSetting("terms",{...(cfg.terms??{}),...v},false,c);
        if(v.en?.deposit!==undefined)await putSetting("deposit_terms",str(v.en.deposit,0,100000),false,c);
        if(v.en?.withdrawal!==undefined)await putSetting("withdrawal_terms",str(v.en.withdrawal,0,100000),false,c);
      }
      if(section==="billing"){
        if(v.early_stop_penalty!==undefined)assert(Number(v.early_stop_penalty)>=0&&Number(v.early_stop_penalty)<=100,"Penalty must be 0–100 percent");
        if(v.grace_minutes!==undefined)assert(Number.isInteger(Number(v.grace_minutes))&&Number(v.grace_minutes)>=0,"Invalid grace period");
        for(const k of ["minimum_charge","low_balance_threshold"])if(v[k]!==undefined)v[k]=amountOrZero(v[k]);
      }
      if(["withdrawal_rules","withdrawal"].includes(section)){
        for(const k of ["auto_threshold","daily_user_limit","daily_global_limit","large_alert_threshold"])if(v[k]!==undefined)v[k]=amountOrZero(v[k]);
        if(v.cooldown_hours!==undefined)assert(Number.isFinite(Number(v.cooldown_hours))&&Number(v.cooldown_hours)>=24,"New-address cooldown must be at least 24 hours");
        if(v.blacklist!==undefined)v.blacklist=z.array(z.string().min(1).max(256)).max(10000).parse(v.blacklist);
      }
      if(["referral","referral_config"].includes(section)){
        v.levels=z.coerce.number().int().min(1).max(3).parse(v.levels??cfg.referral_config.levels);
        v.percentages=z.array(z.string().regex(/^\d{1,3}(\.\d{1,18})?$/).refine(s=>Number(s)<=100,"Percentages cannot exceed 100")).min(v.levels).max(3).parse(v.percentages??v.percents??cfg.referral_config.percentages);
        v.triggers=z.array(z.enum(["first_deposit","every_deposit","rental_spend"])).max(3).parse(v.triggers??[v.trigger??cfg.referral_config.trigger]);
        if(v.cap!==undefined&&v.cap!==null)v.cap=amountOrZero(v.cap);
        delete v.percents;delete v.trigger;
      }
      if(section==="notifications"){
        for(const k of ["alert_emails","deposit_alert_emails","withdrawal_alert_emails","ticket_alert_emails","kyc_alert_emails","reconcile_alert_emails"]){
          if(v[k]!==undefined)v[k]=z.array(z.string().email()).max(20).parse(Array.isArray(v[k])?v[k]:String(v[k]).split(/[,;\n]/).map((s:string)=>s.trim()).filter(Boolean));
        }
        if(v.telegram_chat_id)v.telegram_chat_id=z.string().regex(/^-?\d{1,30}$/).parse(v.telegram_chat_id);
      }
      if(section==="smtp"&&v.host){
        // Prevent mail testing from probing local infrastructure.
        assert(!/^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.|\[?::1)/i.test(v.host),"Use a public SMTP hostname");
      }
      if(section==="general"||section==="branding"||section==="security"||section==="terms"){
        const allowed=["site_name","short_name","brand_color","logo","favicon","app_icon","maintenance","registration_mode","twofa_mode","admin_twofa_mode","api_keys_enabled","email_verification_required","txid_required","deposit_terms","withdrawal_terms","force_manual","support_email","captcha_enabled","captcha_site_key","login_lockout_attempts"];
        for(const [key,val] of Object.entries(v)){
          if(allowed.includes(key)){
            if(["site_name","short_name"].includes(key))str(val,1,100);
            if(key==="brand_color")assert(/^#[0-9a-fA-F]{6}$/.test(String(val)),"Invalid brand color");
            if(["logo","favicon","app_icon"].includes(key)&&val)assert(String(val).startsWith("/")||String(val).startsWith("https://"),"Use a secure uploaded asset URL");
            if(["registration_mode"].includes(key))assert(["open","invite-only","closed"].includes(String(val)),"Invalid registration mode");
            if(["twofa_mode","admin_twofa_mode"].includes(key))assert(["off","optional","required"].includes(String(val)),"Invalid 2FA mode");
            if(key==="captcha_enabled"&&val)assert((v.captcha_site_key||cfg.captcha_site_key)&&(cfg.captcha_secret||req.body.values.captcha_secret),"Set the Turnstile site key and secret before enabling CAPTCHA");
            if(key==="login_lockout_attempts")assert(Number.isInteger(Number(val))&&Number(val)>=3&&Number(val)<=20,"Lockout attempts must be 3–20");
            await putSetting(key,val,false,c);
          }
        }
      }else{
        const key=section==="referral"?"referral_config":section==="withdrawal"?"withdrawal_rules":section;
        await putSetting(key,{...(cfg[key]??defaultSettings[key]??{}),...v},false,c);
        if(section==="binance"&&v.force_manual!==undefined)await putSetting("force_manual",Boolean(v.force_manual),false,c);
      }
      result.message="Settings saved";
    }else if(action==="asset-save"){
      const id=b.id?str(b.id):uid(),type=z.enum(["property","machine"]).parse(b.type), rates=b.rates??{};
      const units=Number(b.total_units??1);
      assert(Number.isInteger(units)&&units>=1&&units<=100000,"Invalid total units");
      const minute=String(rates.minute??b.minute_rate??"0"),hour=String(rates.hour??b.hour_rate??"0"),day=String(rates.day??b.day_rate??"0");
      for(const rate of [minute,hour,day])assert(/^\d{1,18}(\.\d{1,18})?$/.test(rate),"Rates must be decimal strings");
      const [existing]=await q("SELECT * FROM assets WHERE id=$1 FOR UPDATE",[id],c);
      const reserved=existing?existing.total_units-existing.available_units:0;
      assert(units>=reserved,"Total units cannot be below currently reserved units");
      const available=b.available_units===undefined?units-reserved:Number(b.available_units);
      assert(Number.isInteger(available)&&available>=0&&available<=units-reserved,"Available units cannot exceed unreserved capacity");
      const images=z.array(z.string().max(2000)).max(12).parse(b.images??[]);
      assert(images.every(s=>s.startsWith("/")||s.startsWith("https://")),"Image URLs must be secure");
      const min=Number(b.min_duration??1),max=Number(b.max_duration??43200);
      assert(Number.isInteger(min)&&Number.isInteger(max)&&min>0&&max>=min,"Invalid duration limits");
      const discounts=z.array(z.object({min_units:z.coerce.number().int().min(1).optional(),min_duration:z.coerce.number().int().min(1).optional(),percent:z.union([z.string(),z.number()]).transform(String).refine(s=>/^\d{1,2}(\.\d{1,18})?$/.test(s)&&Number(s)<100,"Discount must be below 100 percent")})).max(100).parse(b.discount_rules??[]);
      const schedules=z.array(z.object({at:z.string().datetime(),rates:z.record(z.union([z.string().regex(/^\d{1,18}(\.\d{1,18})?$/),z.null()])).optional(),minute:z.string().regex(/^\d{1,18}(\.\d{1,18})?$/).optional(),hour:z.string().regex(/^\d{1,18}(\.\d{1,18})?$/).optional(),day:z.string().regex(/^\d{1,18}(\.\d{1,18})?$/).optional(),applied:z.boolean().optional()})).max(100).parse(b.scheduled_changes??[]);
      await q(`INSERT INTO assets(id,type,title,description,location,category,images,specs,status,total_units,available_units,currency,minute_rate,hour_rate,day_rate,min_duration,max_duration,data)
        VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::jsonb)
        ON CONFLICT(id) DO UPDATE SET type=excluded.type,title=excluded.title,description=excluded.description,location=excluded.location,category=excluded.category,
        images=excluded.images,specs=excluded.specs,status=excluded.status,total_units=excluded.total_units,available_units=excluded.available_units,currency=excluded.currency,
        minute_rate=excluded.minute_rate,hour_rate=excluded.hour_rate,day_rate=excluded.day_rate,min_duration=excluded.min_duration,max_duration=excluded.max_duration,data=excluded.data`,
        [id,type,str(b.title,2,200),str(b.description??"",0,10000),str(b.location??"",0,200),str(b.category??"General"),JSON.stringify(images),JSON.stringify(b.specs??{}),
          z.enum(["active","inactive","maintenance"]).parse(b.status??"active"),units,available,z.enum(["BNB","USDT","USDC","BTC","ETH"]).parse(b.currency??"USDT"),minute,hour,day,min,max,JSON.stringify({discount_rules:discounts,scheduled_changes:schedules})],c);
      result.id=id;
    }else if(action==="asset-delete"){
      const existing=await q("SELECT id FROM rentals WHERE asset_id=$1 LIMIT 1",[str(b.id)],c);
      if(existing.length)await q("UPDATE assets SET status='inactive' WHERE id=$1",[b.id],c);
      else await q("DELETE FROM assets WHERE id=$1",[b.id],c);
      result.message=existing.length?"Asset archived to preserve rental history":"Asset deleted";
    }else if(["deposit-approve","deposit-reject","deposit-info"].includes(action)){
      const [d]=await q("SELECT * FROM deposits WHERE id=$1 FOR UPDATE",[str(b.id)],c);
      assert(d,"Deposit not found",404);
      if(d.status==="approved"&&action==="deposit-approve"){result.message="Deposit was already credited";await audit(u,action,d.id,req,{already_credited:true},c);return;}
      assert(["pending_review","needs_info"].includes(d.status),"This deposit has already been reviewed");
      if(action==="deposit-approve"){
        await approveDeposit(c,d.id,u.id,b.amount,b.reason??"Approved");
      }else{
        const reason=str(b.reason,3,2000),status=action==="deposit-reject"?"rejected":"needs_info";
        await q("UPDATE deposits SET status=$1,reviewed_by=$2,review_note=$3 WHERE id=$4",[status,u.id,reason,d.id],c);
        await event(d.user_id,status==="rejected"?"Deposit rejected":"More deposit information needed",reason,status==="rejected"?"deposit_rejected":"deposit_info",c);
      }
    }else if(action.startsWith("withdrawal-")){
      const [w]=await q("SELECT * FROM withdrawals WHERE id=$1 FOR UPDATE",[str(b.id)],c);
      assert(!w?.data?.test_only||action==="withdrawal-reject","Test-only withdrawals can only be rejected; submission and settlement are forbidden",403);
      assert(w,"Withdrawal not found",404);
      if(action==="withdrawal-sent"){
        assert(!w.binance_id,"This request has a Binance ID. Verify Binance history rather than sending a duplicate transfer.");
        if(w.data.outcome_unknown)assert(b.confirm_history_checked===true,"Confirm Binance history contains no matching transfer before sending manually.");
        const [owner]=await q("SELECT * FROM users WHERE id=$1",[w.user_id],c);
        assert(owner?.status==="active"&&!owner.withdrawals_blocked&&(!cfg.withdrawal_rules.kyc_required||owner.kyc_status==="approved")&&!(cfg.withdrawal_rules.blacklist??[]).includes(w.address),"Current account, KYC or blacklist policy blocks this withdrawal");
        await settleWithdrawal(w.id,str(b.txid,5,256),c);
      }else if(action==="withdrawal-reject"){
        assert(["pending_confirm","queued","manual_fallback"].includes(w.status)&&!w.binance_id,"Processing or sent withdrawals cannot be rejected");
        if(w.data.outcome_unknown)assert(b.confirm_history_checked===true,"Check Binance history for a completed transfer before releasing reserved funds.");
        const reason=str(b.reason,3,2000);
        await move(c,w.user_id,w.currency,"0","withdrawal_rejected",w.id,`withdraw-reject:${w.id}`,`-${w.data.total}`);
        await q("UPDATE withdrawals SET status='rejected',fail_reason=$1,reviewed_by=$2 WHERE id=$3",[reason,u.id,w.id],c);
        await event(w.user_id,"Withdrawal rejected",`${reason} Reserved funds have been released.`,"withdrawal_rejected",c);
      }else{
        assert(["manual_fallback","queued"].includes(w.status),"Withdrawal is not eligible for retry or approval");
        assert(!w.binance_id,"Binance already accepted this withdrawal");
        if(action==="withdrawal-retry")assert(b.confirm_history_checked===true,"Confirm that Binance history contains no matching transfer before retrying.");
        const status=cfg.force_manual?"manual_fallback":"queued";
        await q("UPDATE withdrawals SET status=$1,reviewed_by=$2 WHERE id=$3",[status,u.id,w.id],c);
      }
    }else if(action==="balance-adjust"){
      const reason=str(b.reason,5,2000),raw=String(b.amount);
      assert(/^-?(?:0|[1-9]\d{0,17})(?:\.\d{1,18})?$/.test(raw),"Invalid decimal amount");
      const currency=z.enum(["BNB","USDT","USDC","BTC","ETH"]).parse(b.currency);
      await move(c,str(b.user_id),currency,raw,"admin_adjustment",u.id,`adjust:${uid()}`);
      await event(b.user_id,"Wallet adjustment",`An administrator adjusted your wallet. Reason: ${reason}`,"wallet_adjusted",c);
    }else if(action==="user-update"){
      const [target]=await q("SELECT * FROM users WHERE id=$1 FOR UPDATE",[str(b.id)],c);
      assert(target,"User not found",404);
      const status=z.enum(["active","suspended"]).parse(b.status??target.status);
      assert(target.id!==u.id||status==="active","You cannot suspend your own account");
      await q("UPDATE users SET username=$1,status=$2,withdrawals_blocked=$3,data=data||$4::jsonb WHERE id=$5",
        [b.username?str(b.username,2,50):target.username,status,b.withdrawals_blocked??target.withdrawals_blocked,JSON.stringify({notes:b.notes??target.data.notes??"",...(b.withdrawals_blocked===undefined?{}:{withdrawals_manually_blocked:Boolean(b.withdrawals_blocked)})}),target.id],c);
      if(status!=="active")await q("UPDATE login_sessions SET revoked=true WHERE user_id=$1",[target.id],c);
      await event(target.id,"Account updated",`Your account status is ${status}.`,"account_updated",c);
      if(b.send_password_reset){
        const reset=await token(target.id,"reset",{},undefined,c);
        await event(target.id,"Reset your password","An administrator requested a password reset. The link expires in one hour.","password_reset",c,{token:reset,path:"/reset-password",origin:accountLinkOrigin(req)});
      }
    }else if(action==="user-email"){
      const [target]=await q("SELECT * FROM users WHERE id=$1",[str(b.id)],c);
      assert(target,"User not found",404);
      await event(target.id,str(b.subject,3,200),str(b.body,3,10000),"direct_message",c);
      result.message="Message queued for email delivery";
    }else if(action==="referral-review"){
      const r=await ownedRecord(str(b.id),"referral",undefined,c);
      const decision=z.enum(["allow","block"]).parse(b.decision),reason=str(b.reason,5,2000);
      await record("referral",{...r,review_decision:decision,review_reason:reason,reviewed_by:u.id},r.user_id,r.id,c);
      if(decision==="allow"){
        const pending=await q("SELECT data FROM platform_records WHERE kind='commission' AND user_id=$1 AND data->>'source_user_id'=$2 AND data->>'status'='pending' FOR UPDATE",[r.user_id,r.referred_id],c);
        for(const {data:p} of pending)await referralCommission(c,p.source_user_id,p.source_id,p.source_value,p.currency,p.source_type);
      }else await q("UPDATE platform_records SET data=jsonb_set(data,'{status}','\"blocked\"') WHERE kind='commission' AND user_id=$1 AND data->>'source_user_id'=$2 AND data->>'status'='pending'",[r.user_id,r.referred_id],c);
    }else if(action==="user-revoke-sessions"){
      await q("UPDATE login_sessions SET revoked=true WHERE user_id=$1",[str(b.id)],c);
    }else if(action==="user-reset-twofa"){
      str(b.reason,5,2000);
      await q("UPDATE users SET twofa_enabled=false,twofa_secret=NULL WHERE id=$1",[str(b.id)],c);
      await q("DELETE FROM security_tokens WHERE user_id=$1 AND kind='recovery'",[b.id],c);
      await q("UPDATE login_sessions SET revoked=true WHERE user_id=$1",[b.id],c);
      await event(b.id,"Authenticator reset","An administrator reset two-factor authentication. Review your account security.","twofa_reset",c);
    }else if(action==="kyc-request"){
      const items=z.array(z.enum(["id_front","id_back","selfie","proof_of_address"])).min(1).parse(b.required_items);
      const deadline=z.string().datetime().parse(new Date(b.deadline??Date.now()+7*86400000).toISOString());
      await q("UPDATE platform_records SET data=data||'{\"status\":\"superseded\"}'::jsonb WHERE kind='kyc' AND user_id=$1 AND data->>'status' IN ('requested','submitted','rejected')",[str(b.user_id)],c);
      const id=await record("kyc",{required_items:items,note:str(b.note??"",0,2000),deadline,block_withdrawals:Boolean(b.block_withdrawals),status:"requested",requested_by:u.id,documents:[]},str(b.user_id),uid(),c);
      await q("UPDATE users SET kyc_status='requested',withdrawals_blocked=withdrawals_blocked OR $1 WHERE id=$2",[Boolean(b.block_withdrawals),b.user_id],c);
      await event(b.user_id,"Identity verification requested",b.note||"Please submit the requested verification documents.","kyc_requested",c);
      result.id=id;
    }else if(action==="kyc-document-review"){
      const k=await ownedRecord(str(b.id),"kyc",undefined,c);
      assert(k.status==="submitted","Only submitted documents can be reviewed");
      const status=z.enum(["approved","rejected"]).parse(b.status);
      const documents=reviewDocuments(k.required_items,k.documents,[{type:str(b.type),status,reject_reason:b.reason}]);
      await record("kyc",{...k,documents,reviewed_by:u.id},k.user_id,k.id,c);
      result.message="Document review saved";
    }else if(action==="kyc-review"){
      const k=await ownedRecord(str(b.id),"kyc",undefined,c),status=z.enum(["approved","rejected","requested"]).parse(b.status);
      assert(k.status==="submitted"||status==="requested","No submitted verification to review");
      const documents=status==="requested"?[]:reviewDocuments(k.required_items,k.documents,b.documents??[]);
      assert(status!=="approved"||(k.required_items.every((type:string)=>documents.some((d:any)=>d.type===type))&&documents.every((d:any)=>d.status!=="rejected")),"Required documents are missing or rejected");
      if(status!=="approved")str(b.reason,3,2000);
      await record("kyc",{...k,status,documents:documents.map((d:any)=>({...d,status:status==="approved"?"approved":d.status??"rejected"})),reason:b.reason??"",reviewed_by:u.id},k.user_id,k.id,c);
      await q(`UPDATE users SET kyc_status=$1,withdrawals_blocked=CASE WHEN $1='approved' THEN
        COALESCE((data->>'withdrawals_manually_blocked')::boolean,false) OR EXISTS(SELECT 1 FROM platform_records WHERE kind='kyc' AND user_id=$2 AND id<>$3 AND data->>'status' NOT IN ('approved','superseded') AND (data->>'block_withdrawals')::boolean=true)
        ELSE withdrawals_blocked END WHERE id=$2`,[status,k.user_id,k.id],c);
      await event(k.user_id,`Verification ${status}`,b.reason||"Your identity verification was approved.",`kyc_${status}`,c);
    }else if(action==="rental-stop"){str(b.reason,3,2000);await stopRental(u,b,c,true);}
    else if(action==="rental-extend"){await extendRental(u,b,c,true);}
    else if(action==="rental-pause"){
      await q("UPDATE rentals SET status='paused',data=data||$1::jsonb WHERE id=$2 AND status='active'",[JSON.stringify({paused_at:new Date().toISOString(),admin_paused:true}),str(b.id)],c);
    }else if(action==="rental-resume"){
      const [r]=await q("SELECT * FROM rentals WHERE id=$1 AND status='paused' FOR UPDATE",[str(b.id)],c);
      assert(r?.data.admin_paused,"Only a staff-paused rental can be manually resumed");
      const since=r.data.paused_at;
      await q(`UPDATE rentals SET status='active',billed_until=now()+GREATEST(interval '0 seconds',billed_until-$1::timestamptz),
        end_at=now()+GREATEST(interval '0 seconds',end_at-$1::timestamptz),data=data-'admin_paused'-'paused_at' WHERE id=$2`,[since,r.id],c);
      await event(r.user_id,"Rental resumed","An administrator resumed your rental. Previously paid unused time is preserved.","rental_resumed",c);
    }else if(action==="ticket-reply"||action==="ticket-update"){
      const t=await ownedRecord(str(b.id),"ticket",undefined,c);
      if(action==="ticket-reply"){
        t.messages.push({id:uid(),body:str(b.body,1,10000),author_type:"admin",created_at:new Date().toISOString(),is_internal:Boolean(b.is_internal),attachments:b.attachments??[]});
        if(!b.is_internal)await event(t.user_id,"Support replied",t.subject,"ticket_reply",c);
      }
      const status=z.enum(["open","awaiting_user","resolved","closed"]).parse(b.status??(action==="ticket-reply"&&!b.is_internal?"awaiting_user":t.status));
      const priority=z.enum(["low","normal","high","urgent"]).parse(b.priority??t.priority);
      await record("ticket",{...t,status,priority,assigned_to:b.assigned_to??t.assigned_to},t.user_id,t.id,c);
      if(status==="resolved"&&t.status!=="resolved")await event(t.user_id,"Support ticket resolved",t.subject,"ticket_resolved",c);
    }else if(["article-save","announcement-save","legal-save","email-template-save","canned-reply-save"].includes(action)){
      const kind=action==="article-save"?"article":action==="announcement-save"?"announcement":action==="legal-save"?"legal":action==="email-template-save"?"email_template":"canned_reply";
      const id=b.id?str(b.id):kind==="legal"?`legal-${str(b.key)}-${b.language??"en"}`:uid();
      const clean={...b};delete clean.id;
      if(kind==="article"){str(b.title,2,200);str(b.body,1,100000);str(b.slug,1,200);}
      if(kind==="email_template"){str(b.key,1,100);str(b.subject,1,200);str(b.body_html,1,100000);}
      for(const field of ["body","body_html"]){
        if(typeof clean[field]==="string")clean[field]=sanitizeHtml(clean[field],{
          allowedTags:[...sanitizeHtml.defaults.allowedTags,"img","h1","h2","span"],
          allowedAttributes:{...sanitizeHtml.defaults.allowedAttributes,img:["src","alt","width","height"],a:["href","title","target","rel"]},
          allowedSchemes:["https","mailto"],allowProtocolRelative:false,
        });
      }
      await record(kind,clean,null,id,c);result.id=id;
    }else if(action==="article-delete"||action==="announcement-delete"){
      await q("DELETE FROM platform_records WHERE id=$1 AND kind=$2",[str(b.id),action==="article-delete"?"article":"announcement"],c);
    }else if(action==="currency-save"){
      const code=z.enum(["BNB","USDT","USDC","BTC","ETH"]).parse(b.code);
      const prev=await ownedRecord(`currency-${code}`,"currency",undefined,c);
      const networks=z.array(z.object({name:z.string().min(1).max(50),enabled:z.boolean(),address:z.string().max(256),memo:z.string().max(100).optional(),memo_required:z.boolean().optional(),fallback_addresses:z.array(z.string().min(10).max(256)).max(10).optional(),address_regex:z.string().max(256).optional()}).passthrough()).max(20).parse(b.networks??prev.networks);
      assert(new Set(networks.map(n=>n.name)).size===networks.length,"Network names must be unique per currency");
      for(const n of networks){
        if(n.address_regex){
          try{
            // Keep administrator-provided expressions bounded, anchored and non-nested.
            assert(n.address_regex.startsWith("^")&&n.address_regex.endsWith("$")&&!/\([^)]*[+*][^)]*\)[+*{]/.test(n.address_regex),"Use an anchored, non-nested address expression");
            const re=new RegExp(n.address_regex);
            for(const address of [n.address,...(n.fallback_addresses??[])].filter(Boolean))assert(re.test(address),"Deposit address does not match its network expression");
          }catch(e){if(e instanceof Error&&e.message.includes("address"))throw e;assert(false,"Invalid network address expression");}
        }
        if(n.enabled)assert(n.address_regex,"Enabled networks require an address validation expression");
        if(n.memo_required&&n.address)str(n.memo,1,100);
      }
      for(const field of ["min_deposit","min_withdraw","max_withdraw","fee"])if(b[field]!==undefined)assert(/^\d+(\.\d{1,18})?$/.test(String(b[field])),"Invalid decimal value");
      const fee_type=z.enum(["flat","percent"]).parse(b.fee_type??prev.fee_type??"flat");
      const merged={...prev,...b,fee_type,networks};delete merged.request_id;
      assert(Number(merged.max_withdraw)>=Number(merged.min_withdraw),"Maximum withdrawal must not be below the minimum");
      if(fee_type==="percent")assert(Number(merged.fee)<=100,"Percentage fee cannot exceed 100");
      await record("currency",merged,null,`currency-${code}`,c);
    }else if(action==="admin-save"){
      const email=z.string().email().parse(b.email).toLowerCase(),password=z.string().min(12).max(128).parse(b.password),role=z.enum(["superadmin","finance","support"]).parse(b.role);
      const ph=await argon2.hash(password);
      await q("INSERT INTO users(id,email,username,password_hash,role,referral_code) VALUES($1,$2,$3,$4,$5,$6)",[uid(),email,b.username??email.split("@")[0],ph,role,uid().slice(0,10)],c);
    }else if(action==="email-resend"){
      await q("UPDATE email_logs SET status='queued',attempts=0,error=NULL,data=data-'next_attempt_at' WHERE id=$1 AND status<>'sending'",[str(b.id)],c);
    }else assert(false,"Unknown admin action",404);
    await audit(u,action,b.id??result.id??null,req,{reason:b.reason??null},c);
    if(requestKey)await record("request",result,u.id,requestKey,c);
  });
  res.json(result);
});
