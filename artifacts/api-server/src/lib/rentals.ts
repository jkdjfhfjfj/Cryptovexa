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
  let rate=a[`${b.billing_mode}_rate`];
  assert(rate&&!/^0(?:\.0*)?$/.test(rate),"This billing mode is disabled");
  const discount=(a.data.discount_rules??[]).filter((rule:any)=>Number(rule.min_units??1)<=units&&Number(rule.min_duration??1)<=d)
    .sort((a:any,b:any)=>Number(b.percent??0)-Number(a.percent??0))[0];
  if(discount){
    const percent=String(discount.percent??"0");assert(Number(percent)>=0&&Number(percent)<100,"Invalid configured discount");
    const [{adjusted}]=await q("SELECT round($1::numeric*(1-$2::numeric/100),18)::text AS adjusted",[rate,percent],c);rate=adjusted;
  }
  const cfg=await config(false,c);
  const id=uid(), minutes=d*modeMinutes[b.billing_mode]!;
  const [{cost,baseCost}]=await q('SELECT ($1::numeric*$2::integer*$3::integer)::text AS "baseCost",GREATEST($1::numeric*$2::integer*$3::integer,$4::numeric)::text AS cost',[rate,b.billing_mode==="minute"?1:d,units,cfg.billing.minimum_charge??"0"],c);
  await move(c,user.id,a.currency,`-${cost}`,"rental_charge",id,`rent-start:${id}`);
  const [r]=await q(`INSERT INTO rentals(id,user_id,asset_id,billing_mode,rate_snapshot,end_at,billed_until,total_cost,auto_renew,units,data)
    VALUES($1,$2,$3,$4,$5,now()+$6*interval '1 minute',now()+$7*interval '1 minute',$8,$9,$10,$11::jsonb) RETURNING *`,
    [id,user.id,a.id,b.billing_mode,rate,minutes,b.billing_mode==="minute"?1:minutes,cost,Boolean(b.auto_renew),units,JSON.stringify({currency:a.currency,asset_title:a.title,duration:d,billing:cfg.billing,base_cost:baseCost,rental_kind:"virtual",virtual_terms_accepted_at:b.virtual_terms_accepted===true?new Date().toISOString():null})],c);
  await q("UPDATE assets SET available_units=available_units-$1 WHERE id=$2",[units,a.id],c);
  await event(user.id,"Virtual rental started",`${a.title} is now reserved inside the app. This fee does not provide access to real property or computing hardware, or an investment return.`,"rental_started",c);
  return r;
}
export async function stopRental(user: any,b: any,c: any,admin=false) {
  const [r]=await q(`SELECT r.*,COALESCE(r.data->>'currency',a.currency) AS currency FROM rentals r JOIN assets a ON a.id=r.asset_id WHERE r.id=$1 ${admin?"":"AND r.user_id=$2"} FOR UPDATE OF r,a`,admin?[str(b.id)]:[str(b.id),user.id],c);
  assert(r,"Rental not found",404);
  if(!["active","paused"].includes(r.status)) return r;
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
