import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import pg from 'pg';
import {initDb,closeDb,dbRun,dbGet} from '../../../src/db.js';
import {initCardsDb,closeCardsDb} from '../../../src/cards-db.js';
import {deliverSubscription,bindAccount,renewSubscription} from '../../../src/platform/accounts/service.js';
import {startSession,writeEvent} from '../../../src/game/sessions/service.js';
import {runTool,pgArgs} from './recovery.mjs';

if(process.env.WQT_RUNTIME_TEST_CHILD!=='1' || !process.env.WQT_RECOVERY_RESTORE_URL) throw new Error('owned account recovery harness required');
const tables=['identities','organizations','subscriptions','accounts','account_bindings','game_sessions','game_events','account_operations'];
async function snapshot(client) {
  const result={};
  for(const table of tables) result[table]=(await client.query(`SELECT * FROM ${table} ORDER BY id`)).rows;
  return result;
}
export async function run() {
  let directory,source,restored;
  try {
    await initDb();await initCardsDb();
    const now=Date.now();
    const identity=(await dbRun("INSERT INTO identities(phone,guardian_name,created_at) VALUES('16600000201','recovery person',?)",[now])).lastID;
    const platform=(await dbRun("INSERT INTO accounts(organization_id,name,role,created_at) VALUES(0,'platform','boss',?)",[now])).lastID;
    await dbRun('INSERT INTO account_bindings(account_id,identity_id,started_at) VALUES(?,?,?)',[platform,identity,now]);
    const actor={identityId:identity,accountId:platform};
    const delivered=await deliverSubscription(actor,{requestId:'recovery-deliver',organizationName:'recovery paid',plan:'personal'});
    await bindAccount(actor,{requestId:'recovery-bind',accountId:delivered.accountIds[0],identityId:identity});
    const paidActor={identityId:identity,accountId:delivered.accountIds[0]};
    const game=await startSession(paidActor,{requestId:'recovery-game-start',location:'recovery history'});
    await writeEvent(paidActor,{requestId:'recovery-event',sessionId:game.sessionId,type:'recovery_event'});
    await renewSubscription(actor,{requestId:'recovery-renew',subscriptionId:delivered.subscriptionId});
    const scene=await dbGet('SELECT * FROM game_sessions WHERE id=?',[game.sessionId]);
    assert.equal(scene.account_id,paidActor.accountId);
    await closeCardsDb();await closeDb();
    source=new pg.Client({connectionString:process.env.DATABASE_URL});await source.connect();
    const expected=await snapshot(source);
    directory=await mkdtemp(path.join(os.tmpdir(),'wqt-account-recovery-'));
    const backup=path.join(directory,'accounts.dump');
    await runTool('pg_dump',[...pgArgs(process.env.DATABASE_URL),'-Fc','-f',backup],process.env.DATABASE_URL);
    await runTool('pg_restore',[...pgArgs(process.env.WQT_RECOVERY_RESTORE_URL),'--exit-on-error','--no-owner',backup],process.env.WQT_RECOVERY_RESTORE_URL);
    restored=new pg.Client({connectionString:process.env.WQT_RECOVERY_RESTORE_URL});await restored.connect();
    assert.deepEqual(await snapshot(restored),expected);
    await assert.rejects(restored.query('UPDATE accounts SET organization_id=0 WHERE id=$1',[paidActor.accountId]),/immutable/);
    await assert.rejects(restored.query('UPDATE game_sessions SET account_id=$1 WHERE id=$2',[platform,game.sessionId]),/immutable/);
    await assert.rejects(restored.query('INSERT INTO account_bindings(account_id,identity_id,started_at) VALUES($1,$2,$3)',[platform,identity,now]),/duplicate key/);
    await assert.rejects(restored.query("INSERT INTO accounts(organization_id,subscription_id,name,created_at) VALUES($1,$2,'overflow',$3)",[delivered.organizationId,delivered.subscriptionId,now]),/capacity/);
    await assert.rejects(restored.query('INSERT INTO game_sessions(user_id,started_at) VALUES($1,$2)',[identity,now]),/require account/);
    const cols=await restored.query("SELECT column_name FROM information_schema.columns WHERE table_name='card_versions' AND column_name='author_identity_id'");
    assert.equal(cols.rows.length,1);
    console.log('ACCOUNT_RECOVERY_PASSED');
  } finally {
    await closeCardsDb();await closeDb();
    if(source)await source.end();if(restored)await restored.end();
    if(directory)await rm(directory,{recursive:true,force:true});
  }
}
