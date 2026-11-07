import test from "node:test";
import strict from "node:assert/strict";
import { createHash } from "node:crypto";
import { pool } from "@workspace/db";
import { q, uid, move, amount, encrypt, decrypt, putSetting, config, record, transaction, replayRequest, accountAllowedInEnvironment, defaultSettings, defaultEmailTemplateBody } from "../lib/platform";
import { startRental, stopRental, billRental, extendRental } from "../lib/rentals";
import { approveDeposit } from "../lib/deposits";
import { referralCommission, settleWithdrawal, deliverQueuedEmail, findVerifiedBinanceDeposit, creditVerifiedBinanceDeposit, binanceNetworkCode, renderEmailMessage } from "../lib/services";
import { reviewDocuments } from "../lib/verification";

strict.notEqual(process.env.NODE_ENV,"production","Financial fixtures must never run against a production runtime");

async function sandbox(fn:(c:any,u:any)=>Promise<void>){
  const c=await pool.connect();
  await c.query("BEGIN");
  try{
    const id=uid();
    const [u]=await q("INSERT INTO users(id,email,username,password_hash,referral_code) VALUES($1,$2,'Test','unused',$3) RETURNING *",[id,`${id}@test.invalid`,uid()],c);
    await fn(c,u);
  }finally{await c.query("ROLLBACK");c.release();}
}
test("Default preview accounts cannot authenticate in production",()=>{
  const preview={data:{preview_default:true}},operator={data:{}};
  strict.equal(accountAllowedInEnvironment(preview,"development"),true);
  strict.equal(accountAllowedInEnvironment(preview,"production"),false);
  strict.equal(accountAllowedInEnvironment(operator,"production"),true);
  strict.equal(accountAllowedInEnvironment(null,"production"),false);
});
test("Money validation rejects floats, exponents, negatives and zero",()=>{
  for(const n of [0.1,1,"1e3","-1","0","0.000","NaN","1.1234567890123456789"])strict.throws(()=>amount(n));
  strict.equal(amount("0.000000000000000001"),"0.000000000000000001");
});
test("Binance deposit matching requires one exact successful asset, network, address, tag and amount",()=>{
  strict.equal(defaultSettings.binance.auto_deposits,true,"Binance automatic deposits are the default mode");
  strict.equal(binanceNetworkCode({name:"TRC20"}),"TRX");
  strict.equal(binanceNetworkCode({name:"ERC20"}),"ETH");
  strict.equal(binanceNetworkCode({name:"BEP20"}),"BSC");
  strict.equal(binanceNetworkCode({name:"Custom chain",binance_network:"CHAIN-X"}),"CHAIN-X");
  const deposit={currency:"USDT",txid:"0xABCDEF",address_used:"TExampleDepositAddress123456",amount_claimed:"12.5000",data:{binance_network:"TRX",memo_used:"memo-7"}};
  const success={coin:"USDT",txId:"abcdef",network:"TRX",address:"TExampleDepositAddress123456",addressTag:"memo-7",amount:"12.5",status:1};
  strict.equal(findVerifiedBinanceDeposit(deposit,[success]),success);
  for(const mismatch of [
    {...success,status:0},
    {...success,status:6},
    {...success,coin:"USDC"},
    {...success,network:"ETH"},
    {...success,address:"TAnotherDepositAddress123456"},
    {...success,addressTag:"other-memo"},
    {...success,amount:"12.5001"},
    {...success,txId:"different"},
  ])strict.equal(findVerifiedBinanceDeposit(deposit,[mismatch]),null);
  strict.equal(findVerifiedBinanceDeposit(deposit,[success,{...success,network:"ETH"}]),null,"ambiguous repeated transaction rows stay manual");
});
async function rentalFixture(c:any,u:any,mode="minute",duration=3,autoRenew=false){
  await move(c,u.id,"USDT","100","test_funding","funding",`fund:${u.id}`);
  const id=uid();
  await q(`INSERT INTO assets(id,type,title,description,location,category,total_units,available_units,currency,minute_rate,hour_rate,day_rate)
    VALUES($1,'machine','Regression fixture','Test only','Test only','Test only',1,1,'USDT','1','5','20')`,[id],c);
  const cfg=await config(false,c),rate=mode==="minute"?"1":mode==="hour"?"5":"20",minutes=duration*({minute:1,hour:60,day:1440} as Record<string,number>)[mode]!;
  const [{baseCost,cost}]=await q('SELECT ($1::numeric*$2::integer)::text AS "baseCost",GREATEST($1::numeric*$2::integer,$3::numeric)::text AS cost',
    [rate,mode==="minute"?1:duration,cfg.billing.minimum_charge??"0"],c);
  const rentalId=uid();await move(c,u.id,"USDT",`-${cost}`,"rental_charge",rentalId,`legacy-rent:${rentalId}`);
  const [r]=await q(`INSERT INTO rentals(id,user_id,asset_id,billing_mode,rate_snapshot,end_at,billed_until,total_cost,auto_renew,units,data)
    VALUES($1,$2,$3,$4,$5,now()+$6*interval '1 minute',now()+$7*interval '1 minute',$8,$9,1,$10::jsonb) RETURNING *`,
    [rentalId,u.id,id,mode,rate,minutes,mode==="minute"?1:minutes,cost,autoRenew,JSON.stringify({currency:"USDT",asset_title:"Legacy fixture",duration,billing:cfg.billing,base_cost:baseCost,rental_model_version:1})],c);
  await q("UPDATE assets SET available_units=0 WHERE id=$1",[id],c);
  return r;
}
async function profitRentalFixture(c:any,u:any,mode="minute",duration=3,autoRenew=false,capital="10"){
  await move(c,u.id,"USDT","100","test_funding","funding",`profit-fund:${u.id}`);
  const id=uid();
  await q(`INSERT INTO assets(id,type,title,description,location,category,total_units,available_units,currency,minute_rate,hour_rate,day_rate,data)
    VALUES($1,'machine','Profit fixture','Test only','Test only','Test only',1,1,'USDT','1','5','20',$2::jsonb)`,
    [id,JSON.stringify({capital_required:capital,profit_rate_basis:"hour",profit_rate_value:"5"})],c);
  return startRental(u,{asset_id:id,billing_mode:mode,duration,units:1,auto_renew:autoRenew},c);
}
test("Maturity releases principal and credits the snapshotted profit once",async()=>{
  await sandbox(async(c,u)=>{
    const r=await profitRentalFixture(c,u),clock=new Date(new Date(r.end_at).getTime()+60000);
    await billRental(c,r.id,clock);
    await billRental(c,r.id,clock);
    const [saved]=await q("SELECT * FROM rentals WHERE id=$1",[r.id],c);
    const [a]=await q("SELECT available_units FROM assets WHERE id=$1",[r.asset_id],c);
    strict.equal(saved.status,"completed");strict.equal(saved.total_cost,"3.000000000000000000");strict.equal(saved.data.profit_paid,"3.000000000000000000");strict.equal(a.available_units,1);
    const [w]=await q("SELECT balance,locked FROM wallets WHERE user_id=$1",[u.id],c);strict.equal(w.balance,"103.000000000000000000");strict.equal(w.locked,"0.000000000000000000");
    const [{n}]=await q("SELECT count(*)::integer AS n FROM ledger WHERE ref_id=$1 AND type='rental_profit'",[r.id],c);strict.equal(n,1);
    const [{valid}]=await q("SELECT balance=(SELECT COALESCE(sum(amount),0) FROM ledger WHERE user_id=$1 AND currency='USDT') AS valid FROM wallets WHERE user_id=$1 AND currency='USDT'",[u.id],c);strict.equal(valid,true);
  });
});
test("Prepaid low-balance resume requires and charges the entire renewal period",async()=>{
  await sandbox(async(c,u)=>{
    const r=await rentalFixture(c,u,"hour",2,true),end=new Date(r.end_at).getTime();
    await move(c,u.id,"USDT","-85","test_spend","spend",`spend:${u.id}`);
    await billRental(c,r.id,new Date(end+1000));
    await billRental(c,r.id,new Date(end+60000));
    let [saved]=await q("SELECT * FROM rentals WHERE id=$1",[r.id],c);
    strict.equal(saved.status,"paused");strict.equal(saved.total_cost,"10.000000000000000000");
    await move(c,u.id,"USDT","5","test_funding","topup",`topup:${u.id}`);
    const clock=new Date(end+120000);await billRental(c,r.id,clock);await billRental(c,r.id,clock);
    [saved]=await q("SELECT * FROM rentals WHERE id=$1",[r.id],c);
    strict.equal(saved.status,"active");strict.equal(saved.total_cost,"20.000000000000000000");
    strict.equal(new Date(saved.billed_until).getTime(),clock.getTime()+120*60000);
  });
});
test("Funding after the grace deadline does not resurrect an expired reservation",async()=>{
  await sandbox(async(c,u)=>{
    const r=await rentalFixture(c,u);
    const paused=new Date(r.billed_until).getTime();
    await q("UPDATE rentals SET status='paused',data=data||$1::jsonb WHERE id=$2",[JSON.stringify({paused_at:new Date(paused).toISOString()}),r.id],c);
    await billRental(c,r.id,new Date(paused+16*60000));
    const [saved]=await q("SELECT status FROM rentals WHERE id=$1",[r.id],c);strict.equal(saved.status,"completed");
  });
});
test("Staff-paused rentals never resume or expire under low-balance grace rules",async()=>{
  await sandbox(async(c,u)=>{
    const r=await rentalFixture(c,u);
    await q("UPDATE rentals SET status='paused',data=data||$1::jsonb WHERE id=$2",[JSON.stringify({paused_at:r.start_at,admin_paused:true}),r.id],c);
    await billRental(c,r.id,new Date(new Date(r.end_at).getTime()+86400000));
    const [saved]=await q("SELECT status,total_cost FROM rentals WHERE id=$1",[r.id],c);
    strict.equal(saved.status,"paused");strict.equal(saved.total_cost,"1.000000000000000000");
  });
});
test("The upfront minimum counts toward usage instead of being charged twice",async()=>{
  await sandbox(async(c,u)=>{
    const cfg=await config(false,c);
    await putSetting("billing",{...cfg.billing,minimum_charge:"5"},false,c);
    const r=await rentalFixture(c,u);
    strict.equal(r.total_cost,"5.000000000000000000");
    await billRental(c,r.id,new Date(new Date(r.end_at).getTime()+1));
    const [saved]=await q("SELECT total_cost FROM rentals WHERE id=$1",[r.id],c);
    strict.equal(saved.total_cost,"5.000000000000000000");
  });
});
test("Early stop releases principal and pays prorated profit in the snapshotted currency",async()=>{
  await sandbox(async(c,u)=>{
    const r=await profitRentalFixture(c,u,"hour",2);
    await q("UPDATE rentals SET start_at=now()-interval '1 hour',end_at=now()+interval '1 hour',billed_until=now()+interval '1 hour' WHERE id=$1",[r.id],c);
    await q("UPDATE assets SET currency='BTC',hour_rate='0.1' WHERE id=$1",[r.asset_id],c);
    await stopRental(u,{id:r.id},c);
    const [profit]=await q("SELECT currency,amount FROM ledger WHERE user_id=$1 AND type='rental_profit' AND ref_id=$2",[u.id,r.id],c);
    strict.equal(profit.currency,"USDT");
    const [{valid}]=await q("SELECT $1::numeric BETWEEN 5::numeric AND 5.001::numeric AS valid",[profit.amount],c);strict.equal(valid,true);
    const [saved]=await q("SELECT status,total_cost,data FROM rentals WHERE id=$1",[r.id],c);
    const [{profitValid}]=await q("SELECT $1::numeric BETWEEN 5::numeric AND 5.001::numeric AS \"profitValid\"",[saved.total_cost],c);
    strict.equal(saved.status,"cancelled");strict.equal(profitValid,true);strict.equal(saved.data.principal_amount,"10");
    const [w]=await q("SELECT balance,locked FROM wallets WHERE user_id=$1 AND currency='USDT'",[u.id],c);
    const [{balanceValid}]=await q("SELECT $1::numeric BETWEEN 105::numeric AND 105.001::numeric AS \"balanceValid\"",[w.balance],c);
    strict.equal(balanceValid,true);strict.equal(w.locked,"0.000000000000000000");
  });
});
test("The actual deposit-review service credits an adjusted amount exactly once",async()=>{
  await sandbox(async(c,u)=>{
    const id=uid();
    await q("INSERT INTO deposits(id,user_id,currency,network,address_used,amount_claimed,txid) VALUES($1,$2,'USDT','BEP20','TEST ONLY','10.1',$3)",[id,u.id,uid()],c);
    const first=await approveDeposit(c,id,u.id,"10.3","Regression test");
    strict.ok(Number.isFinite(new Date(first.deposit.terms_accepted_at).getTime()));
    const second=await approveDeposit(c,id,u.id,"999","Repeated submission");
    strict.equal(first.alreadyCredited,false);strict.equal(second.alreadyCredited,true);
    const [w]=await q("SELECT balance FROM wallets WHERE user_id=$1",[u.id],c);strict.equal(w.balance,"10.300000000000000000");
    const [{n}]=await q("SELECT count(*)::integer AS n FROM ledger WHERE ref_id=$1",[id],c);strict.equal(n,1);
  });
});
test("A Binance-verified credit uses the exact provider amount and remains idempotent",async()=>{
  await sandbox(async(c,u)=>{
    const id=uid(),historyItem={coin:"USDT",txId:"deposit-hash",network:"TRX",address:"TExampleDepositAddress123456",addressTag:"",amount:"0.300",status:1};
    await q("INSERT INTO deposits(id,user_id,currency,network,address_used,amount_claimed,txid,data) VALUES($1,$2,'USDT','TRC20',$3,'0.300','deposit-hash',$4::jsonb)",
      [id,u.id,historyItem.address,JSON.stringify({binance_auto_eligible:true,binance_network:"TRX",memo_used:""})],c);
    const [deposit]=await q("SELECT * FROM deposits WHERE id=$1",[id],c);
    const verified=findVerifiedBinanceDeposit(deposit,[historyItem]);
    strict.ok(verified);
    const first=await approveDeposit(c,id,null,String(verified.amount),"Automatically verified by Binance deposit history");
    const replay=await approveDeposit(c,id,null,"99","Repeated Binance worker pass");
    strict.equal(first.alreadyCredited,false);strict.equal(replay.alreadyCredited,true);
    const [saved]=await q("SELECT status,amount_credited,reviewed_by FROM deposits WHERE id=$1",[id],c);
    strict.equal(saved.status,"approved");strict.equal(saved.amount_credited,"0.300000000000000000");strict.equal(saved.reviewed_by,null);
    const [wallet]=await q("SELECT balance FROM wallets WHERE user_id=$1 AND currency='USDT'",[u.id],c);
    strict.equal(wallet.balance,"0.300000000000000000");
    const [{count}]=await q("SELECT count(*)::integer AS count FROM ledger WHERE ref_id=$1 AND type='deposit_credit'",[id],c);
    strict.equal(count,1);
  });
});
test("Concurrent Binance verification workers can credit one pending deposit only once",async()=>{
  const userId=uid(),depositId=uid(),apiKey="fixture-only-binance-key";
  const fingerprint=createHash("sha256").update(apiKey).digest("hex").slice(0,24);
  await q("INSERT INTO users(id,email,username,password_hash,referral_code) VALUES($1,$2,$3,'unused',$4)",
    [userId,`${userId}@test.invalid`,`Binance-${userId.slice(0,8)}`,uid()]);
  try{
    await q("INSERT INTO deposits(id,user_id,currency,network,address_used,amount_claimed,txid,data) VALUES($1,$2,'USDT','TRC20','TExampleDepositAddress123456','0.3','binance-worker-tx',$3::jsonb)",
      [depositId,userId,JSON.stringify({binance_auto_eligible:true,binance_account_fingerprint:fingerprint,binance_network:"TRX",memo_used:""})]);
    const match={amount:"0.300",network:"TRX",status:1};
    const readTestConfig=async()=>({binance:{auto_deposits:true},binance_api_key:apiKey,binance_api_secret:"fixture-only-secret"});
    const outcomes=await Promise.all([
      creditVerifiedBinanceDeposit(depositId,fingerprint,match,readTestConfig),
      creditVerifiedBinanceDeposit(depositId,fingerprint,match,readTestConfig),
    ]);
    strict.equal(outcomes.filter((item)=>!item.alreadyCredited).length,1);
    const [saved]=await q("SELECT status,amount_credited FROM deposits WHERE id=$1",[depositId]);
    strict.equal(saved.status,"approved");strict.equal(saved.amount_credited,"0.300000000000000000");
    const [wallet]=await q("SELECT balance FROM wallets WHERE user_id=$1 AND currency='USDT'",[userId]);
    strict.equal(wallet.balance,"0.300000000000000000");
    const [{count}]=await q("SELECT count(*)::integer AS count FROM ledger WHERE ref_id=$1 AND type='deposit_credit'",[depositId]);
    strict.equal(count,1);
  }finally{
    await q("DELETE FROM platform_records WHERE user_id=$1",[userId]);
    await q("DELETE FROM ledger WHERE user_id=$1",[userId]);
    await q("DELETE FROM wallets WHERE user_id=$1",[userId]);
    await q("DELETE FROM deposits WHERE id=$1",[depositId]);
    await q("DELETE FROM users WHERE id=$1",[userId]);
  }
});
test("Withdrawal settlement releases its lock and debits only once",async()=>{
  await sandbox(async(c,u)=>{
    await move(c,u.id,"USDT","100","test_funding","fund",`fund:${u.id}`);
    const id=uid();await move(c,u.id,"USDT","0","withdrawal_lock",id,`lock:${id}`,"11");
    await q("INSERT INTO withdrawals(id,user_id,currency,network,address,amount,fee,status,data) VALUES($1,$2,'USDT','BEP20','TEST ONLY','10','1','manual_fallback',$3::jsonb)",[id,u.id,JSON.stringify({total:"11"})],c);
    await settleWithdrawal(id,"test-only-transaction",c);await settleWithdrawal(id,"test-only-transaction",c);
    const [w]=await q("SELECT * FROM wallets WHERE user_id=$1",[u.id],c);
    strict.equal(w.balance,"89.000000000000000000");strict.equal(w.locked,"0.000000000000000000");
  });
});
test("Referral trigger arrays, cumulative caps and repeat events preserve ledger totals",async()=>{
  await sandbox(async(c,u)=>{
    const parent=uid();
    await q("INSERT INTO users(id,email,username,password_hash,referral_code) VALUES($1,$2,'Referrer','unused',$3)",[parent,`${parent}@test.invalid`,uid()],c);
    await q("UPDATE users SET referred_by=$1 WHERE id=$2",[parent,u.id],c);
    await putSetting("referral_config",{enabled:true,levels:1,percentages:["10"],triggers:["every_deposit"],cap:"5"},false,c);
    const source=uid();
    await referralCommission(c,u.id,source,"40","USDT","first_deposit");
    await referralCommission(c,u.id,source,"40","USDT","first_deposit");
    await referralCommission(c,u.id,uid(),"40","USDT","every_deposit");
    await referralCommission(c,u.id,uid(),"40","USDT","every_deposit");
    const [w]=await q("SELECT balance FROM wallets WHERE user_id=$1",[parent],c);strict.equal(w.balance,"5.000000000000000000");
  });
});
test("Suspicious referrals remain pending until an explicit allow review",async()=>{
  await sandbox(async(c,u)=>{
    const parent=uid(),ref=uid(),source=uid();
    await q("INSERT INTO users(id,email,username,password_hash,referral_code) VALUES($1,$2,'Referrer','unused',$3)",[parent,`${parent}@test.invalid`,uid()],c);
    await q("UPDATE users SET referred_by=$1 WHERE id=$2",[parent,u.id],c);
    await putSetting("referral_config",{enabled:true,levels:1,percentages:["10"],triggers:["every_deposit"],cap:null},false,c);
    await record("referral",{referred_id:u.id,suspicious:true},parent,ref,c);
    await referralCommission(c,u.id,source,"10","USDT","first_deposit");
    strict.equal((await q("SELECT * FROM wallets WHERE user_id=$1",[parent],c)).length,0);
    await q("UPDATE platform_records SET data=data||'{\"review_decision\":\"allow\"}'::jsonb WHERE id=$1",[ref],c);
    await referralCommission(c,u.id,source,"10","USDT","first_deposit");
    const [w]=await q("SELECT balance FROM wallets WHERE user_id=$1",[parent],c);strict.equal(w.balance,"1.000000000000000000");
  });
});
test("KYC decisions preserve private file references and require rejection reasons",()=>{
  const docs=[{type:"selfie",objectPath:"/objects/private-test",status:"submitted"}];
  const reviewed=reviewDocuments(["selfie"],docs,[{type:"selfie",status:"approved",objectPath:"/objects/forged"}]);
  strict.equal(reviewed[0].objectPath,"/objects/private-test");strict.equal(reviewed[0].status,"approved");
  strict.throws(()=>reviewDocuments(["selfie"],docs,[{type:"selfie",status:"rejected"}]));
  strict.throws(()=>reviewDocuments(["selfie"],docs,[{type:"id_front",status:"approved"}]));
});
async function concurrentFixture(fn:(u:any,assets:string[])=>Promise<void>,balance="100"){
  const id=uid(),assetIds=[uid(),uid()],email=`${id}@test.invalid`;
  try{
    await transaction(async c=>{
      await q("INSERT INTO users(id,email,username,password_hash,referral_code) VALUES($1,$2,'QA concurrency fixture','unused',$3)",[id,email,uid()],c);
      await move(c,id,"USDT",balance,"test_funding","concurrency",`fund:${id}`);
      for(const asset of assetIds)await q(`INSERT INTO assets(id,type,title,description,location,category,total_units,available_units,currency,hour_rate,data)
        VALUES($1,'machine','QA concurrency fixture','Test only','Test only','Test only',1,1,'USDT','10',$2::jsonb)`,
        [asset,JSON.stringify({capital_required:"10",profit_rate_basis:"hour",profit_rate_value:"10"})],c);
    });
    await fn({id},assetIds);
  }finally{
    await transaction(async c=>{
      await q("DELETE FROM rentals WHERE user_id=$1",[id],c);
      await q("DELETE FROM assets WHERE id=ANY($1::text[])",[assetIds],c);
      await q("DELETE FROM ledger WHERE user_id=$1",[id],c);
      await q("DELETE FROM wallets WHERE user_id=$1",[id],c);
      await q("DELETE FROM platform_records WHERE user_id=$1",[id],c);
      await q('DELETE FROM email_logs WHERE "to"=$1',[email],c);
      await q("DELETE FROM users WHERE id=$1",[id],c);
    });
  }
}
test("Concurrent bookings cannot overbook the same last available unit",async()=>{
  await concurrentFixture(async(u,assets)=>{
    const reserve=()=>transaction(c=>startRental(u,{asset_id:assets[0],billing_mode:"hour",duration:1,units:1},c));
    const outcomes=await Promise.allSettled([reserve(),reserve()]);
    strict.equal(outcomes.filter(o=>o.status==="fulfilled").length,1);
    strict.equal(outcomes.filter(o=>o.status==="rejected").length,1);
    const [a]=await q("SELECT available_units FROM assets WHERE id=$1",[assets[0]]);strict.equal(a.available_units,0);
    const [w]=await q("SELECT balance,locked FROM wallets WHERE user_id=$1",[u.id]);strict.equal(w.balance,"100.000000000000000000");strict.equal(w.locked,"10.000000000000000000");
  });
});
test("Concurrent rentals cannot spend the same wallet balance twice",async()=>{
  await concurrentFixture(async(u,assets)=>{
    const outcomes=await Promise.allSettled(assets.map(asset=>transaction(c=>startRental(u,{asset_id:asset,billing_mode:"hour",duration:1,units:1},c))));
    strict.equal(outcomes.filter(o=>o.status==="fulfilled").length,1);
    const [w]=await q("SELECT balance,locked FROM wallets WHERE user_id=$1",[u.id]);
    strict.equal(w.balance,"10.000000000000000000");strict.equal(w.locked,"10.000000000000000000");
    const [{n}]=await q("SELECT count(*)::integer AS n FROM rentals WHERE user_id=$1",[u.id]);strict.equal(n,1);
  },"10");
});
test("Minute billing has one debit per billed boundary when ticks are replayed",async()=>{
  await sandbox(async(c,u)=>{
    const r=await rentalFixture(c,u),start=new Date(r.start_at).getTime();
    for(const clock of [start+60001,start+60001,start+120001,start+120001,start+180001]){
      await billRental(c,r.id,new Date(clock));
    }
    const [{n,unique_keys}]=await q("SELECT count(*)::integer AS n,count(DISTINCT idempotency_key)::integer AS unique_keys FROM ledger WHERE ref_id=$1 AND type='rental_charge'",[r.id],c);
    strict.equal(n,3);strict.equal(unique_keys,3);
    const [w]=await q("SELECT balance FROM wallets WHERE user_id=$1",[u.id],c);strict.equal(w.balance,"97.000000000000000000");
  });
});
test("Concurrent maturity workers credit profit and release capital once",async()=>{
  await concurrentFixture(async(u,assets)=>{
    await q("UPDATE assets SET minute_rate='1' WHERE id=$1",[assets[0]]);
    const r=await transaction(c=>startRental(u,{asset_id:assets[0],billing_mode:"minute",duration:3,units:1},c));
    const clock=new Date(new Date(r.end_at).getTime()+1);
    await Promise.all([transaction(c=>billRental(c,r.id,clock)),transaction(c=>billRental(c,r.id,clock))]);
    const [saved]=await q("SELECT status,total_cost,data FROM rentals WHERE id=$1",[r.id]);
    strict.equal(saved.status,"completed");strict.equal(saved.total_cost,"3.000000000000000000");
    const [a]=await q("SELECT available_units FROM assets WHERE id=$1",[assets[0]]);strict.equal(a.available_units,1);
    const [w]=await q("SELECT balance,locked FROM wallets WHERE user_id=$1",[u.id]);strict.equal(w.balance,"103.000000000000000000");strict.equal(w.locked,"0.000000000000000000");
    const [{n}]=await q("SELECT count(*)::integer AS n FROM ledger WHERE ref_id=$1 AND type='rental_profit'",[r.id]);strict.equal(n,1);
  });
});
test("Concurrent auto-renew workers pay each completed term once and keep capital locked",async()=>{
  await concurrentFixture(async(u,assets)=>{
    const r=await transaction(c=>startRental(u,{asset_id:assets[0],billing_mode:"hour",duration:1,units:1,auto_renew:true},c));
    const clock=new Date(new Date(r.end_at).getTime()+1);
    await Promise.all([transaction(c=>billRental(c,r.id,clock)),transaction(c=>billRental(c,r.id,clock))]);
    const [saved]=await q("SELECT status,total_cost,billed_until,data FROM rentals WHERE id=$1",[r.id]);
    strict.equal(saved.status,"active");strict.equal(saved.total_cost,"10.000000000000000000");
    strict.equal(new Date(saved.billed_until).getTime(),new Date(r.end_at).getTime()+3600000);
    strict.equal(saved.data.profit_paid,"10.000000000000000000");
    const [w]=await q("SELECT balance,locked FROM wallets WHERE user_id=$1",[u.id]);strict.equal(w.balance,"110.000000000000000000");strict.equal(w.locked,"10.000000000000000000");
    const [{n}]=await q("SELECT count(*)::integer AS n FROM ledger WHERE ref_id=$1 AND type='rental_profit'",[r.id]);strict.equal(n,1);
  });
});
test("Delayed auto-renew settles every completed term without duplicate credits",async()=>{
  await sandbox(async(c,u)=>{
    const r=await profitRentalFixture(c,u,"hour",1,true),durationMs=3600000;
    const clock=new Date(new Date(r.end_at).getTime()+durationMs*2+1);
    await billRental(c,r.id,clock);await billRental(c,r.id,clock);
    const [saved]=await q("SELECT status,total_cost,end_at,data FROM rentals WHERE id=$1",[r.id],c);
    strict.equal(saved.status,"active");strict.equal(saved.total_cost,"15.000000000000000000");
    strict.equal(saved.data.profit_paid,"15.000000000000000000");
    strict.equal(new Date(saved.end_at).getTime(),new Date(r.end_at).getTime()+durationMs*3);
    const [w]=await q("SELECT balance,locked FROM wallets WHERE user_id=$1 AND currency='USDT'",[u.id],c);
    strict.equal(w.balance,"115.000000000000000000");strict.equal(w.locked,"10.000000000000000000");
    const [{n}]=await q("SELECT count(*)::integer AS n FROM ledger WHERE ref_id=$1 AND type='rental_profit'",[r.id],c);strict.equal(n,1);
    const [{valid}]=await q("SELECT balance=(SELECT sum(amount) FROM ledger WHERE user_id=$1 AND currency='USDT') AS valid FROM wallets WHERE user_id=$1 AND currency='USDT'",[u.id],c);strict.equal(valid,true);
  });
});
test("Extending a profit rental updates its estimate without charging or unlocking principal",async()=>{
  await sandbox(async(c,u)=>{
    const r=await profitRentalFixture(c,u,"hour",1,false);
    await extendRental(u,{id:r.id,duration:2},c);
    const [saved]=await q("SELECT end_at,data FROM rentals WHERE id=$1",[r.id],c);
    strict.equal(saved.data.expected_profit,"15.000000000000000000");strict.equal(saved.data.duration,3);
    strict.equal(saved.data.duration_ms,"10800000");
    const [w]=await q("SELECT balance,locked FROM wallets WHERE user_id=$1 AND currency='USDT'",[u.id],c);
    strict.equal(w.balance,"100.000000000000000000");strict.equal(w.locked,"10.000000000000000000");
  });
});
test("Concurrent replay of the same request returns its saved booking without charging again",async()=>{
  await concurrentFixture(async(u,assets)=>{
    const key=`request:${u.id}:rent:${uid()}`;
    const submit=()=>transaction(async c=>{
      const saved=await replayRequest(c,key);if(saved)return saved;
      const r=await startRental(u,{asset_id:assets[0],billing_mode:"hour",duration:1,units:1},c);
      const result={success:true,id:r.id};await record("request",result,u.id,key,c);return result;
    });
    const [a,b]=await Promise.all([submit(),submit()]);strict.deepEqual(a,b);
    const [{n}]=await q("SELECT count(*)::integer AS n FROM rentals WHERE user_id=$1",[u.id]);strict.equal(n,1);
    const [w]=await q("SELECT balance,locked FROM wallets WHERE user_id=$1",[u.id]);strict.equal(w.balance,"100.000000000000000000");strict.equal(w.locked,"10.000000000000000000");
  });
});
test("Mail retries preserve verification/reset data, honor backoff and stop after success",async()=>{
  await sandbox(async(c,u)=>{
    const id=uid(),data={token:"fixture-only-token",path:"/reset-password",origin:"https://example.invalid",language:"en"};
    await q(`INSERT INTO email_logs(id,"to",template,data) VALUES($1,$2,'password_reset',$3::jsonb)`,[id,u.email,JSON.stringify(data)],c);
    let attempts=0;
    const failing=async()=>{attempts++;throw Error("Fixture failure, no network");};
    const clock=new Date();
    strict.equal(await deliverQueuedEmail(id,failing,c,clock),true);
    strict.equal(await deliverQueuedEmail(id,failing,c,clock),false);strict.equal(attempts,1);
    const success=async(to:string,template:string,payload:any)=>{strict.equal(to,u.email);strict.equal(template,"password_reset");for(const key of Object.keys(data))strict.equal(payload[key],data[key as keyof typeof data]);attempts++;};
    strict.equal(await deliverQueuedEmail(id,success,c,new Date(clock.getTime()+121000)),true);
    strict.equal(await deliverQueuedEmail(id,success,c,new Date(clock.getTime()+1000000)),false);
    const [mail]=await q("SELECT status,attempts,data,error FROM email_logs WHERE id=$1",[id],c);
    strict.equal(mail.status,"sent");strict.equal(mail.attempts,2);strict.equal(mail.error,null);strict.equal(mail.data.next_attempt_at,undefined);strict.equal(attempts,2);
  });
});
test("Branded email templates use absolute hosted assets, safe content, links, and support details",()=>{
  const rendered=renderEmailMessage("verify_email",{subject:"{{title}} — {{site_name}}",body_html:defaultEmailTemplateBody("verify_email")+"<p>{{logo_url}} · {{support_email}} · {{site_url}} · {{year}}</p>"},{
    title:"Verify & secure your account",body:"Ignore <script>alert(1)</script>",username:"Amara",token:"fixture-token",path:"/verify-email",origin:"https://account.example.invalid",
  },{
    site_name:"Vexa",brand_color:"#14b8a6",support_email:"help@example.invalid",
    smtp:{from_email:"mail@example.invalid",public_url:"https://hosted.example.invalid",email_logo_url:"https://assets.example.invalid/mcv.png"},
  });
  strict.match(rendered.html,/src="https:\/\/assets\.example\.invalid\/mcv\.png"/);
  strict.match(rendered.html,/href="https:\/\/account\.example\.invalid\/verify-email\?token=fixture-token"/);
  strict.match(rendered.html,/mailto:help@example\.invalid/);
  strict.match(rendered.html,/https:\/\/hosted\.example\.invalid/);
  strict.doesNotMatch(rendered.html,/<script/i);
  strict.ok(rendered.text.includes("Need help?")&&rendered.text.includes("help@example.invalid"));
  strict.equal(rendered.replyTo,"help@example.invalid");
});
test("Email templates fall back to the actual request host or an embedded wordmark",()=>{
  const hosted=renderEmailMessage("welcome",null,{title:"Welcome",body:"Your account is ready.",origin:"https://new-host.example.invalid"},{site_name:"Vexa",smtp:{from_email:"mail@example.invalid"}});
  strict.match(hosted.html,/src="https:\/\/new-host\.example\.invalid\/icon-192\.png"/);
  const noHost=renderEmailMessage("welcome",null,{title:"Welcome",body:"Your account is ready."},{site_name:"Vexa",smtp:{from_email:"mail@example.invalid"}});
  strict.match(noHost.html,/>MCV<\/span>/);
  strict.doesNotMatch(noHost.html,/src="\/icon-192\.png"/);
});
test("Concurrent early stops release capital and settle prorated profit once",async()=>{
  await concurrentFixture(async(u,assets)=>{
    const r=await transaction(c=>startRental(u,{asset_id:assets[0],billing_mode:"hour",duration:1,units:1},c));
    await q("UPDATE rentals SET start_at=now()-interval '30 minutes',end_at=now()+interval '30 minutes',billed_until=now()+interval '30 minutes' WHERE id=$1",[r.id]);
    await Promise.all([transaction(c=>stopRental(u,{id:r.id},c)),transaction(c=>stopRental(u,{id:r.id},c))]);
    const [{n}]=await q("SELECT count(*)::integer AS n FROM ledger WHERE ref_id=$1 AND type='rental_profit'",[r.id]);strict.equal(n,1);
    const [{releases}]=await q("SELECT count(*)::integer AS releases FROM ledger WHERE ref_id=$1 AND type='rental_principal_release'",[r.id]);strict.equal(releases,1);
    const [a]=await q("SELECT available_units FROM assets WHERE id=$1",[assets[0]]);strict.equal(a.available_units,1);
    const [w]=await q("SELECT balance,locked FROM wallets WHERE user_id=$1 AND currency='USDT'",[u.id]);
    const [{balanceValid}]=await q("SELECT $1::numeric BETWEEN 105::numeric AND 105.001::numeric AS \"balanceValid\"",[w.balance]);
    strict.equal(balanceValid,true);strict.equal(w.locked,"0.000000000000000000");
    const [{valid}]=await q("SELECT balance=(SELECT sum(amount) FROM ledger WHERE user_id=$1 AND currency='USDT') AS valid FROM wallets WHERE user_id=$1 AND currency='USDT'",[u.id]);strict.equal(valid,true);
  });
});
test("Encrypted settings round trip without retaining plaintext",()=>{
  const plain="test-only-noncredential",a=encrypt(plain),b=encrypt(plain);
  strict.notEqual(a,b);strict.ok(!a.includes(plain));strict.equal(decrypt(a),plain);
});
test("Ledger deposit idempotency credits once and preserves exact decimals",async()=>{
  await sandbox(async(c,u)=>{
    await move(c,u.id,"USDT","0.1","deposit_credit","test-deposit","test-"+u.id);
    await move(c,u.id,"USDT","0.1","deposit_credit","test-deposit","test-"+u.id);
    await move(c,u.id,"USDT","0.2","deposit_credit","test-deposit-2","test2-"+u.id);
    const [w]=await q("SELECT balance FROM wallets WHERE user_id=$1",[u.id],c);
    strict.equal(w.balance,"0.300000000000000000");
    const [{n}]=await q("SELECT count(*)::integer AS n FROM ledger WHERE user_id=$1",[u.id],c);strict.equal(n,2);
  });
});
test("Withdrawal locks reserve funds without changing ledger balance",async()=>{
  await sandbox(async(c,u)=>{
    await move(c,u.id,"BTC","1","deposit_credit","funding","funding-"+u.id);
    await move(c,u.id,"BTC","0","withdrawal_lock","withdrawal","lock-"+u.id,"0.5");
    let [w]=await q("SELECT * FROM wallets WHERE user_id=$1",[u.id],c);
    strict.equal(w.balance,"1.000000000000000000");strict.equal(w.locked,"0.500000000000000000");
    await move(c,u.id,"BTC","-0.5","withdrawal_sent","withdrawal","sent-"+u.id,"-0.5");
    [w]=await q("SELECT * FROM wallets WHERE user_id=$1",[u.id],c);
    strict.equal(w.balance,"0.500000000000000000");strict.equal(w.locked,"0.000000000000000000");
  });
});
test("Rental rates are snapshotted and capacity is reserved transactionally",async()=>{
  await sandbox(async(c,u)=>{
    await move(c,u.id,"USDT","100","deposit_credit","funding","fund-"+u.id);
    const id=uid();
    await q(`INSERT INTO assets(id,type,title,description,location,category,total_units,available_units,currency,minute_rate,hour_rate,day_rate,data)
      VALUES($1,'machine','Test GPU','test','test','test',1,1,'USDT','0.1','5','100',$2::jsonb)`,
      [id,JSON.stringify({capital_required:"10",profit_rate_basis:"hour",profit_rate_value:"5"})],c);
    const r=await startRental(u,{asset_id:id,billing_mode:"hour",duration:2,units:1,auto_renew:false},c);
    strict.ok(Number.isFinite(new Date(r.start_at).getTime()),"Rental start must serialize as a real date");
    strict.equal(r.rate_snapshot,"5.000000000000000000");strict.equal(r.total_cost,"0.000000000000000000");
    strict.equal(r.data.principal_amount,"10");strict.equal(r.data.expected_profit,"10.000000000000000000");
    await q("UPDATE assets SET hour_rate=20 WHERE id=$1",[id],c);
    const [saved]=await q("SELECT rate_snapshot FROM rentals WHERE id=$1",[r.id],c);
    strict.equal(saved.rate_snapshot,"5.000000000000000000");
    const [a]=await q("SELECT available_units FROM assets WHERE id=$1",[id],c);strict.equal(a.available_units,0);
    const [w]=await q("SELECT balance,locked FROM wallets WHERE user_id=$1 AND currency='USDT'",[u.id],c);
    strict.equal(w.balance,"100.000000000000000000");strict.equal(w.locked,"10.000000000000000000");
  });
});
test.after(async()=>{await pool.end();});
