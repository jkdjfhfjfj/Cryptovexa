import { q, uid, str, assert, config, transaction, move, event } from "./platform";

export function duration(value: unknown) {
  const n=Number(value); assert(Number.isSafeInteger(n)&&n>0&&n<=43200,"Duration must be a whole number between 1 and 43200"); return n;
}
export const modeMinutes: Record<string,number>={minute:1,hour:60,day:1440};
export async function startRental(user: any,b: any,c: any) {
  const [a]=await q("SELECT * FROM assets WHERE id=$1 FOR UPDATE",[str(b.asset_id)],c);
  assert(a&&a.status==="active","This asset is unavailable");
  const units=duration(b.units??1), d=duration(b.duration);
  assert(modeMinutes[b.billing_mode],"Invalid billing mode");
  assert(d*modeMinutes[b.billing_mode]!>=a.min_duration && d*modeMinutes[b.billing_mode]!<=a.max_duration,"Duration is outside this asset's limits");
  assert(units<=a.available_units,"Not enough units available");
  const rate=String(a[`${b.billing_mode}_rate`]??"0"),capitalPerUnit=String(a.data?.capital_required??"0");
  const [{configured}]=await q("SELECT $1::numeric>0 AND $2::numeric>0 AS configured",[capitalPerUnit,rate],c);
  assert(configured,"This rental's capital and profit schedule must be configured by an administrator");
  const minutes=d*modeMinutes[b.billing_mode]!,durationMs=minutes*60000;
  const [{principal,profit}]=await q("SELECT ($1::numeric*$2::integer)::text AS principal,($3::numeric*$4::integer*$2::integer)::text AS profit",
    [capitalPerUnit,units,rate,d],c);
  const id=uid();
  await move(c,user.id,a.currency,"0","rental_principal_lock",id,`rental-principal-lock:${id}`,principal);
  const [r]=await q(`INSERT INTO rentals(id,user_id,asset_id,billing_mode,rate_snapshot,end_at,billed_until,total_cost,auto_renew,units,data)
    VALUES($1,$2,$3,$4,$5,now()+$6*interval '1 minute',now()+$6*interval '1 minute',0,$7,$8,$9::jsonb) RETURNING *`,
    [id,user.id,a.id,b.billing_mode,rate,minutes,Boolean(b.auto_renew),units,JSON.stringify({
      currency:a.currency,asset_title:a.title,duration:d,duration_ms:String(durationMs),rental_model_version:2,
      principal_amount:principal,capital_required_per_unit:capitalPerUnit,profit_per_cycle:profit,expected_profit:profit,profit_paid:"0",
      rental_kind:"virtual",rental_terms_accepted_at:new Date().toISOString(),
    })],c);
  await q("UPDATE assets SET available_units=available_units-$1 WHERE id=$2",[units,a.id],c);
  await event(user.id,"Rental started",`${a.title} is reserved. Your principal is locked for the selected term, and the configured profit schedule is snapshotted for settlement.`,"rental_started",c);
  return r;
}
async function addProfit(c:any,r:any,value:string,key:string){
  if(!/^0(?:\.0*)?$/.test(value))await move(c,r.user_id,r.data.currency,value,"rental_profit",r.id,key);
}
async function settlementProfit(c:any,a:string,b:string){
  const [{total}]=await q("SELECT ($1::numeric+$2::numeric)::text AS total",[a,b],c);return String(total);
}
/** Settles one or more completed terms, or prorates the current term on an early stop. */
async function settleProfitRental(c:any,r:any,now:Date,stopping:boolean){
  const durationMs=Number(r.data.duration_ms),profitPerTerm=String(r.data.profit_per_cycle??"0"),principal=String(r.data.principal_amount??"0");
  assert(Number.isSafeInteger(durationMs)&&durationMs>0,"Rental term snapshot is invalid",500);
  const nowMs=now.getTime();let endMs=new Date(r.end_at).getTime();
  let profitPaid="0",cycleStartMs=r.data.cycle_started_at?new Date(r.data.cycle_started_at).getTime():new Date(r.start_at).getTime();
  const cyclesDue=r.auto_renew&&nowMs>=endMs?BigInt(Math.floor((nowMs-endMs)/durationMs)+1):0n;
  if(cyclesDue>0n){
    const completedProfit=String((await q("SELECT ($1::numeric*$2::numeric)::text AS total",[profitPerTerm,cyclesDue.toString()],c))[0].total);
    const newEndMs=endMs+Number(cyclesDue)*durationMs,newCycleStartMs=newEndMs-durationMs;
    await addProfit(c,r,completedProfit,`rental-profit-cycle:${r.id}:${new Date(newEndMs).toISOString()}`);
    profitPaid=await settlementProfit(c,profitPaid,completedProfit);
    endMs=newEndMs;
    if(!stopping){
      const totalProfit=String((await q("SELECT ($1::numeric+$2::numeric)::text AS total",[r.total_cost??"0",completedProfit],c))[0].total);
      await q(`UPDATE rentals SET end_at=$1,billed_until=$1,total_cost=$2,data=data||$3::jsonb WHERE id=$4`,
        [new Date(newEndMs),totalProfit,JSON.stringify({cycle_started_at:new Date(newCycleStartMs).toISOString(),profit_paid:totalProfit}),r.id],c);
      await event(r.user_id,"Rental renewed",`${r.data.asset_title} renewed for another term. Completed-term profit was credited; principal remains locked.`,"rental_auto_renewed",c);
      return;
    }
    cycleStartMs=newCycleStartMs;
  }
  if(!stopping&&nowMs<endMs){
    const reminder=new Date(endMs).toISOString();
    if(endMs-nowMs<=10*60000&&r.data.reminded_end!==reminder){
      await q("UPDATE rentals SET data=data||$1::jsonb WHERE id=$2",[JSON.stringify({reminded_end:reminder}),r.id],c);
      await event(r.user_id,"Rental ending soon","Your rental term is nearing maturity. Review auto-renew or let the principal release at maturity.","rental_ending_soon",c);
    }
    return;
  }
  const matured=!r.auto_renew&&nowMs>=endMs;
  if(matured){
    const totalProfit=await settlementProfit(c,profitPaid,profitPerTerm);
    await addProfit(c,r,profitPerTerm,`rental-profit-maturity:${r.id}:${new Date(endMs).toISOString()}`);
    await move(c,r.user_id,r.data.currency,"0","rental_principal_release",r.id,`rental-principal-release:${r.id}`,`-${principal}`);
    const lifetimeProfit=String((await q("SELECT ($1::numeric+$2::numeric)::text AS total",[r.total_cost??"0",totalProfit],c))[0].total);
    await q("UPDATE rentals SET status='completed',auto_renew=false,total_cost=$1,data=data||$2::jsonb WHERE id=$3",
      [lifetimeProfit,JSON.stringify({profit_paid:lifetimeProfit,settled_at:now.toISOString(),settlement:"maturity"}),r.id],c);
    await q("UPDATE assets SET available_units=LEAST(total_units,available_units+$1) WHERE id=$2",[r.units,r.asset_id],c);
    await event(r.user_id,"Rental matured",`${r.data.asset_title} matured. Principal was released and the configured profit was credited.`,"rental_completed",c);
    return;
  }
  if(!stopping)return;
  const cutoff=Math.min(nowMs,endMs),elapsed=Math.max(0,Math.min(durationMs,cutoff-cycleStartMs));
  const partialProfit=String((await q("SELECT round($1::numeric*$2::numeric/$3::numeric,18)::text AS total",[profitPerTerm,String(elapsed),String(durationMs)],c))[0].total);
  await addProfit(c,r,partialProfit,`rental-profit-stop:${r.id}`);
  profitPaid=await settlementProfit(c,profitPaid,partialProfit);
  await move(c,r.user_id,r.data.currency,"0","rental_principal_release",r.id,`rental-principal-release:${r.id}`,`-${principal}`);
  const lifetimeProfit=String((await q("SELECT ($1::numeric+$2::numeric)::text AS total",[r.total_cost??"0",profitPaid],c))[0].total);
  const settledAt=matured?"maturity":"early_stop";
  const status=matured?"completed":"cancelled";
  await q("UPDATE rentals SET status=$1,end_at=CASE WHEN $1='cancelled' THEN $2 ELSE end_at END,auto_renew=false,total_cost=$3,data=data||$4::jsonb WHERE id=$5",
    [status,now,lifetimeProfit,JSON.stringify({profit_paid:lifetimeProfit,settled_at:now.toISOString(),settlement:settledAt}),r.id],c);
  await q("UPDATE assets SET available_units=LEAST(total_units,available_units+$1) WHERE id=$2",[r.units,r.asset_id],c);
  await event(r.user_id,status==="completed"?"Rental matured":"Rental stopped",
    status==="completed"?`${r.data.asset_title} matured. Principal was released and the configured profit was credited.`:`${r.data.asset_title} stopped early. Principal was released with prorated profit.`,"rental_stopped",c);
}
export async function stopRental(user: any,b: any,c: any,admin=false) {
  const [r]=await q(`SELECT r.*,COALESCE(r.data->>'currency',a.currency) AS currency FROM rentals r JOIN assets a ON a.id=r.asset_id WHERE r.id=$1 ${admin?"":"AND r.user_id=$2"} FOR UPDATE OF r,a`,admin?[str(b.id)]:[str(b.id),user.id],c);
  assert(r,"Rental not found",404);
  if(!["active","paused"].includes(r.status)) return r;
  if(r.data?.rental_model_version===2){await settleProfitRental(c,r,new Date(),true);return;}
  if(r.status==="active"&&r.billing_mode==="minute"){
    await billRental(c,r.id,new Date(),true);
  }
  const cfg=await config(false,c), billing=r.data.billing??cfg.billing;
  if(billing.proration && r.billing_mode!=="minute"){
    const [{refund}]=await q(`SELECT LEAST(GREATEST(0,$6::numeric-$7::numeric),round(GREATEST(0,EXTRACT(EPOCH FROM ($1::timestamptz-now()))/60)
      /$2::numeric*$3::numeric*$4::integer*(1-$5::numeric/100),18))::text AS refund`,
      [r.billed_until,modeMinutes[r.billing_mode],r.rate_snapshot,r.units,billing.early_stop_penalty??"0",r.total_cost,billing.minimum_charge??"0"],c);
    if(!/^0(?:\.0*)?$/.test(refund)){
      await move(c,r.user_id,r.currency,refund,"rental_refund",r.id,`rental-refund:${r.id}`);
      await q("UPDATE rentals SET total_cost=total_cost-$1::numeric WHERE id=$2",[refund,r.id],c);
    }
  }
  await q("UPDATE rentals SET status='cancelled',end_at=now(),auto_renew=false WHERE id=$1",[r.id],c);
  await q("UPDATE assets SET available_units=LEAST(total_units,available_units+$1) WHERE id=$2",[r.units,r.asset_id],c);
  const [{total_cost}]=await q("SELECT total_cost FROM rentals WHERE id=$1",[r.id],c);
  const {referralCommission}=await import("./services");
  await referralCommission(c,r.user_id,r.id,total_cost,r.currency,"rental_spend");
  await event(r.user_id,"Rental stopped",`${r.data.asset_title} has ended. Any eligible refund is in your wallet.`,"rental_stopped",c);
}
export async function extendRental(user:any,b:any,c:any,admin=false) {
  const [r]=await q(`SELECT * FROM rentals WHERE id=$1 ${admin?"":"AND user_id=$2"} FOR UPDATE`,admin?[str(b.id)]:[str(b.id),user.id],c);
  assert(r&&r.status==="active","Only active rentals can be extended");
  const d=duration(b.duration),minutes=d*modeMinutes[r.billing_mode]!;
  const [a]=await q("SELECT * FROM assets WHERE id=$1 FOR UPDATE",[r.asset_id],c);
  assert(new Date(r.end_at).getTime()>Date.now(),"This rental has expired");
  assert(new Date(r.end_at).getTime()-new Date(r.start_at).getTime()+minutes*60000<=a.max_duration*60000,"Extension exceeds this asset's maximum duration");
  if(r.data?.rental_model_version===2){
    const [{additional,expected}]=await q("SELECT ($1::numeric*$2::integer*$3::integer)::text AS additional,($4::numeric+$1::numeric*$2::integer*$3::integer)::text AS expected",
      [r.rate_snapshot,d,r.units,r.data.expected_profit??r.data.profit_per_cycle],c);
    const durationMs=Number(r.data.duration_ms)+minutes*60000;
    await q("UPDATE rentals SET end_at=end_at+$1*interval '1 minute',billed_until=billed_until+$1*interval '1 minute',data=data||$2::jsonb WHERE id=$3",
      [minutes,JSON.stringify({duration:d+Number(r.data.duration??1),duration_ms:String(durationMs),profit_per_cycle:expected,expected_profit:expected}),r.id],c);
    await event(r.user_id,"Rental extended",`The term was extended. The estimated profit is now ${expected} ${r.data.currency}.`,"rental_extended",c);
    return;
  }
  if(r.billing_mode!=="minute"){
    const [{cost,baseCost}]=await q(`SELECT ($1::numeric*$2::integer*$3::integer+$4::numeric)::text AS "baseCost",
      GREATEST(0,GREATEST($1::numeric*$2::integer*$3::integer+$4::numeric,$5::numeric)-$6::numeric)::text AS cost`,
      [r.rate_snapshot,d,r.units,r.data.base_cost??r.total_cost,r.data.billing?.minimum_charge??"0",r.total_cost],c);
    const key=uid();
    await move(c,r.user_id,r.data.currency,`-${cost}`,"rental_extension",r.id,`extend:${key}`);
    await q("UPDATE rentals SET total_cost=total_cost+$1::numeric,billed_until=billed_until+$2*interval '1 minute',data=data||$3::jsonb WHERE id=$4",[cost,minutes,JSON.stringify({base_cost:baseCost}),r.id],c);
  }
  await q("UPDATE rentals SET end_at=end_at+$1*interval '1 minute' WHERE id=$2",[minutes,r.id],c);
  await event(r.user_id,"Rental extended","Your rental duration was extended.","rental_extended",c);
}
/** One locked billing decision. The explicit clock makes outage/boundary regressions testable. */
export async function billRental(c:any,id:string,now=new Date(),stopping=false) {
  const [r]=await q("SELECT * FROM rentals WHERE id=$1 FOR UPDATE SKIP LOCKED",[id],c);
  if(!r||!["active","paused"].includes(r.status))return;
  if(r.data?.rental_model_version===2){
    await q("SELECT id FROM assets WHERE id=$1 FOR UPDATE",[r.asset_id],c);
    await settleProfitRental(c,r,now,stopping);return;
  }
  await q("SELECT id FROM assets WHERE id=$1 FOR UPDATE",[r.asset_id],c);
  const cfg=await config(false,c),billing=r.data.billing??cfg.billing;
  const clock=now.getTime(),end=new Date(r.end_at).getTime(),until=new Date(r.billed_until).getTime();
  const finish=async()=>{
    const [current]=await q("UPDATE rentals SET status='completed',auto_renew=false WHERE id=$1 RETURNING total_cost",[r.id],c);
    await q("UPDATE assets SET available_units=LEAST(total_units,available_units+$1) WHERE id=$2",[r.units,r.asset_id],c);
    await event(r.user_id,"Rental completed",`${r.data.asset_title} has completed.`,"rental_completed",c);
    const {referralCommission}=await import("./services");
    await referralCommission(c,r.user_id,r.id,current.total_cost,r.data.currency,"rental_spend");
  };
  let periods=0,billFrom=until,newEnd=end,resuming=false;
  if(r.status==="paused"){
    if(r.data.admin_paused)return; // Staff pauses are not low-balance grace periods.
    const since=new Date(r.data.paused_at??r.end_at).getTime();
    if(clock-since>=Number(billing.grace_minutes??15)*60000){if(!stopping)await finish();return;}
    resuming=true;billFrom=clock;
    periods=r.billing_mode==="minute"?1:Number(r.data.duration??1);
    newEnd=clock+Math.max(periods*modeMinutes[r.billing_mode]!*60000,end-since);
  }else if(r.billing_mode==="minute"){
    // Never charge beyond a finite booking, including when recovering from worker downtime.
    periods=stopping||!r.auto_renew
      ?Math.max(0,Math.ceil((Math.min(clock,end)-until)/60000))
      :Math.max(0,Math.floor((clock-until)/60000)+1);
    if(r.auto_renew&&clock>=end&&!stopping){
      const span=Number(r.data.duration??1)*60000;
      newEnd=end+(Math.floor((clock-end)/span)+1)*span;
    }
  }else if(clock>=end){
    if(!r.auto_renew){if(!stopping)await finish();return;}
    periods=Number(r.data.duration??1);billFrom=clock;newEnd=clock+periods*modeMinutes[r.billing_mode]!*60000;
  }
  if(periods>0){
    await q("SELECT id FROM wallets WHERE user_id=$1 AND currency=$2 FOR UPDATE",[r.user_id,r.data.currency],c);
    const [{cost,baseCost,affordable}]=await q(`WITH quote AS (
      SELECT ($1::numeric*$2::integer*$3::integer+$6::numeric) AS base,
      GREATEST(0,GREATEST($1::numeric*$2::integer*$3::integer+$6::numeric,$7::numeric)-$8::numeric) AS cost)
      SELECT cost::text,base::text AS "baseCost",
      COALESCE((SELECT balance-locked FROM wallets WHERE user_id=$4 AND currency=$5),0)>=cost AS affordable FROM quote`,
      [r.rate_snapshot,periods,r.units,r.user_id,r.data.currency,r.data.base_cost??r.total_cost,billing.minimum_charge??"0",r.total_cost],c);
    if(!affordable){
      if(r.status!=="paused"){
        await q("UPDATE rentals SET status='paused',data=data||$1::jsonb WHERE id=$2",[JSON.stringify({paused_at:now.toISOString()}),r.id],c);
        await event(r.user_id,"Low balance: rental paused","Add funds to avoid your rental ending after the grace period.","rental_low_balance",c);
      }
      return;
    }
    await move(c,r.user_id,r.data.currency,`-${cost}`,"rental_charge",r.id,`billing:${r.id}:${new Date(billFrom).toISOString()}`);
    const billed=new Date(billFrom+periods*modeMinutes[r.billing_mode]!*60000);
    await q("UPDATE rentals SET status='active',billed_until=$1,end_at=$2,total_cost=total_cost+$3::numeric,data=(data-'paused_at')||$4::jsonb WHERE id=$5",[billed,new Date(newEnd),cost,JSON.stringify({base_cost:baseCost}),r.id],c);
    const [{low}]=await q("SELECT balance-locked<$3::numeric AS low FROM wallets WHERE user_id=$1 AND currency=$2",[r.user_id,r.data.currency,billing.low_balance_threshold??"0"],c);
    if(low&&!r.data.low_balance_warned){
      await event(r.user_id,"Rental balance is running low","Add funds before your next billing period to avoid an interruption.","rental_low_balance",c);
      await q("UPDATE rentals SET data=data||'{\"low_balance_warned\":true}'::jsonb WHERE id=$1",[r.id],c);
    }else if(!low)await q("UPDATE rentals SET data=data-'low_balance_warned' WHERE id=$1",[r.id],c);
    if(resuming)await event(r.user_id,"Rental resumed","Your rental has resumed after payment for the next billing period.","rental_resumed",c);
    else if(newEnd!==end)await event(r.user_id,"Rental auto-renewed","Your rental has renewed using the snapshotted rate.","rental_auto_renewed",c);
  }
  if(!stopping&&!r.auto_renew&&clock>=newEnd){await finish();return;}
  if(!stopping&&newEnd-clock<=10*60000&&newEnd-clock>0&&r.data.reminded_end!==new Date(newEnd).toISOString()){
    await q("UPDATE rentals SET data=data||$1::jsonb WHERE id=$2",[JSON.stringify({reminded_end:new Date(newEnd).toISOString()}),r.id],c);
    await event(r.user_id,"Rental ending soon","Your rental is nearing its end. Extend it or enable auto-renew if needed.","rental_ending_soon",c);
  }
}
export async function billRentals() {
  const list=await q("SELECT id FROM rentals WHERE status IN ('active','paused') AND (billed_until<=now() OR end_at<=now() OR end_at<=now()+interval '10 minutes') ORDER BY billed_until LIMIT 100");
  for(const row of list)await transaction(c=>billRental(c,row.id));
}
