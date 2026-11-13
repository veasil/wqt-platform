import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createOwnedDatabase, dropOwnedDatabase, getTestPgAdminUrl, runNodeScript } from '../helpers/runtime-test-env.mjs';

test('all platform card writes reject non-boss roles and secret-only requests without mutations', { skip: !getTestPgAdminUrl() }, async () => {
  const owned = await createOwnedDatabase();
  try {
    const result = await runNodeScript(`const { run } = await import(${JSON.stringify(new URL('./scenarios/card-permissions.mjs', import.meta.url).href)}); await run();`, {
      env: { WQT_RUNTIME_TEST_CHILD: '1', DATABASE_URL: owned.connectionString, CARDS_DATABASE_URL: owned.connectionString, CARDS_SOURCE: 'postgres', JWT_SECRET: 'card-permissions-test-secret', SERVER_ENV: 'prod', NODE_ENV: 'test' },
      timeoutMs: 60000,
    });
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /cardWritesProtected/);
  } finally { await dropOwnedDatabase(owned); }
});
