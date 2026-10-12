import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,dirname,basename} from 'node:path';
import {fileURLToPath} from 'node:url';
import pg from 'pg';

test('real production authentication, downloads, audit and migrations in an owned PG database',
  {skip:!process.env.WQT_TEST_PG_ADMIN_URL,timeout:90000},async()=>{
    // Only explicit test configuration is accepted; no .env or application fallback.
    const admin=new pg.Client({connectionString:process.env.WQT_TEST_PG_ADMIN_URL});
    const database=`wqt_download_test_${randomUUID().replaceAll('-','')}`;
    const cwd=await mkdtemp(join(tmpdir(),'wqt-download-test-'));
    let created=false;
    try {
      await admin.connect();await admin.query(`CREATE DATABASE "${database}"`);created=true;
      const url=new URL(process.env.WQT_TEST_PG_ADMIN_URL);url.pathname=`/${database}`;
      const env={};for(const key of ['PATH','Path','SystemRoot','WINDIR','TEMP','TMP','PATHEXT','ComSpec']) if(process.env[key]) env[key]=process.env[key];
      Object.assign(env,{NODE_ENV:'test',DATABASE_URL:url.href,JWT_SECRET:'synthetic-download-integration-secret',SERVER_ENV:'test',BMOB_APP_ID:'',BMOB_REST_KEY:''});
      for(const key of ['WQT_DOWNLOAD_PG_BROWSER','WQT_BROWSER_CHANNEL','WQT_DOWNLOAD_PREVIEW_DIR']) if(process.env[key]) env[key]=process.env[key];
      const child=spawn(process.execPath,[fileURLToPath(new URL('./scenarios/downloads-pg.mjs',import.meta.url))],{cwd,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
      let stdout='',stderr='';child.stdout.on('data',chunk=>stdout+=chunk);child.stderr.on('data',chunk=>stderr+=chunk);
      const code=await new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>{child.kill();reject(new Error('PG download scenario timed out'));},70000);
        child.once('error',error=>{clearTimeout(timer);reject(error)});child.once('close',code=>{clearTimeout(timer);resolve(code)});
      });
      assert.equal(code,0,`${stdout}\n${stderr}`);assert.match(stdout,/DOWNLOAD_PG_OK/);
    } finally {
      if(created) await admin.query(`DROP DATABASE "${database}" WITH (FORCE)`);
      await admin.end();
      assert.equal(dirname(resolve(cwd)),resolve(tmpdir()));
      assert.ok(basename(cwd).startsWith('wqt-download-test-'));
      await rm(cwd,{recursive:true,force:true});
    }
  });
