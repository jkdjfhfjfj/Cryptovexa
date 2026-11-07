import test from "node:test";
import strict from "node:assert/strict";
import { pool } from "@workspace/db";
import { q, uid, move, amount, encrypt, decrypt, putSetting, config, record, transaction } from "../lib/platform";
import { startRental, stopRental, billRental } from "../lib/rentals";
import { approveDeposit } from "../lib/deposits";
import { referralCommission, settleWithdrawal } from "../lib/services";
import { reviewDocuments } from "../lib/verification";

async function sandbox(fn:(c:any,u:any)=>Promise<void>){
  const c=await pool.connect();
  await c.query("BEGIN");
  try{
    const id=uid();
    const [u]=await q("INSERT INTO users(id,email,username,password_hash,referral_code) VALUES($1,$2,'Test','unused',$3) RETURNING *",[id,`${id}@test.invalid`,uid()],c);
    await fn(c,u);
  }finally{await c.query("ROLLBACK");c.release();}
}
test("Money validation rejects floats, exponents, negatives and zero",()=>{
  for(const n of [0.1,1,"1e3","-1","0","0.000","NaN","1.1234567890123456789"])strict.throws(()=>amount(n));
  strict.equal(amount("0.000000000000000001"),"0.000000000000000001");
});
async function rentalFixture(c:any,u:any,mode="minute",duration=3,autoRenew=false){
  await move(c,u.id,"USDT","100","test_funding","funding",`fund:${u.id}`);
  const id=uid();
  await q(`INSERT INTO assets(id,type,title,description,location,category,total_units,available_units,currency,minute_rate,hour_rate,day_rate)
    VALUES($1,'machine','Regression fixture','Test only','Test only','Test only',1,1,'USDT','1','5','20')`,[id],c);
  return startRental(u,{asset_id:id,billing_mode:mode,duration,units:1,auto_renew:autoRenew},c);
}
test("Delayed minute billing settles the last periods once before releasing capacity",async()=>{
  await sandbox(async(c,u)=>{
    const r=await rentalFixture(c,u),clock=new Date(new Date(r.end_at).getTime()+60000);
    await billRental(c,r.id,clock);
    await billRental(c,r.id,clock);
    const [saved]=await q("SELECT * FROM rentals WHERE id=$1",[r.id],c);
    const [a]=await q("SELECT available_units FROM assets WHERE id=$1",[r.asset_id],c);
    strict.equal(saved.status,"completed");strict.equal(saved.total_cost,"3.000000000000000000");strict.equal(a.available_units,1);
    const [w]=await q("SELECT balance FROM wallets WHERE user_id=$1",[u.id],c);strict.equal(w.balance,"97.000000000000000000");
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
test("Early-stop refunds use the rental's original currency after asset edits",async()=>{
  await sandbox(async(c,u)=>{
    const r=await rentalFixture(c,u,"hour",2);
    await q("UPDATE assets SET currency='BTC',hour_rate='0.1' WHERE id=$1",[r.asset_id],c);
    await stopRental(u,{id:r.id},c);
    const [refund]=await q("SELECT currency FROM ledger WHERE user_id=$1 AND type='rental_refund'",[u.id],c);
    strict.equal(refund.currency,"USDT");
    const [saved]=await q("SELECT total_cost>=0 AS valid FROM rentals WHERE id=$1",[r.id],c);strict.ok(saved.valid);
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
      for(const asset of assetIds)await q(`INSERT INTO assets(id,type,title,description,location,category,total_units,available_units,currency,hour_rate)
        VALUES($1,'machine','QA concurrency fixture','Test only','Test only','Test only',1,1,'USDT','10')`,[asset],c);
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
    const [w]=await q("SELECT balance FROM wallets WHERE user_id=$1",[u.id]);strict.equal(w.balance,"90.000000000000000000");
  });
});
test("Concurrent rentals cannot spend the same wallet balance twice",async()=>{
  await concurrentFixture(async(u,assets)=>{
    const outcomes=await Promise.allSettled(assets.map(asset=>transaction(c=>startRental(u,{asset_id:asset,billing_mode:"hour",duration:1,units:1},c))));
    strict.equal(outcomes.filter(o=>o.status==="fulfilled").length,1);
    const [w]=await q("SELECT balance,locked FROM wallets WHERE user_id=$1",[u.id]);
    strict.equal(w.balance,"0.000000000000000000");strict.equal(w.locked,"0.000000000000000000");
    const [{n}]=await q("SELECT count(*)::integer AS n FROM rentals WHERE user_id=$1",[u.id]);strict.equal(n,1);
  },"10");
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
    await q(`INSERT INTO assets(id,type,title,description,location,category,total_units,available_units,currency,minute_rate,hour_rate,day_rate)
      VALUES($1,'machine','Test GPU','test','test','test',1,1,'USDT','0.1','5','100')`,[id],c);
    const r=await startRental(u,{asset_id:id,billing_mode:"hour",duration:2,units:1,auto_renew:false},c);
    strict.ok(Number.isFinite(new Date(r.start_at).getTime()),"Rental start must serialize as a real date");
    strict.equal(r.rate_snapshot,"5.000000000000000000");strict.equal(r.total_cost,"10.000000000000000000");
    await q("UPDATE assets SET hour_rate=20 WHERE id=$1",[id],c);
    const [saved]=await q("SELECT rate_snapshot FROM rentals WHERE id=$1",[r.id],c);
    strict.equal(saved.rate_snapshot,"5.000000000000000000");
    const [a]=await q("SELECT available_units FROM assets WHERE id=$1",[id],c);strict.equal(a.available_units,0);
  });
});
test.after(async()=>{await pool.end();});
