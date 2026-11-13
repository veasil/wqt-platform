// Explicit local inventory backup + destructive restore rehearsal on a newly owned clone only.
import pg from 'pg';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createOwnedDatabase,dropOwnedDatabase} from '../helpers/runtime-test-env.mjs';
import {repairLocalUatBindings} from '../../scripts/migrate-local-uat-bindings.mjs';

const source=new URL(process.env.WQT_MIGRATION_DATABASE_URL || 'invalid:');
if(!['postgres:','postgresql:'].includes(source.protocol) || source.hostname!=='127.0.0.1' || source.port!=='55447' || !/^\/wqt_r1_[a-f0-9]{20}$/.test(source.pathname) || source.search) throw new Error('Explicit dedicated owned UAT source required');
const archive=process.env.WQT_UAT_BACKUP_PATH;
if(!archive) throw new Error('External backup path required');
if(existsSync(archive)) throw new Error('Refusing to overwrite an existing UAT backup');
const run=(program,args)=>execFileSync(program,args,{windowsHide:true,stdio:['ignore','pipe','pipe']});
const duplicates=async(client)=>Number((await client.query(`SELECT count(*) AS n FROM (SELECT a.organization_id,b.identity_id FROM accounts a JOIN account_bindings b ON b.account_id=a.id WHERE b.ended_at IS NULL GROUP BY a.organization_id,b.identity_id HAVING count(*)>1) d`)).rows[0].n);
const owned=await createOwnedDatabase();
try {
  run('pg_dump',['--format=custom','--no-owner','--file',archive,source.toString()]);
  run('pg_restore',['--exit-on-error','--no-owner','--dbname',owned.connectionString,archive]);
  const client=new pg.Client({connectionString:owned.connectionString});await client.connect();
  try {
    assert.equal(await duplicates(client),4);
    const rehearsal=await repairLocalUatBindings(client);
    assert.equal(rehearsal.endedBindings,4);assert.equal(await duplicates(client),4);
    const applied=await repairLocalUatBindings(client,{apply:true});
    assert.equal(applied.endedBindings,4);assert.equal(await duplicates(client),0);
    assert.equal(applied.historySha256,rehearsal.historySha256);
    const twice=await repairLocalUatBindings(client,{apply:true});
    assert.equal(twice.endedBindings,0);assert.equal(twice.historySha256,rehearsal.historySha256);
    console.log(JSON.stringify({backup:archive,backupSha256:createHash('sha256').update(readFileSync(archive)).digest('hex'),restore:true,rollbackDryRun:true,appliedOnClone:4,idempotent:true,historySha256:applied.historySha256}));
  }finally{await client.end();}
  // Exercise the actual rollback tool against the clone after migration, not only an empty DB.
  run('pg_restore',['--exit-on-error','--clean','--if-exists','--no-owner','--dbname',owned.connectionString,archive]);
  const restored=new pg.Client({connectionString:owned.connectionString});await restored.connect();
  try {assert.equal(await duplicates(restored),4);console.log('BACKUP_RESTORE_ROLLBACK_VERIFIED');}finally{await restored.end();}
}finally{await dropOwnedDatabase(owned);}
