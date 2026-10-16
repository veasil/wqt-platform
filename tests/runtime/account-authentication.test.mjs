import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createOwnedDatabase,dropOwnedDatabase,getTestPgAdminUrl,runNodeScript } from '../helpers/runtime-test-env.mjs';

test('Redis identity login supports account selection, immediate revocation, parallel reads and fixed expiry', {skip:!getTestPgAdminUrl() || !process.env.WQT_TEST_REDIS_URL},async()=>{
  const owned=await createOwnedDatabase();
  try {
    const result=await runNodeScript(`const {run}=await import(${JSON.stringify(new URL('./scenarios/account-authentication.mjs',import.meta.url).href)}); await run();`,{
      env:{WQT_RUNTIME_TEST_CHILD:'1',WQT_ACCOUNT_MODEL:'accounts',DATABASE_URL:owned.connectionString,CARDS_DATABASE_URL:owned.connectionString,CARDS_SOURCE:'postgres',NODE_ENV:'test',SERVER_ENV:'prod',JWT_SECRET:'account-auth-test-secret',REDIS_URL:process.env.WQT_TEST_REDIS_URL,WQT_REDIS_NAMESPACE:owned.database},timeoutMs:60000,
    });
    assert.equal(result.code,0,result.stderr);
    assert.match(result.stdout,/redisSession/);
  } finally {await dropOwnedDatabase(owned);}
});
