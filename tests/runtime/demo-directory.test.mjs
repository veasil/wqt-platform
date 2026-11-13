import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createOwnedDatabase,dropOwnedDatabase,getTestPgAdminUrl,runNodeScript} from '../helpers/runtime-test-env.mjs';

test('fictional demo directory seeds real PostgreSQL once and upgrades only legacy synthetic names', {skip:!getTestPgAdminUrl() || !process.env.WQT_TEST_REDIS_URL},async()=>{
  const owned=await createOwnedDatabase();
  try {
    const result=await runNodeScript(`const {run}=await import(${JSON.stringify(new URL('./scenarios/demo-directory.mjs',import.meta.url).href)});await run();`,{
      env:{WQT_RUNTIME_TEST_CHILD:'1',WQT_ACCOUNT_MODEL:'accounts',DATABASE_URL:owned.connectionString,CARDS_DATABASE_URL:owned.connectionString,CARDS_SOURCE:'postgres',
        REDIS_URL:process.env.WQT_TEST_REDIS_URL,WQT_REDIS_NAMESPACE:owned.database,JWT_SECRET:'synthetic-demo-test-only',SETTINGS_ENCRYPTION_KEY:'0123456789abcdef'.repeat(4)},timeoutMs:60000});
    assert.equal(result.code,0,result.stderr);assert.match(result.stdout,/DEMO_DIRECTORY_PASSED/);
  } finally {await dropOwnedDatabase(owned)}
});
