import { test } from 'node:test';
import assert from 'node:assert/strict';
import {createOwnedDatabase,dropOwnedDatabase,getTestPgAdminUrl,runNodeScript} from '../helpers/runtime-test-env.mjs';
test('team courseware uses real PKCE, isolated origins, scoped authorization and persistent scoring', {skip:!getTestPgAdminUrl()||!process.env.WQT_TEST_REDIS_URL}, async()=>{
 const owned=await createOwnedDatabase();
 try {
  const result=await runNodeScript(`const {run}=await import(${JSON.stringify(new URL('./scenarios/team-courseware.mjs',import.meta.url).href)});await run();`,{env:{WQT_RUNTIME_TEST_CHILD:'1',WQT_ACCOUNT_MODEL:'accounts',DATABASE_URL:owned.connectionString,CARDS_DATABASE_URL:owned.connectionString,CARDS_SOURCE:'postgres',REDIS_URL:process.env.WQT_TEST_REDIS_URL,WQT_REDIS_NAMESPACE:owned.database,JWT_SECRET:'team-courseware-isolated-test-only',PLAYWRIGHT_BROWSERS_PATH:process.env.PLAYWRIGHT_BROWSERS_PATH},timeoutMs:120000});
  assert.equal(result.code,0,result.stdout+'\n'+result.stderr);assert.match(result.stdout,/TEAM_COURSEWARE_OK/);
 } finally {await dropOwnedDatabase(owned)}
});
