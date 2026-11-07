import { pool, db, settings, assets, records } from "@workspace/db";
import { randomUUID, createHash, createHmac, randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
import { z } from "zod";
import type { Request, Response } from "express";
import argon2 from "argon2";

export const uid = () => randomUUID();
export const hash = (s: string) => createHash("sha256").update(s).digest("hex");
export const secretKey = (purpose: string) => {
  if (!process.env.SESSION_SECRET) throw new Error("SESSION_SECRET is required");
  return createHmac("sha256", process.env.SESSION_SECRET).update(`vexa:${purpose}:v1`).digest();
};
export function encrypt(value: string): string {
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", secretKey("settings"), iv);
  const out = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [iv.toString("hex"), cipher.getAuthTag().toString("hex"), out.toString("hex")].join(".");
}
export function decrypt(value: string): string {
  const [iv, tag, body] = value.split(".");
  const cipher = createDecipheriv("aes-256-gcm", secretKey("settings"), Buffer.from(iv!, "hex"));
  cipher.setAuthTag(Buffer.from(tag!, "hex"));
  return Buffer.concat([cipher.update(Buffer.from(body!, "hex")), cipher.final()]).toString("utf8");
}
export class AppError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
export function assert(condition: unknown, message: string, status = 400): asserts condition {
  if (!condition) throw new AppError(message, status);
}
/** Reject password-reset/verification Origin poisoning before looking up an account. */
export function accountLinkOrigin(req:Request) {
  const host=req.get("host");
  assert(host,"Application host is unavailable",400);
  const expected=new URL(`https://${host}`);
  let origin:URL;
  try{origin=new URL(req.get("origin")||expected.origin);}catch{throw new AppError("Invalid request origin",403);}
  const devHost=process.env.NODE_ENV!=="production"?process.env.REPLIT_DEV_DOMAIN:undefined;
  assert((origin.host===expected.host||origin.host===devHost)&&!origin.username&&!origin.password&&origin.pathname==="/"&&!origin.search&&!origin.hash&&
    (origin.protocol==="https:"||(process.env.NODE_ENV!=="production"&&origin.protocol==="http:")),
    "Request origin must match this application",403);
  return origin.origin;
}
export const amountSchema = z.string().regex(/^(?:0|[1-9]\d{0,17})(?:\.\d{1,18})?$/, "Use a positive decimal amount");
export const amount = (v: unknown) => {
  assert(typeof v==="string","Send money amounts as decimal strings");
  const s = amountSchema.parse(v);
  assert(!/^0(?:\.0*)?$/.test(s), "Amount must be greater than zero");
  return s;
};
export const str = (v: unknown, min = 1, max = 10000) => z.string().min(min).max(max).parse(v);
export async function q(text: string, values: any[] = [], c: any = pool): Promise<any[]> {
  return (await c.query(text, values)).rows;
}
export async function transaction<T>(fn: (c: any) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try { await c.query("BEGIN"); const result = await fn(c); await c.query("COMMIT"); return result; }
  catch (e) { await c.query("ROLLBACK"); throw e; }
  finally { c.release(); }
}
export async function config(secret = false, c: any = pool): Promise<Record<string, any>> {
  const rows = await q("SELECT * FROM settings", [], c);
  return Object.fromEntries(rows.filter((r) => secret || !r.is_secret).map((r) => [r.key, r.is_secret ? decrypt(r.value) : r.value]));
}
export async function putSetting(key: string, value: any, isSecret = false, c: any = pool) {
  await q("INSERT INTO settings(key,value,is_secret) VALUES($1,$2::jsonb,$3) ON CONFLICT(key) DO UPDATE SET value=excluded.value,is_secret=excluded.is_secret",
    [key, JSON.stringify(isSecret ? encrypt(String(value)) : value), isSecret], c);
}
export const safeUser = (u: any) => {
  if (!u) return null;
  const { password_hash, twofa_secret, data, ...rest } = u;
  return { ...rest, preferences: data?.preferences ?? {} };
};
export function accountAllowedInEnvironment(user:any,environment=process.env.NODE_ENV){
  return !!user&&!(environment==="production"&&user.data?.preview_default===true);
}
export async function session(req: Request, scope = "user"): Promise<any | null> {
  if(scope==="user"&&req.method==="GET"&&req.get("authorization")?.startsWith("Bearer vexa_")){
    const [setting]=await q("SELECT value FROM settings WHERE key='api_keys_enabled'");
    if(!setting?.value)return null;
    const key=req.get("authorization")!.slice(7);
    const [r]=await q(`SELECT * FROM platform_records WHERE kind='api_key' AND data->>'key_hash'=$1 AND COALESCE((data->>'revoked')::boolean,false)=false`,[hash(key)]);
    if(r){
      const ips=r.data.ip_allowlist??[];
      if(ips.length&&!ips.includes(req.ip))return null;
      await q("UPDATE platform_records SET data=data||$1::jsonb WHERE id=$2",[JSON.stringify({last_used:new Date().toISOString()}),r.id]);
      const [u]=await q("SELECT * FROM users WHERE id=$1 AND status='active'",[r.user_id]);return accountAllowedInEnvironment(u)?u:null;
    }
  }
  const raw = req.cookies?.[scope === "admin" ? "vexa_admin" : "vexa_user"];
  if (!raw) return null;
  const [row] = await q(`SELECT u.*,s.id AS session_id FROM login_sessions s JOIN users u ON u.id=s.user_id
    WHERE s.token_hash=$1 AND s.scope=$2 AND s.revoked=false AND s.expires_at>now() AND u.status='active'`, [hash(`${scope}:${raw}`), scope]);
  return accountAllowedInEnvironment(row)?row:null;
}
export async function requireUser(req: Request, scope = "user") {
  const u = await session(req, scope);
  assert(u, "Please sign in to continue", 401);
  if (scope === "admin") assert(["superadmin","finance","support"].includes(u.role), "Administrator access required", 403);
  return u;
}
export async function newSession(req: Request, res: Response, userId: string, scope: string) {
  const token = randomBytes(32).toString("hex");
  await q(`INSERT INTO login_sessions(id,user_id,token_hash,scope,ip,device,expires_at) VALUES($1,$2,$3,$4,$5,$6,now()+interval '7 days')`,
    [uid(), userId, hash(`${scope}:${token}`), scope, req.ip, (req.get("user-agent") ?? "").slice(0, 500)]);
  res.cookie(scope === "admin" ? "vexa_admin" : "vexa_user", token, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 604800000 });
}
export async function record(kind: string, data: any, userId: string | null = null, id: string = uid(), c: any = pool) {
  await q(`INSERT INTO platform_records(id,kind,user_id,data) VALUES($1,$2,$3,$4::jsonb)
    ON CONFLICT(id) DO UPDATE SET data=excluded.data WHERE platform_records.kind=excluded.kind`, [id, kind, userId, JSON.stringify(data)], c);
  return id;
}
export const unpack = (r: any) => ({ ...r.data, id: r.id, user_id: r.user_id, created_at: r.created_at });
export async function getRecords(kind: string, userId?: string, c: any = pool) {
  return (await q(`SELECT * FROM platform_records WHERE kind=$1 ${userId ? "AND user_id=$2" : ""} ORDER BY created_at DESC`, userId ? [kind, userId] : [kind], c)).map(unpack);
}
export async function ownedRecord(id: string, kind: string, userId?: string, c: any = pool) {
  const [r] = await q(`SELECT * FROM platform_records WHERE id=$1 AND kind=$2 ${userId ? "AND user_id=$3" : ""} FOR UPDATE`, userId ? [id, kind, userId] : [id, kind], c);
  assert(r, "Record not found", 404); return unpack(r);
}
export async function audit(u: any, action: string, entityId: string | null, req?: Request, meta: any = {}, c: any = pool) {
  await q("INSERT INTO audit_logs(id,actor_id,actor_role,action,entity_id,ip,meta) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)",
    [uid(), u.id, u.role, action, entityId, req?.ip ?? "worker", JSON.stringify(meta)], c);
}
/** Must be called inside the same transaction that performs and records an action. */
export async function replayRequest(c:any,key:string) {
  await q("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[key],c);
  const [saved]=await q("SELECT data FROM platform_records WHERE id=$1 AND kind='request'",[key],c);
  return saved?.data;
}
export async function event(userId: string, title: string, body: string, template: string, c: any = pool, extra: any = {}) {
  const sensitive=["withdrawal_confirmation","verify_email","password_reset"].includes(template);
  await record("notification", { title, body:sensitive?"A security email has been queued for your registered address.":body, read: false }, userId, uid(), c);
  const [u] = await q("SELECT email,language,data FROM users WHERE id=$1", [userId], c);
  const category=template.startsWith("deposit")?"deposits":template.startsWith("withdrawal")||template==="large_withdrawal"?"withdrawals":template.startsWith("rental")?"rentals":template.startsWith("referral")||template==="commission_earned"?"referrals":"security";
  // Security/recovery messages cannot be opted out of. In-app records always remain available.
  const preference=u?.data?.preferences?.notifications;
  if (u&&(category==="security"||preference?.[category]!==false)) await q("INSERT INTO email_logs(id,\"to\",template,data) VALUES($1,$2,$3,$4::jsonb)", [uid(), u.email, template, JSON.stringify({ title, body,language:u.language, ...extra })], c);
  const adminAlerts:Record<string,string>={deposit_submitted:"finance",withdrawal_requested:"finance",withdrawal_manual:"finance",large_withdrawal:"finance",ticket_created:"support",kyc_submitted:"support",reconciliation_mismatch:"finance"};
  if(adminAlerts[template]){
    const admins=await q("SELECT id,email FROM users WHERE role IN ('superadmin',$1) AND status='active'",[adminAlerts[template]],c);
    const recipients=new Set<string>();
    for(const admin of admins){
      await record("notification",{title,body:"An item needs your review in the administration console.",read:false},admin.id,uid(),c);
      recipients.add(admin.email);
    }
    const cfg=await config(false,c),notices=cfg.notifications??{};
    const field=template.startsWith("deposit")?"deposit_alert_emails":template.includes("withdrawal")?"withdrawal_alert_emails":template==="ticket_created"?"ticket_alert_emails":template==="kyc_submitted"?"kyc_alert_emails":"reconcile_alert_emails";
    const emails=notices[field]??notices.alert_emails??[];
    for(const email of Array.isArray(emails)?emails:String(emails).split(/[,;\n]/))if(z.string().email().safeParse(email.trim()).success)recipients.add(email.trim());
    for(const email of recipients)await q('INSERT INTO email_logs(id,"to",template,data) VALUES($1,$2,$3,$4::jsonb)',[uid(),email,`admin_${template}`,JSON.stringify({title,body:"An item needs review in the administration console."})],c);
    if(notices.telegram_chat_id)await record("telegram_outbox",{title,body:"An item needs review in the administration console.",status:"queued",attempts:0},null,uid(),c);
  }
}
// Wallet rows are locked and every balance update is paired with a unique ledger entry.
export async function move(c: any, userId: string, currency: string, value: string, type: string, refId: string, key: string, lockedDelta = "0") {
  await q("INSERT INTO wallets(id,user_id,currency) VALUES($1,$2,$3) ON CONFLICT(user_id,currency) DO NOTHING", [uid(), userId, currency], c);
  const [w] = await q("SELECT * FROM wallets WHERE user_id=$1 AND currency=$2 FOR UPDATE", [userId, currency], c);
  const [existing] = await q("SELECT * FROM ledger WHERE idempotency_key=$1", [key], c);
  if (existing) return existing;
  const [updated] = await q(`UPDATE wallets SET balance=balance+$1::numeric,locked=locked+$2::numeric
    WHERE id=$3 AND balance+$1::numeric>=0 AND locked+$2::numeric>=0 AND balance+$1::numeric>=locked+$2::numeric RETURNING *`,
    [value, lockedDelta, w.id], c);
  assert(updated, "Insufficient available balance");
  const [entry] = await q(`INSERT INTO ledger(id,user_id,currency,amount,type,ref_id,idempotency_key,balance_after)
    VALUES($1,$2,$3,$4::numeric,$5,$6,$7,$8::numeric) RETURNING *`,
    [uid(), userId, currency, value, type, refId, key, updated.balance], c);
  return entry;
}
export async function token(userId: string, kind: string, data: any = {}, code = randomBytes(32).toString("hex"), c: any = pool) {
  await q("UPDATE security_tokens SET used=true WHERE user_id=$1 AND kind=$2", [userId, kind], c);
  await q("INSERT INTO security_tokens(id,user_id,kind,hash,expires_at,data) VALUES($1,$2,$3,$4,now()+interval '1 hour',$5::jsonb)",
    [uid(), userId, kind, hash(code), JSON.stringify(data)], c);
  return code;
}
export const defaultSettings: Record<string, any> = {
  site_name: "MyCryptoVexa", short_name: "Vexa", brand_color: "#14B8A6",
  logo: "", favicon: "/brand-icon.svg", app_icon: "/brand-icon.svg", maintenance: false,
  registration_mode: "open", twofa_mode: "optional", admin_twofa_mode: "optional", api_keys_enabled: true,
  force_manual: true, email_verification_required: false, txid_required: true,
  deposit_terms: "Only send the selected currency on the selected network. Deposits are credited after manual verification. Transfers may be irreversible.",
  withdrawal_terms: "Verify the network and destination carefully. Cryptocurrency transfers cannot be reversed. Fees apply.",
  billing: { proration: true, early_stop_penalty: "0", grace_minutes: 15, low_balance_threshold: "10", minimum_charge: "0" },
  withdrawal_rules: { cooldown_hours: 24, daily_user_limit: "10000", daily_global_limit: "100000", auto_threshold: "1000", blacklist: [] },
  referral_config: { enabled: true, levels: 1, percentages: ["5","2","1"], trigger: "first_deposit", cap: "1000" },
  security: { captcha_enabled: false, registration_mode: "open" },
  smtp: { host: "", port: 587, username: "", from_email: "", from_name: "", tls: false },
  binance: { deposit_hints: false }, notifications: {}, translations: {},
};
export async function seedPlatform() {
  // Production does not expose the first-admin preview setup route.
  if(process.env.ADMIN_EMAIL&&process.env.ADMIN_PASSWORD&&!(await q("SELECT id FROM users WHERE role!='user' AND COALESCE((data->>'preview_default')::boolean,false)=false LIMIT 1")).length){
    const password=str(process.env.ADMIN_PASSWORD,12,128);
    await q("INSERT INTO users(id,email,username,password_hash,role,referral_code,email_verified) VALUES($1,$2,$3,$4,'superadmin',$5,true) ON CONFLICT(email) DO NOTHING",
      [uid(),process.env.ADMIN_EMAIL.toLowerCase(),"Administrator",await argon2.hash(password),uid().slice(0,10)]);
  }
  for (const [key, value] of Object.entries(defaultSettings)) {
    await db.insert(settings).values({ key, value }).onConflictDoNothing();
  }
  const currencies = [
    ["BNB", "BNB", ["BEP20"], "0.001", "0.002", "0.0005"],
    ["USDT", "Tether", ["TRC20", "BEP20", "ERC20"], "5", "10", "1"],
    ["USDC", "USD Coin", ["ERC20", "BEP20"], "5", "10", "1"],
    ["BTC", "Bitcoin", ["Bitcoin"], "0.0001", "0.0002", "0.00005"],
    ["ETH", "Ethereum", ["ERC20"], "0.001", "0.005", "0.001"],
  ];
  for (const [code, name, networks, minDeposit, minWithdraw, fee] of currencies) {
    await db.insert(records).values({ id: `currency-${code}`, kind: "currency", data: {
      code, name, enabled: true, min_deposit: minDeposit, min_withdraw: minWithdraw, max_withdraw: "100000", fee,
      networks: (networks as string[]).map((n) => ({ name: n, enabled: true, address: "", memo: "", address_regex: n === "TRC20" ? "^T[1-9A-HJ-NP-Za-km-z]{33}$" : n === "Bitcoin" ? "^(bc1|[13])[a-zA-HJ-NP-Z0-9]{25,87}$" : "^0x[a-fA-F0-9]{40}$" })),
    } }).onConflictDoNothing();
  }
  const items = [
    { id:"asset-loft", type:"property",title:"The Skyline Loft",description:"A considered workspace above the city. Floor-to-ceiling windows, dedicated fiber and room for your next big idea.",location:"Dubai, UAE",category:"Workspaces",specs:{"Area":"120 m²","Capacity":"6 guests","Wi-Fi":"1 Gbps"},minuteRate:"0.50",hourRate:"25",dayRate:"180",totalUnits:4,availableUnits:4 },
    { id:"asset-gpu", type:"machine",title:"NVIDIA A100 Compute",description:"Dedicated GPU compute for demanding training and inference workloads. Rental reserves capacity; provisioning is coordinated by support.",location:"Frankfurt, Germany",category:"Compute",specs:{"GPU":"NVIDIA A100","VRAM":"80 GB","CPU":"32 vCPU"},minuteRate:"0.08",hourRate:"4.50",dayRate:"95",totalUnits:12,availableUnits:12 },
    { id:"asset-villa", type:"property",title:"Palm Residence",description:"A private coastal residence with a dedicated work area and room to recharge.",location:"Bali, Indonesia",category:"Residences",specs:{"Bedrooms":"3","Capacity":"6 guests","Area":"220 m²"},minuteRate:"0.75",hourRate:"35",dayRate:"250",totalUnits:2,availableUnits:2 },
    { id:"asset-printer", type:"machine",title:"Precision 3D Studio",description:"Professional additive manufacturing capacity for prototyping. Arrange material and production details with support.",location:"Amsterdam, Netherlands",category:"Production",specs:{"Technology":"FDM","Build volume":"300 × 300 × 300 mm"},minuteRate:"0.12",hourRate:"6",dayRate:"120",totalUnits:6,availableUnits:6 },
  ];
  for (const item of items) await db.insert(assets).values({...item,currency:"USDT"}).onConflictDoNothing();
  const articles = [
    ["getting-started","Getting started with your account","Getting started","Create an account, review the risk disclosure and secure your account with two-factor authentication. Fund your wallet only after the administrator has configured a verified deposit address."],
    ["deposits","How crypto deposits work","Wallet & payments","Choose your coin and network. Send funds to the displayed address, then select I have completed deposit. Submit the exact amount and transaction ID. An administrator verifies and credits your deposit; deposits are never credited automatically."],
    ["withdrawals","Withdrawing your crypto","Wallet & payments","Save a destination address and wait for the 24-hour security cooldown. Check fees and network before submitting. Verify the emailed code or your authenticator. Administrators can process withdrawals manually when automatic service is unavailable."],
    ["rentals","Minute, hour or day?","Rentals","Choose the billing mode that fits your use. Minute rentals are charged as time passes. Hourly and daily rentals prepay their period. Rates are fixed when you book. If your balance is too low, your rental may pause and then stop."],
    ["referrals","Invite friends responsibly","Referrals","Share your unique link. Commissions depend on the administrator's current settings. Earnings are never guaranteed. Self-referrals are not permitted."],
    ["security","Protecting your account","Security","Use a strong unique password and enable two-factor authentication. Review active sessions, revoke unknown devices and never share recovery codes."],
    ["kyc","Identity verification explained","Verification","If verification is requested, upload only the specified documents through the secure upload flow. Staff review your documents and may request clearer images. Withdrawals may be blocked until approval."],
    ["troubleshooting","Need a hand?","Support","If a payment is delayed, open a support ticket with its transaction ID. Do not share passwords or private keys. Our support team can review your account and payment status."],
  ];
  for (const [slug,title,category,body] of articles) await db.insert(records).values({ id:`article-${slug}`,kind:"article",data:{slug,title,category,body,language:"en",published:true,helpful_yes:0,helpful_no:0} }).onConflictDoNothing();
  const legal: Record<string,string> = {
    terms: "By using {{site_name}}, you agree to the rental terms, payment rules and acceptable-use requirements. Rentals reserve listed resources and do not promise investment income. Availability is subject to verification. Contact support about disputes. This draft requires jurisdiction-specific legal review before launch.",
    privacy: "{{site_name}} processes account details, rental history, payment information and requested identity documents to provide and secure the service. Identity documents are restricted to authorized staff. Contact support to request access, correction or deletion where applicable. This draft requires legal review before launch.",
    risk: "Cryptocurrency involves significant risk. Prices may change sharply, network transfers can be irreversible, and funds may be lost by selecting the wrong address or network. Returns are not guaranteed. Renting assets is not a promise of profit. Do not commit funds you cannot afford to lose.",
  };
  for (const [key,body] of Object.entries(legal)) await db.insert(records).values({id:`legal-${key}-en`,kind:"legal",data:{key,language:"en",body}}).onConflictDoNothing();
  await db.insert(records).values({id:"welcome",kind:"announcement",data:{title:"Your next space. Your next possibility.",body:"Explore properties and machines. Rent on your terms, pay with crypto.",type:"info",active:true}}).onConflictDoNothing();
  const templates=["welcome","verify_email","password_reset","password_changed","new_login","twofa_changed","twofa_reset","account_updated",
    "deposit_submitted","deposit_approved","deposit_rejected","deposit_info","withdrawal_requested","withdrawal_confirmation","withdrawal_sent","withdrawal_rejected","withdrawal_manual",
    "rental_started","rental_extended","rental_completed","rental_stopped","rental_low_balance","rental_auto_renewed","rental_resumed","rental_ending_soon",
    "referral_signup","commission_earned","kyc_requested","kyc_submitted","kyc_approved","kyc_rejected","ticket_created","ticket_reply","ticket_resolved",
    "admin_deposit_submitted","admin_withdrawal_requested","admin_withdrawal_manual","admin_ticket_created","admin_kyc_submitted","reconciliation_mismatch","large_withdrawal","admin_large_withdrawal","direct_message"];
  for(const key of templates)await db.insert(records).values({id:`email-${key}-en`,kind:"email_template",data:{key,language:"en",subject:"{{title}} — {{site_name}}",body_html:"<h1>{{title}}</h1><p>{{body}}</p>"}}).onConflictDoNothing();
}
