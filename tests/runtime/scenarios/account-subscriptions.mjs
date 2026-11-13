import assert from 'node:assert/strict';
import { initDb,closeDb,dbRun,dbGet,dbAll } from '../../../src/db.js';
import { deliverSubscription,renewSubscription,bindAccount,addCalendarYear } from '../../../src/platform/accounts/service.js';

if (process.env.WQT_RUNTIME_TEST_CHILD !== '1') throw new Error('owned harness required');
export async function run() {
  await initDb();
  try {
    const now=Date.now(), identities=[];
    for (let index=0;index<6;index++) identities.push((await dbRun('INSERT INTO identities(phone,created_at) VALUES(?,?)',[`identity-${index}`,now])).lastID);
    const bossAccount=(await dbRun("INSERT INTO accounts(organization_id,name,role,created_at) VALUES(0,'boss','boss',?)",[now])).lastID;
    await dbRun('INSERT INTO account_bindings(account_id,identity_id,started_at) VALUES(?,?,?)',[bossAccount,identities[0],now]);
    const boss={ identityId:identities[0],accountId:bossAccount };
    const deliveryInput={ requestId:'delivery-group-001',organizationName:'Group',plan:'group' };
    const [first,duplicate]=await Promise.all([deliverSubscription(boss,deliveryInput),deliverSubscription(boss,deliveryInput)]);
    assert.deepEqual(first,duplicate);
    assert.equal(first.accountIds.length,5);
    assert.equal((await dbGet('SELECT COUNT(*) AS count FROM subscriptions')).count,1);
    await assert.rejects(deliverSubscription(boss,{...deliveryInput,organizationName:'Other'}),/requestId/);
    const personal=await deliverSubscription(boss,{ requestId:'delivery-personal-001',organizationName:'Personal',plan:'personal' });
    const city=await deliverSubscription(boss,{ requestId:'delivery-city-001',organizationName:'City',plan:'city',validUntil:now+86400000 });
    assert.equal(personal.accountIds.length,1); assert.equal(city.accountIds.length,20);
    await assert.rejects(deliverSubscription(boss,{ requestId:'delivery-city-invalid',organizationName:'City',plan:'city' }),/明确首次/);
    await assert.rejects(dbRun("INSERT INTO accounts(organization_id,subscription_id,name,created_at) VALUES(?,?,'extra',?)",[first.organizationId,first.subscriptionId,now]),/capacity/);
    const a1=first.accountIds[0],a2=first.accountIds[1];
    await bindAccount(boss,{ requestId:'first-bind-a1-001',accountId:a1,identityId:identities[1] });
    await assert.rejects(bindAccount(boss,{requestId:'duplicate-org-first-bind',accountId:a2,identityId:identities[1]}),/此组织已绑定/);
    assert.equal(await dbGet('SELECT id FROM account_bindings WHERE account_id=? AND ended_at IS NULL',[a2]),undefined);
    await bindAccount(boss,{ requestId:'first-bind-a2-001',accountId:a2,identityId:identities[5] });
    await assert.rejects(bindAccount(boss,{requestId:'duplicate-org-rebind',accountId:a1,identityId:identities[5]}),/此组织已绑定/);
    assert.equal((await dbGet('SELECT identity_id FROM account_bindings WHERE account_id=? AND ended_at IS NULL',[a1])).identity_id,identities[1]);
    assert.equal((await dbGet("SELECT COUNT(*) AS count FROM account_operations WHERE request_id IN ('duplicate-org-first-bind','duplicate-org-rebind')")).count,0);
    assert.equal((await dbGet('SELECT rebind_count FROM subscriptions WHERE id=?',[first.subscriptionId])).rebind_count,0);
    const before=await dbGet('SELECT * FROM accounts WHERE id=?',[a1]);
    await bindAccount(boss,{ requestId:'rebind-a1-first-001',accountId:a1,identityId:identities[2] });
    // Different accounts compete for the final package-wide chance.
    const last=await Promise.allSettled([
      bindAccount(boss,{ requestId:'rebind-a1-last-001',accountId:a1,identityId:identities[3] }),
      bindAccount(boss,{ requestId:'rebind-a2-last-001',accountId:a2,identityId:identities[4] }),
    ]);
    assert.equal(last.filter(result=>result.status==='fulfilled').length,1);
    assert.equal(last.filter(result=>result.status==='rejected').length,1);
    assert.match(last.find(result=>result.status==='rejected').reason.message,/两次/);
    const after=await dbGet('SELECT * FROM accounts WHERE id=?',[a1]);
    assert.deepEqual(after,before);
    const renewalInput={ requestId:'renew-group-001',subscriptionId:first.subscriptionId };
    const [renewed,repeated]=await Promise.all([renewSubscription(boss,renewalInput),renewSubscription(boss,renewalInput)]);
    assert.deepEqual(renewed,repeated);
    assert.equal(renewed.validUntil,addCalendarYear(first.validUntil));
    assert.equal(renewed.rebindCount,2);
    assert.equal((await dbGet('SELECT COUNT(*) AS count FROM accounts WHERE subscription_id=?',[first.subscriptionId])).count,5);
    // City administrators can rebind ordinary accounts of their own city.
    await dbRun("UPDATE accounts SET role='enterprise' WHERE id=?",[city.accountIds[0]]);
    await bindAccount(boss,{requestId:'city-admin-first-bind',accountId:city.accountIds[0],identityId:identities[1]});
    await bindAccount(boss,{requestId:'city-member-first-bind',accountId:city.accountIds[1],identityId:identities[2]});
    const admin={identityId:identities[1],accountId:city.accountIds[0]};
    await bindAccount(admin,{requestId:'city-member-rebind-001',accountId:city.accountIds[1],identityId:identities[3]});
    await assert.rejects(bindAccount(admin,{requestId:'city-cross-org-rebind',accountId:a1,identityId:identities[2]}),/无权/);
    await assert.rejects(renewSubscription(admin,{requestId:'city-admin-renew-001',subscriptionId:city.subscriptionId}),/无权/);
    await dbRun('UPDATE subscriptions SET starts_at=?,valid_until=? WHERE id=?',[now-86400000,now-1,city.subscriptionId]);
    await assert.rejects(bindAccount(admin,{requestId:'expired-city-rebind-001',accountId:city.accountIds[1],identityId:identities[4]}),/无权/);
    const expiredRenewal=await renewSubscription(boss,{requestId:'renew-city-after-expiry',subscriptionId:city.subscriptionId});
    assert.ok(expiredRenewal.validUntil>=addCalendarYear(now));
    assert.equal((await dbAll('SELECT * FROM account_bindings WHERE account_id=? AND ended_at IS NULL',[a1])).length,1);
    assert.equal(addCalendarYear(Date.UTC(2024,1,29)),Date.UTC(2025,1,28));
    console.log(JSON.stringify({subscriptionRace:true,deliveryIdempotent:true,renewalIdempotent:true}));
  } finally { await closeDb(); }
}
