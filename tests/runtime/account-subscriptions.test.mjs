import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createOwnedDatabase, dropOwnedDatabase, getTestPgAdminUrl, runNodeScript } from '../helpers/runtime-test-env.mjs';

test('manual delivery, renewal, and package-wide rebinding remain atomic and idempotent', { skip: !getTestPgAdminUrl() }, async () => {
  const owned = await createOwnedDatabase();
  try {
    const result = await runNodeScript(`const { run } = await import(${JSON.stringify(new URL('./scenarios/account-subscriptions.mjs', import.meta.url).href)}); await run();`, {
      env: { WQT_RUNTIME_TEST_CHILD:'1',WQT_ACCOUNT_MODEL:'accounts',DATABASE_URL:owned.connectionString,CARDS_DATABASE_URL:owned.connectionString,CARDS_SOURCE:'postgres',NODE_ENV:'test' },timeoutMs:60000,
    });
    assert.equal(result.code,0,result.stderr);
    assert.match(result.stdout,/subscriptionRace/);
  } finally { await dropOwnedDatabase(owned); }
});
