import type { Request } from "express";
import { assert, hash, q, uid } from "./platform";

export async function verifyCaptcha(req:Request,cfg:any,userId?:string,continuation=false) {
  if(!cfg.captcha_enabled)return;
  assert(cfg.captcha_site_key&&cfg.captcha_secret,"CAPTCHA is enabled but not fully configured",503);
  const token=req.body.captcha_token;
  assert(typeof token==="string"&&token.length>0&&token.length<=4096,"Complete the security challenge");
  if(continuation&&userId){
    const [verified]=await q("SELECT id FROM security_tokens WHERE user_id=$1 AND kind='login_captcha' AND hash=$2 AND used=false AND expires_at>now()",[userId,hash(token)]);
    if(verified)return;
  }
  let response:any;
  try{
    const r=await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify",{
      method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},
      body:new URLSearchParams({secret:cfg.captcha_secret,response:token,...(req.ip?{remoteip:req.ip}:{})}),signal:AbortSignal.timeout(10000),
    });
    assert(r.ok,"Security challenge service is unavailable",503);
    response=await r.json();
  }catch{assert(false,"Security challenge could not be verified. Try again.",503);}
  const origin=req.get("origin"),hostname=origin?new URL(origin).hostname:req.hostname;
  assert(response.success===true&&response.hostname===hostname,"Security challenge expired or failed. Try again.");
  if(userId)await q("INSERT INTO security_tokens(id,user_id,kind,hash,expires_at) VALUES($1,$2,'login_captcha',$3,now()+interval '5 minutes')",[uid(),userId,hash(token)]);
}
