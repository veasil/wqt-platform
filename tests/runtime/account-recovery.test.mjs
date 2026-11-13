import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createOwnedDatabase,dropOwnedDatabase,getTestPgAdminUrl,runNodeScript} from '../helpers/runtime-test-env.mjs';

test('account model backup restores identity, account history, audit, and database constraints',{skip:!getTestPgAdminUrl()},async()=>{
  const owned=[];
  try {
    owned.push(await createOwnedDatabase());owned.push(await createOwnedDatabase());
    const result=await runNodeScript(`const {run}=await import(${JSON.stringify(new URL('./scenarios/account-recovery.mjs',import.meta.url).href)});await run();`,{
      env:{WQT_RUNTIME_TEST_CHILD:'1',WQT_ACCOUNT_MODEL:'accounts',DATABASE_URL:owned[0].connectionString,CARDS_DATABASE_URL:owned[0].connectionString,CARDS_SOURCE:'postgres',WQT_RECOVERY_RESTORE_URL:owned[1].connectionString},timeoutMs:90000});
    assert.equal(result.code,0,result.stderr);
    assert.match(result.stdout,/ACCOUNT_RECOVERY_PASSED/);
  } finally {
    const results=await Promise.allSettled(owned.map(dropOwnedDatabase));
    assert.ok(results.every(result=>result.status==='fulfilled'),'owned databases must be cleaned up');
  }
});
