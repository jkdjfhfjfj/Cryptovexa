import { assert, str } from "./platform";

/** Review decisions may change status/reason, never the stored document identity or file. */
export function reviewDocuments(required:string[],stored:any[],updates:any[]=[]) {
  assert(Array.isArray(stored)&&Array.isArray(updates),"Invalid verification documents");
  const allowed=["submitted","approved","rejected"];
  for(const update of updates) {
    assert(typeof update.type==="string"&&stored.some(d=>d.type===update.type),"Unknown verification document");
    assert(allowed.includes(update.status),"Invalid document status");
  }
  return stored.map(d=>{
    const update=updates.find(x=>x.type===d.type);
    const status=update?.status??d.status??"submitted";
    const reason=status==="rejected"?str(update?.reject_reason??update?.reason??d.reject_reason,3,2000):"";
    assert(required.includes(d.type)&&typeof d.objectPath==="string"&&d.objectPath.length>0,"Required document file is missing");
    return {...d,status,reject_reason:reason};
  });
}
