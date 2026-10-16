import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createOwnedDatabase,dropOwnedDatabase,getTestPgAdminUrl,runNodeScript} from '../helpers/runtime-test-env.mjs';

test('organization binding guard serializes concurrent identities and preserves legacy history', {skip:!getTestPgAdminUrl()},async()=>{
  const owned=await createOwnedDatabase();
  try {
    const result=await runNodeScript(`const {run}=await import(${JSON.stringify(new URL('./scenarios/organization-binding-uniqueness.mjs',import.meta.url).href)});await run();`,{
      env:{WQT_RUNTIME_TEST_CHILD:'1',DATABASE_URL:owned.connectionString},timeoutMs:30000});
    assert.equal(result.code,0,result.stderr);assert.match(result.stdout,/ORGANIZATION_BINDING_UNIQUENESS_PASSED/);
  } finally {await dropOwnedDatabase(owned)}
});
