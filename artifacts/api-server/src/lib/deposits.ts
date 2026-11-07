import { amount, assert, event, move, q } from "./platform";
import { referralCommission } from "./services";

/** Shared by the review endpoint and regression tests; callers supply the transaction. */
export async function approveDeposit(c:any,id:string,actorId:string|null,value?:unknown,reason="Approved") {
  const [d]=await q("SELECT * FROM deposits WHERE id=$1 FOR UPDATE",[id],c);
  assert(d,"Deposit not found",404);
  if(d.status==="approved")return {alreadyCredited:true,deposit:d};
  assert(["pending_review","needs_info"].includes(d.status),"This deposit has already been reviewed");
  const credit=amount(value??d.amount_claimed);
  await move(c,d.user_id,d.currency,credit,"deposit_credit",d.id,`deposit:${d.id}`);
  const [deposit]=await q("UPDATE deposits SET status='approved',amount_credited=$1,reviewed_by=$2,review_note=$3 WHERE id=$4 RETURNING *",[credit,actorId,reason,d.id],c);
  const [previous]=await q("SELECT id FROM deposits WHERE user_id=$1 AND id!=$2 AND status='approved' LIMIT 1",[d.user_id,d.id],c);
  await referralCommission(c,d.user_id,d.id,credit,d.currency,previous?"every_deposit":"first_deposit");
  await event(d.user_id,"Deposit credited",`${credit} ${d.currency} has been credited to your wallet.`,"deposit_approved",c);
  return {alreadyCredited:false,deposit};
}
