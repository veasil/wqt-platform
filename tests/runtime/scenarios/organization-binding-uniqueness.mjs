import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {Client} from 'pg';
import {installOrganizationBindingUniqueness} from '../../../src/db/migrations/organization-binding-uniqueness.js';

const constraint='account_bindings_one_identity_per_organization';
const conflict=error=>error.code==='23505' && error.constraint===constraint;
export async function run() {
  if(process.env.WQT_RUNTIME_TEST_CHILD!=='1' || !/^wqt_r1_[a-f0-9]{20}$/.test(new URL(process.env.DATABASE_URL).pathname.slice(1))) throw new Error('Owned test database required');
  const clients=Array.from({length:3},()=>new Client({connectionString:process.env.DATABASE_URL}));
  const [db,first,second]=clients;
  try {
    await Promise.all(clients.map(client=>client.connect()));
    // Minimal real PG schema isolates the binding contract from unrelated startup migrations.
    await db.query(`CREATE TABLE organizations(id BIGINT PRIMARY KEY);
      CREATE TABLE identities(id BIGINT PRIMARY KEY);
      CREATE TABLE accounts(id BIGINT PRIMARY KEY,organization_id BIGINT NOT NULL REFERENCES organizations(id));
      CREATE TABLE account_bindings(id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        account_id BIGINT NOT NULL REFERENCES accounts(id),identity_id BIGINT NOT NULL REFERENCES identities(id),
        started_at BIGINT NOT NULL,ended_at BIGINT,CHECK(ended_at IS NULL OR ended_at>=started_at));
      CREATE UNIQUE INDEX account_bindings_one_active ON account_bindings(account_id) WHERE ended_at IS NULL;
      INSERT INTO organizations VALUES(1),(2);
      INSERT INTO identities VALUES(1),(2),(3),(4);
      INSERT INTO accounts VALUES(1,1),(2,1),(3,1),(4,2),(5,1),(6,1),(7,1),(8,2),(9,1),(10,1),(11,2);
      INSERT INTO account_bindings(account_id,identity_id,started_at) VALUES(5,4,1),(6,4,1);`);
    const tx={run:sql=>db.query(sql)};
    const legacy=(await db.query('SELECT * FROM account_bindings ORDER BY id')).rows;
    await installOrganizationBindingUniqueness(tx);await installOrganizationBindingUniqueness(tx);
    assert.deepEqual((await db.query('SELECT * FROM account_bindings ORDER BY id')).rows,legacy,'installation preserves existing duplicates');
    await assert.rejects(db.query('INSERT INTO account_bindings(account_id,identity_id,started_at) VALUES(7,4,1)'),conflict);

    await first.query('BEGIN');await second.query('BEGIN');
    assert.equal((await first.query('SHOW transaction_isolation')).rows[0].transaction_isolation,'read committed');
    await first.query('INSERT INTO account_bindings(account_id,identity_id,started_at) VALUES(1,1,1)');
    const pid=(await second.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    // Attach rejection handling immediately while the second connection blocks on the identity lock.
    const contender=second.query('INSERT INTO account_bindings(account_id,identity_id,started_at) VALUES(2,1,1)').then(()=>({ok:true}),error=>({error}));
    let waiting=false;
    for(let attempt=0;attempt<100;attempt++) {
      const activity=(await db.query('SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1',[pid])).rows[0];
      if(activity?.wait_event_type==='Lock') {waiting=true;break}
      await delay(10);
    }
    assert.ok(waiting,'second concurrent insert must actually wait for the shared identity lock');
    await first.query('COMMIT');
    const outcome=await contender;assert.ok(outcome.error);assert.ok(conflict(outcome.error));await second.query('ROLLBACK');
    assert.equal((await db.query('SELECT COUNT(*)::int AS count FROM account_bindings WHERE identity_id=1 AND ended_at IS NULL')).rows[0].count,1);
    await db.query('INSERT INTO account_bindings(account_id,identity_id,started_at) VALUES(4,1,1)'); // Cross-organization allowed.
    const ended=(await db.query('INSERT INTO account_bindings(account_id,identity_id,started_at,ended_at) VALUES(3,1,1,2) RETURNING id')).rows[0].id;
    await assert.rejects(db.query('UPDATE account_bindings SET ended_at=NULL WHERE id=$1',[ended]),conflict);
    const active=(await db.query('INSERT INTO account_bindings(account_id,identity_id,started_at) VALUES(3,2,1) RETURNING id')).rows[0].id;
    await assert.rejects(db.query('UPDATE account_bindings SET identity_id=1 WHERE id=$1',[active]),conflict);
    const otherOrg=(await db.query('INSERT INTO account_bindings(account_id,identity_id,started_at) VALUES(8,2,1) RETURNING id')).rows[0].id;
    await assert.rejects(db.query('UPDATE account_bindings SET account_id=9 WHERE id=$1',[otherOrg]),conflict);
    await db.query('UPDATE account_bindings SET ended_at=3 WHERE id=$1',[active]);
    await db.query('UPDATE account_bindings SET account_id=9 WHERE id=$1',[otherOrg]); // Own row excluded; now valid.
    await db.query('UPDATE account_bindings SET identity_id=3 WHERE id=$1',[otherOrg]); // New identity rechecked and allowed.
    assert.deepEqual((await db.query('SELECT * FROM account_bindings WHERE identity_id=4 ORDER BY id')).rows,legacy,'old duplicate group remains untouched');
    console.log('ORGANIZATION_BINDING_UNIQUENESS_PASSED');
  } finally {
    await Promise.allSettled(clients.map(async client=>{await client.query('ROLLBACK').catch(()=>{});await client.end()}));
  }
}
