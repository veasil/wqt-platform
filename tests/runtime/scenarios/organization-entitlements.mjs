import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {initDb,closeDb,dbRun,dbGet} from '../../../src/db.js';
import {deliverSubscription,bindAccount} from '../../../src/platform/accounts/service.js';
import {updateOrganizationEntitlements} from '../../../src/platform/accounts/organization-entitlements.js';
import {accountActor} from '../../../src/platform/accounts/context.js';
if(process.env.WQT_RUNTIME_TEST_CHILD!=='1')throw new Error('owned harness required');
export async function run(){
 await initDb();
 try{
  const now=Date.now(),people=[];
  for(let i=0;i<9;i++)people.push((await dbRun('INSERT INTO identities(phone,created_at) VALUES(?,?)',['synthetic-rights-'+i,now])).lastID);
  const bossId=(await dbRun("INSERT INTO accounts(organization_id,name,role,created_at) VALUES(0,'boss','boss',?)",[now])).lastID;
  await dbRun('INSERT INTO account_bindings(account_id,identity_id,started_at) VALUES(?,?,?)',[bossId,people[0],now]);
  const boss={identityId:people[0],accountId:bossId};
  const group=await deliverSubscription(boss,{requestId:randomUUID(),organizationName:'rights group',plan:'group'});
  const input={requestId:randomUUID(),organizationId:group.organizationId,capacity:3,plan:'city',validUntil:now+86400000,reason:'synthetic custom grant'};
  const rows=await Promise.all(Array.from({length:8},()=>updateOrganizationEntitlements(boss,input)));
  assert.ok(rows.every(row=>row.after.capacity===3));
  assert.equal((await dbGet('SELECT COUNT(*)::int AS n FROM accounts WHERE organization_id=?',[group.organizationId])).n,5);
  assert.equal((await dbGet("SELECT COUNT(*)::int AS n FROM account_operations WHERE operation='organization-entitlements'")).n,1);
  for(let i=0;i<3;i++)await bindAccount(boss,{requestId:randomUUID(),accountId:group.accountIds[i],identityId:people[i+1]});
  await assert.rejects(bindAccount(boss,{requestId:randomUUID(),accountId:group.accountIds[3],identityId:people[4]}),/容量/);
  await updateOrganizationEntitlements(boss,{...input,requestId:randomUUID(),capacity:2});
  assert.ok(await accountActor({identityId:people[1],accountId:group.accountIds[0]}));
  await bindAccount(boss,{requestId:randomUUID(),accountId:group.accountIds[0],identityId:people[5]});
  assert.equal((await dbGet('SELECT rebind_count FROM subscriptions WHERE id=?',[group.subscriptionId])).rebind_count,1);
  await assert.rejects(dbRun("INSERT INTO accounts(organization_id,subscription_id,name,created_at) VALUES(?,?,'forbidden',?)",[group.organizationId,group.subscriptionId,now]),/capacity/);
  await updateOrganizationEntitlements(boss,{...input,requestId:randomUUID(),capacity:7,plan:'personal'});
  assert.equal((await dbGet('SELECT COUNT(*)::int AS n FROM accounts WHERE organization_id=?',[group.organizationId])).n,7);
  assert.equal((await dbGet('SELECT rebind_count FROM subscriptions WHERE id=?',[group.subscriptionId])).rebind_count,1);
  await assert.rejects(updateOrganizationEntitlements({identityId:people[2],accountId:group.accountIds[1]},{...input,requestId:randomUUID()}),/无权/);
  await assert.rejects(updateOrganizationEntitlements(boss,{...input,capacity:4}),/requestId/);
  const internal=(await dbRun("INSERT INTO organizations(name,owner_user_id) VALUES('internal rights',0)")).lastID;
  const internalAccount=(await dbRun("INSERT INTO accounts(organization_id,name,valid_until,created_at) VALUES(?,'internal owner',?,?)",[internal,now+1000,now])).lastID;
  await dbRun('INSERT INTO account_bindings(account_id,identity_id,started_at) VALUES(?,?,?)',[internalAccount,people[7],now]);
  await updateOrganizationEntitlements(boss,{...input,requestId:randomUUID(),organizationId:internal,capacity:4});
  const current=await accountActor({identityId:people[7],accountId:internalAccount});
  assert.equal(current.plan,'city');assert.equal(current.valid_until,input.validUntil);
  assert.equal((await dbGet('SELECT COUNT(*)::int AS n FROM subscriptions WHERE organization_id=?',[internal])).n,0);
  await updateOrganizationEntitlements(boss,{...input,requestId:randomUUID(),organizationId:internal,capacity:2,validUntil:now-1});
  assert.equal((await accountActor({identityId:people[7],accountId:internalAccount})).paid_valid,false);
  assert.equal((await dbGet('SELECT COUNT(*)::int AS n FROM accounts WHERE organization_id=?',[internal])).n,4);
  await closeDb();await initDb();
  assert.equal((await dbGet('SELECT account_count FROM subscriptions WHERE id=?',[group.subscriptionId])).account_count,7);
  console.log('ORGANIZATION_ENTITLEMENTS_PASS');
 }finally{await closeDb()}
}
