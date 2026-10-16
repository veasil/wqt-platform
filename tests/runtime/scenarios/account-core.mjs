import {initIdentitySessions,closeIdentitySessions} from '../../../src/services/identity-sessions.js';
import assert from 'node:assert/strict';
import { initDb, closeDb, dbGet, dbRun, withTransaction } from '../../../src/db.js';
import { startSession as start, finishSession as finish, writeEvent as event } from '../../../src/game/sessions/service.js';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import {registerWithInvite} from '../../../src/platform/accounts/invitation.js';
import {smsStore} from '../../../src/services/sms.js';
import {changeIdentityPhone,setStatus} from '../../../src/platform/accounts/service.js';
import {accountActor} from '../../../src/platform/accounts/context.js';
import { accessibleSession } from '../../../src/platform/access/session-scope.js';

if (process.env.WQT_RUNTIME_TEST_CHILD !== '1') throw new Error('owned harness required');
const startSession = (actor,input) => start(actor,{requestId:randomUUID(),...input});
const finishSession = (actor,input) => finish(actor,{requestId:randomUUID(),...input});
const writeEvent = (actor,input) => event(actor,{requestId:randomUUID(),...input});
export async function run() {
  await initDb();
  await initIdentitySessions();
  try {
    const now = Date.now();
    const i1 = (await dbRun("INSERT INTO identities(phone,created_at) VALUES('test-identity-1',?)", [now])).lastID;
    const i2 = (await dbRun("INSERT INTO identities(phone,created_at) VALUES('test-identity-2',?)", [now])).lastID;
    const i3 = (await dbRun("INSERT INTO identities(phone,created_at) VALUES('test-identity-3',?)", [now])).lastID;
    const orgA = (await dbRun("INSERT INTO organizations(name,owner_user_id) VALUES('A',0)")).lastID;
    const orgB = (await dbRun("INSERT INTO organizations(name,owner_user_id) VALUES('B',0)")).lastID;
    const subscription = (await dbRun("INSERT INTO subscriptions(organization_id,plan,account_count,starts_at,valid_until,created_at) VALUES(?,'city',20,?,?,?)", [orgA, now, now + 86400000, now])).lastID;
    const a1 = (await dbRun("INSERT INTO accounts(organization_id,subscription_id,name,role,created_at) VALUES(?,?,'A1','enterprise',?)", [orgA, subscription, now])).lastID;
    const a2 = (await dbRun("INSERT INTO accounts(organization_id,subscription_id,name,created_at) VALUES(?,?,'A2',?)", [orgA, subscription, now])).lastID;
    const b3 = (await dbRun("INSERT INTO accounts(organization_id,name,valid_until,created_at) VALUES(?,'B3',?,?)", [orgB, now + 86400000, now])).lastID;
    const free1 = (await dbRun("INSERT INTO accounts(organization_id,name,created_at) VALUES(0,'free-1',?)", [now])).lastID;
    const free2 = (await dbRun("INSERT INTO accounts(organization_id,name,created_at) VALUES(0,'free-2',?)", [now])).lastID;
    for (const [account, identity] of [[a1,i1],[a2,i2],[b3,i1],[free1,i1],[free2,i2]]) await dbRun('INSERT INTO account_bindings(account_id,identity_id,started_at) VALUES(?,?,?)', [account,identity,now]);
    const A = { identityId:i1, accountId:a1 }, B = { identityId:i1, accountId:b3 };
    const created = await startSession(A, { ts:now });
    const retryInput = {requestId:randomUUID(),ts:now,location:'retry-test'};
    const parallelStarts = await Promise.all(Array.from({length:8},()=>start(A,retryInput)));
    assert.ok(parallelStarts.every(result=>result.sessionId===parallelStarts[0].sessionId));
    assert.equal((await dbGet("SELECT COUNT(*)::int AS count FROM game_sessions WHERE location='retry-test'")).count,1);
    await assert.rejects(start(A,{...retryInput,location:'different'}),/requestId/);
    const eventInput={requestId:randomUUID(),sessionId:created.sessionId,type:'duplicate-event',payload:{value:1}};
    await Promise.all(Array.from({length:8},()=>event(A,eventInput)));
    await event(A,{payload:{value:1},type:eventInput.type,sessionId:eventInput.sessionId,requestId:eventInput.requestId});
    assert.equal((await dbGet("SELECT COUNT(*)::int AS count FROM game_events WHERE session_id=? AND type='duplicate-event'",[created.sessionId])).count,1);
    const finishInput={requestId:randomUUID(),sessionId:parallelStarts[0].sessionId,finalScore:9};
    const parallelFinishes=await Promise.all(Array.from({length:8},()=>finish(A,finishInput)));
    assert.ok(parallelFinishes.every(result=>result.finalScore===9));
    const bSession = await startSession(B, { ts:now });
    const a2Session = await startSession({ identityId:i2, accountId:a2 }, { ts:now });
    await writeEvent(A, { sessionId:created.sessionId, type:'game_start' });
    assert.equal((await finishSession(A, { sessionId:created.sessionId, finalScore:7 })).finalScore, 7);
    assert.equal((await dbGet('SELECT * FROM game_sessions WHERE id=?', [created.sessionId])).account_id, a1);
    assert.equal((await dbGet('SELECT * FROM game_sessions WHERE id=?', [created.sessionId])).user_id, null);
    assert.equal(await accessibleSession(B, created.sessionId), undefined);
    assert.ok(await accessibleSession(A, a2Session.sessionId)); // city administrator can read, not write.
    assert.equal(await accessibleSession(A, a2Session.sessionId, { write:true }), undefined);
    assert.equal(await accessibleSession(A, bSession.sessionId), undefined);
    await assert.rejects(dbRun('UPDATE accounts SET organization_id=? WHERE id=?', [orgB,a1]), /immutable/);
    await assert.rejects(dbRun('UPDATE game_sessions SET account_id=? WHERE id=?', [b3,created.sessionId]), /immutable/);
    await assert.rejects(dbRun('INSERT INTO account_bindings(account_id,identity_id,started_at) VALUES(?,?,?)', [a1,i2,now]), /duplicate key/);
    await assert.rejects(dbRun("INSERT INTO accounts(organization_id,subscription_id,name,created_at) VALUES(?,?,'bad',?)", [orgB,subscription,now]), /foreign key/);
    // Expired accounts retain history and can finish accepted games, but cannot start new ones.
    await dbRun('UPDATE subscriptions SET valid_until=? WHERE id=?', [now + 1, subscription]);
    await assert.rejects(startSession(A, {}), /有效付费/);
    assert.ok(await accessibleSession(A, created.sessionId));
    await writeEvent(A, { sessionId:created.sessionId, type:'game_end' });
    // Free organization is real. Sharing organization 0 does not share account history.
    await dbRun('UPDATE identities SET trial_started_at=?,trial_until=? WHERE id IN (?,?)', [now,now+86400000,i1,i2]);
    await dbRun("INSERT INTO activities(name,activity_code,status) VALUES('public','TRIAL','active')");
    await assert.rejects(startSession({ identityId:i1, accountId:free1 }, {}), /活动码/);
    const freeSession = await startSession({ identityId:i1, accountId:free1 }, { activityCode:'TRIAL' });
    assert.equal(await accessibleSession({ identityId:i2, accountId:free2 }, freeSession.sessionId), undefined);
    // Force rebind to hold the same account lock while a stale writer waits.
    let release;
    const gate = new Promise(resolve => { release=resolve; });
    let locked;
    const lockReady = new Promise(resolve => { locked=resolve; });
    const rebind = withTransaction(async tx => {
      await tx.get('SELECT id FROM accounts WHERE id=? FOR UPDATE', [a1]);
      locked(); await gate;
      await tx.run('UPDATE account_bindings SET ended_at=? WHERE account_id=? AND ended_at IS NULL', [Date.now(),a1]);
      await tx.run('INSERT INTO account_bindings(account_id,identity_id,started_at) VALUES(?,?,?)', [a1,i3,Date.now()]);
    });
    await lockReady;
    const staleWrite = writeEvent(A, { sessionId:created.sessionId, type:'revoked_write' });
    const rejection = assert.rejects(staleWrite, /绑定已失效/);
    try {
      let waiting = false;
      for (let attempt=0; attempt<100; attempt++) {
        const row = await dbGet("SELECT COUNT(*)::int AS count FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%FROM accounts a%'");
        if (row.count > 0) { waiting=true; break; }
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      assert.equal(waiting, true, 'stale writer must actually wait on the account lock');
    } finally { release(); }
    await rebind; await rejection;
    await assert.rejects(start(A,retryInput),/绑定已失效/);
    assert.equal(await accessibleSession(A, created.sessionId), undefined);
    assert.ok(await accessibleSession({ identityId:i3, accountId:a1 }, created.sessionId));
    assert.ok(await accessibleSession(B, bSession.sessionId));
    await dbRun("UPDATE identities SET status='suspended' WHERE id=?", [i1]);
    assert.equal(await accessibleSession(B, bSession.sessionId), undefined);
    // Last invite use is serialized; the losing registration leaves no identity or free account behind.
    await dbRun("INSERT INTO invite_codes(code,type,organization_id,created_by,max_uses,expires_at) VALUES('ONCE','general',0,0,1,?)",[Date.now()+86400000]);
    const registrations=['16600000011','16600000012'].map(phone=>{
      smsStore.set(phone,{code:'222222',expiresAt:Date.now()+300000});
      return registerWithInvite({requestId:randomUUID(),phone,code:'ONCE',smsCode:'222222',password:'test-password',realName:'person',nickname:'guardian'});
    });
    const outcomes=await Promise.allSettled(registrations);
    assert.equal(outcomes.filter(result=>result.status==='fulfilled').length,1);
    assert.equal((await dbGet("SELECT COUNT(*)::int AS count FROM identities WHERE phone IN ('16600000011','16600000012')")).count,1);
    assert.equal((await dbGet("SELECT used_count FROM invite_codes WHERE code='ONCE'")).used_count,1);
    const registered=outcomes.find(result=>result.status==='fulfilled').value;
    assert.equal((await dbGet('SELECT organization_id FROM accounts WHERE id=?',[registered.result.accountId])).organization_id,0);
    const reusePhone='16600000013';
    const reuseId=(await dbRun('INSERT INTO identities(phone,password_hash,guardian_name,watcher_level,created_at) VALUES(?,?,?,?,?)',[reusePhone,bcrypt.hashSync('original-password',10),'original-name','mentor',now])).lastID;
    await dbRun("INSERT INTO invite_codes(code,type,organization_id,created_by,max_uses,expires_at) VALUES('REUSE','organization',?,0,2,?)",[orgA,Date.now()+86400000]);
    await dbRun('UPDATE subscriptions SET valid_until=? WHERE id=?',[now+86400000,subscription]);
    const vacant=(await dbRun("INSERT INTO accounts(organization_id,subscription_id,name,created_at) VALUES(?,?,'vacant',?)",[orgA,subscription,now])).lastID;
    smsStore.set(reusePhone,{code:'222222',expiresAt:Date.now()+300000});
    const reuseInput={requestId:randomUUID(),phone:reusePhone,code:'REUSE',smsCode:'222222',password:'bad-password',nickname:'spoofed',realName:'spoofed'};
    await assert.rejects(registerWithInvite(reuseInput),/密码错误/);
    smsStore.set(reusePhone,{code:'222222',expiresAt:Date.now()+300000});
    const reused=await registerWithInvite({...reuseInput,password:'original-password'});
    assert.equal(reused.result.identityId,reuseId);
    assert.equal(reused.result.accountId,vacant);
    assert.equal(reused.identity.guardian_name,'original-name');
    assert.equal(reused.identity.watcher_level,'mentor');
    assert.equal((await dbGet('SELECT rebind_count FROM subscriptions WHERE id=?',[subscription])).rebind_count,0);
    smsStore.set(reusePhone,{code:'222222',expiresAt:Date.now()+300000});
    assert.deepEqual((await registerWithInvite({...reuseInput,password:'original-password'})).result,reused.result);
    assert.equal((await dbGet("SELECT used_count FROM invite_codes WHERE code='REUSE'")).used_count,1);
    const platformOrg=(await dbRun("INSERT INTO organizations(name,owner_user_id) VALUES('Platform operations',0)")).lastID;
    const bossAccount=(await dbRun("INSERT INTO accounts(organization_id,name,role,created_at) VALUES(?,'boss','boss',?)",[platformOrg,now])).lastID;
    await dbRun('INSERT INTO account_bindings(account_id,identity_id,started_at) VALUES(?,?,?)',[bossAccount,registered.identity.id,now]);
    const bossContext={identityId:registered.identity.id,accountId:bossAccount};
    await dbRun("UPDATE identities SET guardian_name='same-person',watcher_level='mentor' WHERE id=?",[i2]);
    const beforeIdentity=await dbGet('SELECT * FROM identities WHERE id=?',[i2]);
    const beforeBindings=await dbGet('SELECT COUNT(*)::int AS count FROM account_bindings WHERE identity_id=? AND ended_at IS NULL',[i2]);
    smsStore.set('16600000099',{code:'222222',expiresAt:Date.now()+300000});
    const phoneInput={requestId:randomUUID(),identityId:i2,newPhone:'16600000099',smsCode:'222222',verificationNote:'Verified person; old phone lost'};
    const changed=await changeIdentityPhone(bossContext,phoneInput);
    assert.deepEqual(await changeIdentityPhone(bossContext,phoneInput),changed,'committed phone change replays without consuming SMS again');
    assert.equal(changed.identityId,i2);
    const afterIdentity=await dbGet('SELECT * FROM identities WHERE id=?',[i2]);
    assert.deepEqual({...afterIdentity,phone:beforeIdentity.phone,credential_version:beforeIdentity.credential_version},beforeIdentity);
    assert.equal(afterIdentity.credential_version,beforeIdentity.credential_version+1);
    assert.deepEqual(await dbGet('SELECT COUNT(*)::int AS count FROM account_bindings WHERE identity_id=? AND ended_at IS NULL',[i2]),beforeBindings);
    assert.equal((await dbGet('SELECT rebind_count FROM subscriptions WHERE id=?',[subscription])).rebind_count,0);
    smsStore.set('16600000099',{code:'222222',expiresAt:Date.now()+300000});
    assert.deepEqual(await changeIdentityPhone(bossContext,phoneInput),changed);
    assert.equal((await dbGet('SELECT credential_version FROM identities WHERE id=?',[i2])).credential_version,afterIdentity.credential_version);
    smsStore.set(reusePhone,{code:'222222',expiresAt:Date.now()+300000});
    await assert.rejects(changeIdentityPhone(bossContext,{...phoneInput,requestId:randomUUID(),newPhone:reusePhone}),/占用/);
    assert.equal((await dbGet('SELECT phone FROM identities WHERE id=?',[i2])).phone,'16600000099');
    // Suspension of the real organization 0 also revokes its accounts; use a boss in another organization.
    const outsideBoss=(await dbRun("INSERT INTO accounts(organization_id,name,role,created_at) VALUES(?,'outside boss','boss',?)",[orgB,now])).lastID;
    await dbRun('INSERT INTO account_bindings(account_id,identity_id,started_at) VALUES(?,?,?)',[outsideBoss,registered.identity.id,now]);
    const outsideContext={identityId:registered.identity.id,accountId:outsideBoss};
    assert.ok(await accountActor({identityId:i2,accountId:free2}));
    await setStatus(outsideContext,{requestId:randomUUID(),type:'organization',id:0,status:'suspended',reason:'test suspension'});
    assert.equal(await accountActor({identityId:i2,accountId:free2}),null);
    assert.equal((await dbGet('SELECT status FROM organizations WHERE id=0')).status,'suspended');
    await setStatus(outsideContext,{requestId:randomUUID(),type:'organization',id:0,status:'active',reason:'test restoration'});
    assert.ok(await accountActor({identityId:i2,accountId:free2}));
    console.log(JSON.stringify({ accountCore:true, bindingWriteRace:true, freeIsolation:true }));
  } finally { await closeIdentitySessions();await closeDb(); }
}
