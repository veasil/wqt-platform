import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createOwnedDatabase,dropOwnedDatabase,getTestPgAdminUrl,runNodeScript} from '../helpers/runtime-test-env.mjs';

test('organization entitlement edits preserve history, capacity and current authorization', {skip:!getTestPgAdminUrl()}, async () => {
  const owned = await createOwnedDatabase();
  try {
    const result = await runNodeScript(`const {run}=await import(${JSON.stringify(new URL('./scenarios/organization-entitlements.mjs',import.meta.url).href)});await run();`,{
      env:{WQT_RUNTIME_TEST_CHILD:'1',WQT_ACCOUNT_MODEL:'accounts',DATABASE_URL:owned.connectionString,CARDS_DATABASE_URL:owned.connectionString,CARDS_SOURCE:'postgres'},timeoutMs:60000,
    });
    assert.equal(result.code,0,result.stderr+'\n'+result.stdout);
    assert.match(result.stdout,/ORGANIZATION_ENTITLEMENTS_PASS/);
  } finally {await dropOwnedDatabase(owned)}
});
