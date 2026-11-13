import assert from 'node:assert/strict';
import {Client} from 'pg';
import {startRuntime} from '../../../src/runtime.js';
import {dbRun,dbGet,dbAll} from '../../../src/db.js';
import {deliverSubscription,bindAccount} from '../../../src/platform/accounts/service.js';
import {seedDemoDirectory} from '../../helpers/demo-directory.mjs';
import {refreshDemoDirectoryNames} from '../../helpers/refresh-demo-directory.mjs';

export async function run() {
  let runtime,client;
  try {
    runtime=await startRuntime({port:0,host:'127.0.0.1'});
    const phones=['16600000888','16600000889','16600000890','16600000891','16600000892','16600000893'];
    const options={dbGet,dbRun,deliverSubscription,bindAccount,phones,password:'DemoDirectoryTest!'};
    await seedDemoDirectory(options);
    const scenarios=await dbAll('SELECT o.name,s.plan,s.rebind_count,s.valid_until FROM organizations o JOIN subscriptions s ON s.organization_id=o.id ORDER BY o.id');
    assert.equal(scenarios.length,5);
    assert.deepEqual(scenarios.map(row=>row.plan),['personal','group','group','city','group']);
    assert.ok(scenarios.every(row=>row.name.includes('虚构')));
    assert.equal(scenarios.find(row=>row.name.startsWith('青禾学校')).rebind_count,2);
    assert.ok(Number(scenarios.find(row=>row.name.startsWith('星桥学校')).valid_until)<Date.now());
    assert.deepEqual(await dbAll(`SELECT a.organization_id,b.identity_id,COUNT(*) FROM account_bindings b
      JOIN accounts a ON a.id=b.account_id WHERE b.ended_at IS NULL
      GROUP BY a.organization_id,b.identity_id HAVING COUNT(*)>1`),[]);
    const counts=()=>dbGet(`SELECT (SELECT COUNT(*) FROM identities)::int AS users,
      (SELECT COUNT(*) FROM organizations)::int AS organizations,(SELECT COUNT(*) FROM accounts)::int AS accounts,
      (SELECT COUNT(*) FROM account_bindings)::int AS bindings,(SELECT COUNT(*) FROM account_operations)::int AS operations`);
    const before=await counts();await seedDemoDirectory(options);assert.deepEqual(await counts(),before);

    // Add one old exact fixture and one similarly named unrelated account to prove scope.
    const identity=(await dbGet('SELECT id FROM identities WHERE phone=?',[phones[0]])).id;
    const organization=(await dbRun("INSERT INTO organizations(name,owner_user_id) VALUES('验收个人合伙人账号组织',0)")).lastID;
    const account=(await dbRun("INSERT INTO accounts(organization_id,name,role,valid_until,created_at) VALUES(?,'验收个人合伙人账号','watcher',?,?)",[organization,Date.now()+86400000,Date.now()])).lastID;
    await dbRun('INSERT INTO account_bindings(account_id,identity_id,started_at) VALUES(?,?,?)',[account,identity,Date.now()]);
    const outsider=(await dbRun("INSERT INTO accounts(organization_id,name,role,created_at) VALUES(?,'验收个人合伙人账号','watcher',?)",[organization,Date.now()])).lastID;
    const originalAccount=await dbGet('SELECT * FROM accounts WHERE id=?',[account]);
    const originalBindings=await dbAll('SELECT * FROM account_bindings WHERE account_id=?',[account]);
    const originalOrganization=await dbGet('SELECT * FROM organizations WHERE id=?',[organization]);
    client=new Client({connectionString:process.env.DATABASE_URL});await client.connect();
    assert.deepEqual(await refreshDemoDirectoryNames(client),{organizations:1,accounts:1});
    const updated=await dbGet('SELECT * FROM accounts WHERE id=?',[account]);
    assert.equal(updated.name,'林知夏 · 守望者账号');assert.deepEqual({...updated,name:originalAccount.name},originalAccount);
    const updatedOrg=await dbGet('SELECT * FROM organizations WHERE id=?',[organization]);
    assert.equal(updatedOrg.name,'林知夏咨询师（虚构）');assert.deepEqual({...updatedOrg,name:originalOrganization.name},originalOrganization);
    assert.deepEqual(await dbAll('SELECT * FROM account_bindings WHERE account_id=?',[account]),originalBindings);
    assert.equal((await dbGet('SELECT name FROM accounts WHERE id=?',[outsider])).name,'验收个人合伙人账号');
    assert.deepEqual(await refreshDemoDirectoryNames(client),{organizations:0,accounts:0});
    console.log('DEMO_DIRECTORY_PASSED');
  } finally {if(client)await client.end();if(runtime)await runtime.stop()}
}
