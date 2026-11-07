// Development-only CLI. Never mounted as an HTTP route or imported by the runtime.
import { randomBytes } from "node:crypto";
import { readFile, writeFile, unlink } from "node:fs/promises";
import argon2 from "argon2";
import { pool } from "@workspace/db";
import { assert, q, uid, move, transaction } from "../lib/platform";
import { ObjectStorageService } from "../lib/objectStorage";

async function main(){
  assert(process.env.NODE_ENV!=="production","Fixture CLI is forbidden in production",403);
  const command=process.argv[2];
  if(command==="seed"){
    const run=uid(),customerId=uid(),adminId=uid(),withdrawalId=uid();
    const credentials={
      run,customerId,adminId,withdrawalId,
      customer:{email:`qa-manual-user-${run}@test.invalid`,password:randomBytes(24).toString("base64url")},
      admin:{email:`qa-manual-staff-${run}@test.invalid`,password:randomBytes(24).toString("base64url")},
    };
    const fixturePath=`/tmp/vexa-manual-withdrawal-${run}.json`;
    await writeFile(fixturePath,JSON.stringify(credentials),{mode:0o600,flag:"wx"});
    try{
      await transaction(async c=>{
        for(const [id,role,account] of [[customerId,"user",credentials.customer],[adminId,"superadmin",credentials.admin]] as const){
          await q(`INSERT INTO users(id,email,username,password_hash,role,referral_code,email_verified,data)
            VALUES($1,$2,$3,$4,$5,$6,true,$7::jsonb)`,
            [id,account.email,`QA manual ${role}`,await argon2.hash(account.password,{type:argon2.argon2id}),role,uid(),JSON.stringify({fixture_run:run})],c);
        }
        await move(c,customerId,"USDT","20","test_funding",run,`fixture-fund:${run}`);
        await move(c,customerId,"USDT","0","withdrawal_lock",withdrawalId,`fixture-lock:${run}`,"11");
        // NEVER queued or processing. This row can only be manually reviewed.
        await q(`INSERT INTO withdrawals(id,user_id,currency,network,address,amount,fee,status,data)
          VALUES($1,$2,'USDT','BEP20','TEST ONLY - NO TRANSFER DESTINATION','10','1','manual_fallback',$3::jsonb)`,
          [withdrawalId,customerId,JSON.stringify({total:"11",usd_value:"10",fixture_run:run,test_only:true})],c);
      });
    }catch(e){await unlink(fixturePath);throw e;}
    process.stdout.write(JSON.stringify({fixturePath,customerId,adminId,withdrawalId})+"\n");
  }else if(command==="cleanup"){
    const path=process.argv[3]??"";
    assert(/^\/tmp\/vexa-manual-withdrawal-[a-f0-9-]+\.json$/.test(path),"Unexpected fixture path");
    const f=JSON.parse(await readFile(path,"utf8")),ids=[f.customerId,f.adminId],emails=[f.customer.email,f.admin.email];
    const users=await q("SELECT id,email,data FROM users WHERE id=ANY($1::text[])",[ids]);
    assert(users.every(u=>u.data.fixture_run===f.run&&emails.includes(u.email)&&u.email.endsWith("@test.invalid")),"Fixture ownership check failed");
    const files=await q("SELECT object_path FROM private_files WHERE user_id=ANY($1::text[])",[ids]);
    for(const file of files){
      const object=await new ObjectStorageService().getObjectEntityFile(file.object_path);
      await object.delete({ignoreNotFound:true});
    }
    await transaction(async c=>{
      await q("DELETE FROM platform_records WHERE kind='reconciliation' AND id IN (SELECT entity_id FROM audit_logs WHERE actor_id=ANY($1::text[]) AND action='reconcile')",[ids],c);
      for(const table of ["rentals","deposits","withdrawals","ledger","wallets","login_sessions","security_tokens","private_files","platform_records"]){
        await q(`DELETE FROM ${table} WHERE user_id=ANY($1::text[])`,[ids],c);
      }
      await q("DELETE FROM audit_logs WHERE actor_id=ANY($1::text[])",[ids],c);
      await q('DELETE FROM email_logs WHERE "to"=ANY($1::text[])',[emails],c);
      await q("DELETE FROM users WHERE id=ANY($1::text[])",[ids],c);
    });
    await unlink(path);
    process.stdout.write(JSON.stringify({cleaned:true})+"\n");
  }else throw Error("Use seed, or cleanup /tmp/vexa-manual-withdrawal-<run>.json");
}
main().catch(e=>{process.stderr.write(String(e.message)+"\n");process.exitCode=1;}).finally(()=>pool.end());
