import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createOwnedDatabase,dropOwnedDatabase,getTestPgAdminUrl,runNodeScript} from '../helpers/runtime-test-env.mjs';
test('automatic activities preserve ownership under concurrency and feedback remains private',{skip:!getTestPgAdminUrl()||!process.env.WQT_TEST_REDIS_URL},async()=>{
  const owned=await createOwnedDatabase();
  try{
    const result=await runNodeScript(`const {run}=await import(${JSON.stringify(new URL('./scenarios/scoring-activity-review.mjs',import.meta.url).href)});await run();`,{
      env:{WQT_RUNTIME_TEST_CHILD:'1',WQT_ACCOUNT_MODEL:'accounts',DATABASE_URL:owned.connectionString,CARDS_DATABASE_URL:owned.connectionString,CARDS_SOURCE:'postgres',NODE_ENV:'test',SERVER_ENV:'prod',JWT_SECRET:'synthetic-test-only',REDIS_URL:process.env.WQT_TEST_REDIS_URL,WQT_REDIS_NAMESPACE:owned.database},timeoutMs:60000});
    assert.equal(result.code,0,result.stderr+'\n'+result.stdout);assert.match(result.stdout,/scoringActivityReview/);
  }finally{await dropOwnedDatabase(owned)}
});
