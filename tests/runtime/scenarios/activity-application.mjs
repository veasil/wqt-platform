import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {initDb,closeDb,dbRun,dbGet} from '../../../src/db.js';
import {initCardsDb,closeCardsDb,cardsDbRun} from '../../../src/cards-db.js';
import {applyActivity} from '../../../src/platform/accounts/activity-service.js';
if(process.env.WQT_RUNTIME_TEST_CHILD!=='1')throw new Error('owned harness required');
export async function run(){
 await initDb();await initCardsDb();
 try{
  const now=Date.now();
  const identity=(await dbRun("INSERT INTO identities(phone,created_at) VALUES('synthetic-activity',?)",[now])).lastID;
  const org=(await dbRun("INSERT INTO organizations(name,owner_user_id) VALUES('synthetic activity org',0)")).lastID;
  const account=(await dbRun("INSERT INTO accounts(organization_id,name,valid_until,created_at) VALUES(?,'applicant',?,?)",[org,now+86400000,now])).lastID;
  await dbRun('INSERT INTO account_bindings(account_id,identity_id,started_at) VALUES(?,?,?)',[account,identity,now]);
  const actor={identityId:identity,accountId:account};
  const group=(await cardsDbRun("INSERT INTO card_groups(name,released_ids_json,created_at) VALUES('creation config','[]',?)",[now])).lastID;
  const input={requestId:randomUUID(),name:'synthetic application',location:'test location',started_at:now,configuration:{cardGroupId:group,duration:300,counts:[1,0,0],mode:'standard',ageRange:{min:8,max:12}}};
  const results=await Promise.all(Array.from({length:8},()=>applyActivity(actor,input)));
  assert.ok(results.every(x=>x.id===results[0].id));
  assert.equal((await dbGet('SELECT COUNT(*)::int AS n FROM activities WHERE created_by_account_id=?',[account])).n,1);
  const row=await dbGet('SELECT * FROM activities WHERE id=?',[results[0].id]);
  assert.equal(row.status,'active');assert.equal(JSON.parse(row.game_config_json).ageRange.max,12);assert.equal((await dbGet('SELECT COUNT(*)::int AS n FROM activity_creation_notifications WHERE activity_id=?',[row.id])).n,1);assert.equal(row.enterprise_id,org);assert.equal(row.created_by_identity_id,identity);
  await assert.rejects(applyActivity(actor,{...input,name:'changed'}),/requestId/);
  await assert.rejects(applyActivity({identityId:identity+100,accountId:account},input),/requestId|账号/);
  for(const [table,field,value,reset] of [['accounts','valid_until',now-1,now+86400000],['accounts','status','suspended','active'],['identities','status','suspended','active'],['organizations','status','suspended','active']]){
   const id=table==='accounts'?account:table==='identities'?identity:org;
   await dbRun(`UPDATE ${table} SET ${field}=? WHERE id=?`,[value,id]);
   await assert.rejects(applyActivity(actor,{...input,requestId:randomUUID()}),/账号|权益/);
   await assert.rejects(applyActivity(actor,input),/账号|权益/);
   await dbRun(`UPDATE ${table} SET ${field}=? WHERE id=?`,[reset,id]);
  }
  await dbRun('UPDATE accounts SET valid_until=NULL WHERE id=?',[account]);
  await dbRun('UPDATE identities SET trial_until=? WHERE id=?',[now+86400000,identity]);
  await assert.rejects(applyActivity(actor,{...input,requestId:randomUUID()}),/权益/);
  await dbRun('UPDATE accounts SET valid_until=? WHERE id=?',[now+86400000,account]);
  await dbRun('UPDATE account_bindings SET ended_at=? WHERE account_id=?',[now,account]);
  await assert.rejects(applyActivity(actor,input),/账号/);
  console.log('ACTIVITY_APPLICATION_PASS');
 }finally{await closeCardsDb();await closeDb()}
}
