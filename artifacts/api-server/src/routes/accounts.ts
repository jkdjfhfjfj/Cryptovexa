import { Router, type IRouter } from "express";
import argon2 from "argon2";
import { TOTP, Secret } from "otpauth";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { isIP } from "node:net";
import { verifyCaptcha } from "../lib/captcha";
import { AccountActionBody, AdminAccountActionBody } from "@workspace/api-zod";
import { q, uid, hash, config, safeUser, requireUser, newSession, session, record, token, event, assert, str, encrypt, decrypt, audit, transaction, accountLinkOrigin, accountAllowedInEnvironment } from "../lib/platform";
import { normalizeAdminGeo, recordAdminAccess, type AdminAccessEvent } from "../lib/admin-access";

export const accounts: IRouter = Router();
export const totp = (u: any, brand: string) => new TOTP({issuer:brand,label:u.email,algorithm:"SHA1",digits:6,period:30,secret:Secret.fromBase32(decrypt(u.twofa_secret))});
export async function checkTwofa(u: any, code: unknown, brand: string, conn?:any):Promise<void> {
  if(!conn)return transaction(c=>checkTwofa(u,code,brand,c));
  assert(u.twofa_secret && typeof code === "string", "Enter your authenticator code");
  await q("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`totp:${u.id}`],conn);
  const valid = totp(u, brand).validate({token:code,window:1}) !== null;
  if (valid) {
    // Prevent replay of a TOTP within the validity window.
    const codeHash = hash(`${u.id}:${code}`);
    const [exists] = await q("SELECT id FROM security_tokens WHERE user_id=$1 AND kind='totp_used' AND hash=$2 AND expires_at>now()", [u.id,codeHash],conn);
    assert(!exists,"This code was already used. Wait for the next code.");
    await q("INSERT INTO security_tokens(id,user_id,kind,hash,expires_at) VALUES($1,$2,'totp_used',$3,now()+interval '90 seconds')",[uid(),u.id,codeHash],conn);
    return;
  }
  const [recovery] = await q("UPDATE security_tokens SET used=true WHERE user_id=$1 AND kind='recovery' AND hash=$2 AND used=false RETURNING id",[u.id,hash(code)],conn);
  assert(recovery, "Invalid or expired authenticator code");
}

async function safeAdminAccessRecord(
  req: Parameters<typeof recordAdminAccess>[0],
  event: AdminAccessEvent,
  email: string | null,
  geo?: unknown,
  userId: string | null = null,
): Promise<void> {
  try {
    await recordAdminAccess(req, event, email, geo, userId);
  } catch {
    req.log?.error({ event }, "Could not record administrator access event");
  }
}

accounts.post(["/v1/auth/:action","/admin/auth/:action"], async (req,res): Promise<void> => {
  const isAdmin = req.path.startsWith("/admin"), scope = isAdmin ? "admin" : "user";
  const b = (isAdmin ? AdminAccountActionBody : AccountActionBody).passthrough().parse(req.body) as Record<string, any>;
  const action = String(req.params.action);
  if (isAdmin && action === "access") {
    const eventId = await recordAdminAccess(req, "page_access");
    res.json({ success: true, message: "Access event recorded", event_id: eventId });
    return;
  }
  if (isAdmin && action === "location") {
    const geo = normalizeAdminGeo(b.geo);
    assert(geo, "A valid browser location is required");
    const eventId = await recordAdminAccess(req, "location_shared", null, geo);
    res.json({ success: true, message: "Location event recorded", event_id: eventId });
    return;
  }
  const cfg = await config(true);
  const linkOrigin=["register","forgot-password","resend-verification"].includes(action)?accountLinkOrigin(req):undefined;
  let result: any = {success:true,message:"Saved"};
  if (action === "register" || (isAdmin && action === "setup")) {
    assert(action !== "register" || !isAdmin, "Use the admin setup flow");
    assert(action === "setup" || cfg.registration_mode !== "closed", "Registration is currently closed");
    if (action === "setup") {
      assert(process.env.NODE_ENV !== "production", "Admin setup is only available in the private development preview",403);
      assert(!(await q("SELECT id FROM users WHERE role!='user' LIMIT 1")).length, "An administrator already exists",403);
    } else {
      await verifyCaptcha(req,cfg);
      assert(b.terms === true, "Accept the Terms, Privacy Policy and Risk Disclosure");
      if (cfg.registration_mode === "invite-only") assert(b.referral, "A referral code is required");
    }
    const email = z.string().email().max(254).parse(b.email).toLowerCase();
    const password = z.string().min(12,"Use at least 12 characters").max(128).parse(b.password);
    const username = z.string().min(2).max(50).parse(b.username);
    const passwordHash = await argon2.hash(password, {type:argon2.argon2id});
    const user = await transaction(async c => {
      await q("SELECT pg_advisory_xact_lock(735741)",[],c);
      if(action === "setup") assert(!(await q("SELECT id FROM users WHERE role!='user' LIMIT 1",[],c)).length,"An administrator already exists",403);
      assert(!(await q("SELECT id FROM users WHERE email=$1",[email],c)).length,"An account with this email already exists");
      let ref = null;
      if(b.referral) {
        const [r] = await q("SELECT * FROM users WHERE referral_code=$1 AND status='active'",[b.referral],c);
        assert(r,"Invalid referral code"); ref=r.id;
        assert(r.email!==email,"Self referrals are not allowed");
      }
      const [u] = await q(`INSERT INTO users(id,email,username,password_hash,role,referral_code,referred_by,data)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb) RETURNING *`,
        [uid(),email,username,passwordHash,action==="setup"?"superadmin":"user",randomBytes(5).toString("hex").toUpperCase(),ref,JSON.stringify({terms_accepted_at:new Date().toISOString()})],c);
      for (const currency of ["BNB","USDT","USDC","BTC","ETH"]) await q("INSERT INTO wallets(id,user_id,currency) VALUES($1,$2,$3)",[uid(),u.id,currency],c);
      if(ref) {
        let ancestor=ref;
        for(let level=1;ancestor&&level<=3;level++){
          const sameIp=(await q("SELECT id FROM login_sessions WHERE user_id=$1 AND ip=$2 LIMIT 1",[ancestor,req.ip],c)).length>0;
          await record("referral",{referrer_id:ancestor,referred_id:u.id,username,level,email:email.replace(/^(.).+(@.+)$/,"$1***$2"),suspicious:sameIp,flag:sameIp?"Shared sign-in IP; review before payout":null},ancestor,uid(),c);
          const [parent]=await q("SELECT referred_by FROM users WHERE id=$1",[ancestor],c);ancestor=parent?.referred_by;
        }
        await event(ref,"A friend joined","A new member joined using your referral link.","referral_signup",c);
      }
      await event(u.id,"Welcome to "+cfg.site_name,"Your account is ready. Secure it with two-factor authentication.","welcome",c);
      if(action==="setup") await audit(u,"admin_setup",u.id,req,{},c);
      return u;
    });
    await newSession(req,res,user.id,scope);
    if (isAdmin && action === "setup") await safeAdminAccessRecord(req, "admin_setup", user.email, b.geo, user.id);
    if(action!=="setup") {
      const code=await token(user.id,"verify");
      await event(user.id,"Verify your email","Confirm your email address to secure your account.","verify_email",undefined,{token:code,path:"/verify-email",origin:linkOrigin});
    }
    result={success:true,message:action==="setup"?"Administrator created":"Account created. Verification email has been queued.",user:safeUser(user)};
  } else if(action==="login") {
    let email:string;
    try {
      email=z.string().email().parse(b.email).toLowerCase();
    } catch (error) {
      if(isAdmin) await safeAdminAccessRecord(req,"login_failed",typeof b.email==="string"?b.email:null,b.geo);
      throw error;
    }
    const [u]=await q("SELECT * FROM users WHERE email=$1",[email]);
    if(!isAdmin)await verifyCaptcha(req,cfg,u?.id,Boolean(b.code));
    const lockedUntil=u?.data?.login_locked_until;
    if(lockedUntil&&new Date(lockedUntil).getTime()>Date.now()){
      if(isAdmin)await safeAdminAccessRecord(req,"login_failed",email,b.geo,u?.role&&u.role!=="user"?u.id:null);
      assert(false,"This account is temporarily locked after repeated failed sign-ins. Try again in 15 minutes.",429);
    }
    // A fixed dummy hash calculation makes missing-account and wrong-password paths comparable.
    const correct=u ? await argon2.verify(u.password_hash,String(b.password??"")) : (await argon2.hash(String(b.password??"")),false);
    if(!(u&&correct&&accountAllowedInEnvironment(u)&&u.status==="active"&&(!isAdmin||u.role!=="user"))){
      if(u){
        const failures=Number(u.data.login_failures??0)+1,limit=Math.max(3,Math.min(20,Number(cfg.login_lockout_attempts??5)));
        await q("UPDATE users SET data=data||$1::jsonb WHERE id=$2",[JSON.stringify({login_failures:failures,login_locked_until:failures>=limit?new Date(Date.now()+15*60000).toISOString():null}),u.id]);
      }
      if(isAdmin)await safeAdminAccessRecord(req,"login_failed",email,b.geo,u?.role&&u.role!=="user"?u.id:null);
      assert(false,"Invalid email or password",401);
    }
    if(u.twofa_enabled&&!b.code){
      if(isAdmin)await safeAdminAccessRecord(req,"twofa_challenge",u.email,b.geo,u.id);
      res.json({success:true,requires2fa:true,message:"Enter your authenticator code"});return;
    }
    if(u.twofa_enabled) {
      try{await checkTwofa(u,b.code,cfg.site_name);}
      catch(e){
        await q(`UPDATE users SET data=data||jsonb_build_object('login_failures',COALESCE((data->>'login_failures')::integer,0)+1,
          'login_locked_until',CASE WHEN COALESCE((data->>'login_failures')::integer,0)+1>=$2 THEN to_jsonb(now()+interval '15 minutes') ELSE 'null'::jsonb END) WHERE id=$1`,[u.id,Math.max(3,Math.min(20,Number(cfg.login_lockout_attempts??5)))]);
        if(isAdmin)await safeAdminAccessRecord(req,"twofa_failed",u.email,b.geo,u.id);
        throw e;
      }
    }
    if(!isAdmin&&cfg.captcha_enabled)await q("UPDATE security_tokens SET used=true WHERE user_id=$1 AND kind='login_captcha'",[u.id]);
    await q("UPDATE users SET data=data||'{\"login_failures\":0,\"login_locked_until\":null}'::jsonb WHERE id=$1",[u.id]);
    await newSession(req,res,u.id,scope);
    if(isAdmin)await audit(u,"admin_login",u.id,req);
    if(isAdmin)await safeAdminAccessRecord(req,"login_success",u.email,b.geo,u.id);
    await event(u.id,"New sign-in","A device signed in to your account. Review active sessions if this was not you.","new_login");
    result={success:true,message:"Welcome back",user:safeUser(u)};
  } else if(action==="forgot-password") {
    await verifyCaptcha(req,cfg);
    const email=z.string().email().parse(b.email).toLowerCase();
    const [u]=await q("SELECT * FROM users WHERE email=$1",[email]);
    if(u){const code=await token(u.id,"reset");await event(u.id,"Reset your password","Your reset link expires in one hour.","password_reset",undefined,{token:code,path:"/reset-password",origin:linkOrigin});}
    result.message="If an account exists, a password reset email has been queued.";
  } else if(action==="reset-password" || action==="verify-email") {
    const kind=action==="reset-password"?"reset":"verify";
    await transaction(async c=>{
      const [t]=await q("SELECT * FROM security_tokens WHERE hash=$1 AND kind=$2 AND used=false AND expires_at>now() FOR UPDATE",[hash(str(b.token)),kind],c);
      assert(t,"This link is invalid or expired");
      if(kind==="reset"){
        const ph=await argon2.hash(z.string().min(12).max(128).parse(b.password));
        await q("UPDATE users SET password_hash=$1,data=data||'{\"login_failures\":0,\"login_locked_until\":null}'::jsonb WHERE id=$2",[ph,t.user_id],c);
        await q("UPDATE login_sessions SET revoked=true WHERE user_id=$1",[t.user_id],c);
      } else await q("UPDATE users SET email_verified=true WHERE id=$1",[t.user_id],c);
      await q("UPDATE security_tokens SET used=true WHERE id=$1",[t.id],c);
      await event(t.user_id,kind==="reset"?"Password updated":"Email verified","Your account security has been updated.",kind==="reset"?"password_changed":"email_verified",c);
    });
    result.message=kind==="reset"?"Password updated. Please sign in.":"Email verified";
  } else {
    const u=await requireUser(req,scope);
    if(action==="logout"){
      await q("UPDATE login_sessions SET revoked=true WHERE id=$1",[u.session_id]);
      res.clearCookie(isAdmin?"vexa_admin":"vexa_user",{path:"/",httpOnly:true,secure:true,sameSite:"lax"});
      result.message="Signed out";
    } else if(action==="resend-verification"){
      const code=await token(u.id,"verify");
      await event(u.id,"Verify your email","Confirm your email to secure your account.","verify_email",undefined,{token:code,path:"/verify-email",origin:linkOrigin});
      result.message="Verification email queued";
    } else if(action==="change-password"){
      assert(await argon2.verify(u.password_hash,String(b.currentPassword)),"Current password is incorrect");
      await q("UPDATE users SET password_hash=$1 WHERE id=$2",[await argon2.hash(z.string().min(12).max(128).parse(b.password)),u.id]);
      await q("UPDATE login_sessions SET revoked=true WHERE user_id=$1 AND id!=$2",[u.id,u.session_id]);
      await event(u.id,"Password changed","Your password was updated. Other sessions have been signed out.","password_changed");
    } else if(action==="update-profile"){
      const lang=z.enum(["en","es","fr","pt","ar","sw","zh","hi"]).parse(b.language??u.language);
      await q("UPDATE users SET username=$1,language=$2 WHERE id=$3",[b.username?str(b.username,2,50):u.username,lang,u.id]);
    } else if(action==="revoke-session"){
      await q("UPDATE login_sessions SET revoked=true WHERE id=$1 AND user_id=$2",[str(b.id),u.id]);
    } else if(action==="twofa-setup"){
      assert((isAdmin?cfg.admin_twofa_mode:cfg.twofa_mode)!=="off","Two-factor authentication is disabled");
      assert(!u.twofa_enabled,"Two-factor authentication is already enabled");
      const secret=new Secret({size:20}), recoveryCodes=Array.from({length:8},()=>randomBytes(6).toString("hex"));
      await q("UPDATE users SET twofa_secret=$1 WHERE id=$2",[encrypt(secret.base32),u.id]);
      await q("DELETE FROM security_tokens WHERE user_id=$1 AND kind='recovery'",[u.id]);
      for(const code of recoveryCodes)await q("INSERT INTO security_tokens(id,user_id,kind,hash,expires_at) VALUES($1,$2,'recovery',$3,now()+interval '10 years')",[uid(),u.id,hash(code)]);
      const generator=new TOTP({issuer:cfg.site_name,label:u.email,secret});
      result={...result,secret:secret.base32,uri:generator.toString(),recoveryCodes,message:"Scan the QR and enter a code to finish enabling 2FA"};
    } else if(action==="twofa-enable" || action==="twofa-disable"){
      assert(action!=="twofa-disable" || (isAdmin?cfg.admin_twofa_mode:cfg.twofa_mode)!=="required","Two-factor authentication is required");
      await checkTwofa(u,b.code,cfg.site_name);
      await q("UPDATE users SET twofa_enabled=$1 WHERE id=$2",[action==="twofa-enable",u.id]);
      await event(u.id,"Two-factor authentication updated","Your account's two-factor authentication setting changed.","twofa_changed");
    } else if(action==="api-key-create"){
      assert(cfg.api_keys_enabled,"API keys are disabled");
      const key="vexa_"+randomBytes(32).toString("hex");
      const ips=z.array(z.string().refine(s=>isIP(s)!==0,"Use exact IPv4 or IPv6 addresses")).max(50).parse(b.ip_allowlist??[]);
      await record("api_key",{name:str(b.name,1,100),key_hash:hash(key),scopes:["read-only"],ip_allowlist:ips,revoked:false},u.id);
      result={...result,key,message:"Copy this read-only key now. It will not be shown again."};
    } else if(action==="api-key-revoke"){
      await q("UPDATE platform_records SET data=jsonb_set(data,'{revoked}','true') WHERE id=$1 AND kind='api_key' AND user_id=$2",[str(b.id),u.id]);
    } else assert(false,"Unknown account action",404);
    if(isAdmin)await audit(u,`admin_auth_${action}`,u.id,req);
  }
  res.json(result);
});
