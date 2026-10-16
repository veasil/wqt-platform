import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createOwnedDatabase,dropOwnedDatabase,getTestPgAdminUrl,runNodeScript} from '../helpers/runtime-test-env.mjs';

test('account selection, verified phone change and platform delivery recover through real HTTP/PG/Redis',{
  skip:process.env.WQT_TEST_BROWSER!=='1' || !getTestPgAdminUrl() || !process.env.WQT_TEST_REDIS_URL
},async()=>{
  const owned=await createOwnedDatabase();
  try {
    const result=await runNodeScript(`const {run}=await import(${JSON.stringify(new URL('../runtime/scenarios/account-ui.mjs',import.meta.url).href)});await run();`,{
      env:{WQT_RUNTIME_TEST_CHILD:'1',WQT_ACCOUNT_MODEL:'accounts',JWT_SECRET:'owned-browser-test-secret-no-external-credentials',DATABASE_URL:owned.connectionString,CARDS_DATABASE_URL:owned.connectionString,CARDS_SOURCE:'postgres',REDIS_URL:process.env.WQT_TEST_REDIS_URL,WQT_REDIS_NAMESPACE:owned.database,
        ...(process.env.WQT_TEST_BROWSER_CHANNEL ? {WQT_TEST_BROWSER_CHANNEL:process.env.WQT_TEST_BROWSER_CHANNEL}:{}),
        ...(process.env.WQT_UI_ARTIFACT_DIR ? {WQT_UI_ARTIFACT_DIR:process.env.WQT_UI_ARTIFACT_DIR}:{})},timeoutMs:120000});
    assert.equal(result.timedOut,false,`browser scenario timed out; last activity: ${result.stdout.slice(-1500)}`);
    assert.equal(result.code,0,result.stderr);
    assert.match(result.stdout,/ACCOUNT_UI_PASSED/);
  } finally {await dropOwnedDatabase(owned);}
});
