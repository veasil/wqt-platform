import assert from 'node:assert/strict';
import { test } from 'node:test';
import { auditLegacyAccounts } from '../../src/platform/accounts/legacy-audit.js';
import { createOwnedDatabase, dropOwnedDatabase, getTestPgAdminUrl, runNodeScript } from '../helpers/runtime-test-env.mjs';

test('account audit preserves zero and refuses to infer historical organization', () => {
  const users = [{ id: 1, phone: '100001', role: 'watcher', enterprise_id: 0 }, { id: 2, phone: '100002', role: 'watcher', enterprise_id: 20 }];
  const result = auditLegacyAccounts(users, [
    { user_id: 1, ownership_kind: 'organization', organization_id: 0 },
    { user_id: 2, ownership_kind: 'organization', organization_id: 10 },
    { user_id: 2 },
    { user_id: 3 },
  ], [0, 10, 20]);
  assert.equal(result.freeOrganizationExists, true);
  assert.equal(result.counts.nullOrganization, 0);
  assert.equal(result.counts.conflictingHistoricalOrganization, 1);
  assert.equal(result.counts.unknownHistoricalOwnership, 1);
  assert.equal(result.counts.orphanSessions, 1);
  assert.equal(result.mappingReady, false);
  assert.ok(!JSON.stringify(result).includes('100001'));
});

test('account audit flags NULL classification, missing identities and old operators', () => {
  const result = auditLegacyAccounts([
    { id: 1, phone: '100 001', role: 'watcher', enterprise_id: null },
    { id: 2, phone: '100001', role: 'operator', enterprise_id: 5 },
    { id: 3, phone: null, role: 'boss', enterprise_id: 5 },
  ], [], [5]);
  assert.equal(result.counts.nullOrganization, 1);
  assert.equal(result.counts.duplicatePhoneIdentities, 2);
  assert.equal(result.counts.missingPhone, 1);
  assert.equal(result.counts.operatorAccounts, 1);
  assert.equal(result.mappingReady, false);
});

test('account audit refuses implicit application database configuration', async () => {
  const result = await runNodeScript("await import('./scripts/audit-account-mapping.mjs')", { env: { DATABASE_URL: 'postgres://do-not-use.invalid/app' } });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /WQT_MIGRATION_DATABASE_URL/);
  assert.ok(!result.stderr.includes('do-not-use'));
});

test('account audit handles legacy and ownership-aware schemas without writing or exposing identities', { skip: !getTestPgAdminUrl() }, async () => {
  const owned = await createOwnedDatabase();
  const { default: pg } = await import('pg');
  const client = new pg.Client({ connectionString: owned.connectionString });
  try {
    await client.connect();
    await client.query('CREATE TABLE users(id BIGINT PRIMARY KEY,phone TEXT,role TEXT,enterprise_id BIGINT); CREATE TABLE organizations(id BIGINT PRIMARY KEY); CREATE TABLE game_sessions(id BIGINT PRIMARY KEY,user_id BIGINT)');
    await client.query("INSERT INTO users VALUES(1,'private-phone','watcher',2); INSERT INTO organizations VALUES(0),(2); INSERT INTO game_sessions VALUES(10,1)");
    const before = (await client.query('SELECT * FROM users')).rows;
    async function audit() {
      const result = await runNodeScript("await import('./scripts/audit-account-mapping.mjs')", { env: { WQT_MIGRATION_DATABASE_URL: owned.connectionString } });
      assert.equal(result.code, 0, result.stderr);
      assert.ok(!result.stdout.includes('private-phone'));
      assert.deepEqual((await client.query('SELECT * FROM users')).rows, before);
      return JSON.parse(result.stdout);
    }
    const legacy = await audit();
    assert.equal(legacy.historicalColumns, false);
    assert.equal(legacy.counts.unknownHistoricalOwnership, 1);
    await client.query("ALTER TABLE game_sessions ADD COLUMN ownership_kind TEXT; ALTER TABLE game_sessions ADD COLUMN organization_id BIGINT; UPDATE game_sessions SET ownership_kind='organization', organization_id=3");
    const current = await audit();
    assert.equal(current.historicalColumns, true);
    assert.equal(current.counts.conflictingHistoricalOrganization, 1);
    assert.equal(current.counts.unknownHistoricalOwnership, 0);
    assert.equal((await client.query('SELECT organization_id FROM game_sessions')).rows[0].organization_id, '3');
  } finally { await client.end(); await dropOwnedDatabase(owned); }
});
