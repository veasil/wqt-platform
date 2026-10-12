import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname,resolve,basename} from 'node:path';
import {fileURLToPath} from 'node:url';
import net from 'node:net';
import pg from 'pg';
import jwt from 'jsonwebtoken';

function childEnv(extra={}) {
  const env={};for(const key of ['PATH','Path','SystemRoot','WINDIR','TEMP','TMP','PATHEXT','ComSpec'])if(process.env[key])env[key]=process.env[key];
  return {...env,LANG:'C.UTF-8',LC_ALL:'C.UTF-8',...extra};
}
async function command(binary,args,input) {
  const child=spawn(binary,args,{env:childEnv(),windowsHide:true,stdio:['pipe','pipe','pipe']});
  const out=[],errors=[];child.stdout.on('data',chunk=>out.push(chunk));child.stderr.on('data',chunk=>errors.push(chunk));
  const complete=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',code=>code===0?resolve(Buffer.concat(out)):reject(new Error(Buffer.concat(errors).toString())))});
  child.stdin.end(input);return complete;
}
test('full production entry point and isolated backup/restore retain releases and audit',
  {skip:!process.env.WQT_TEST_PG_ADMIN_URL || !process.env.WQT_TEST_DOCKER_CONTAINER,timeout:90000},async()=>{
    const container=process.env.WQT_TEST_DOCKER_CONTAINER;
    assert.match(container,/^(?:wqt-download-release-test-[a-z0-9-]+|[a-f0-9]{12,64})$/);
    assert.equal((await command('docker',['inspect','--format','{{ index .Config.Labels "wqt.test" }}',container])).toString().trim(),'download-center-release');
    const admin=new pg.Client({connectionString:process.env.WQT_TEST_PG_ADMIN_URL});
    const id=randomUUID().replaceAll('-',''),database=`wqt_download_test_${id}`,restore=`wqt_download_restore_${id}`;
    const created=[],cwd=await mkdtemp(join(tmpdir(),'wqt-download-release-'));let server,db,restored;
    let logs='';
    try {
      await admin.connect();
      for(const name of [database,restore]){await admin.query(`CREATE DATABASE "${name}"`);created.push(name)}
      const connection=new URL(process.env.WQT_TEST_PG_ADMIN_URL);connection.pathname=`/${database}`;
      const listener=net.createServer();listener.listen(0,'127.0.0.1');await once(listener,'listening');const port=listener.address().port;await new Promise(r=>listener.close(r));
      const secret='synthetic-release-startup-secret';
      server=spawn(process.execPath,[fileURLToPath(new URL('../../server.js',import.meta.url))],{cwd,env:childEnv({NODE_ENV:'test',SERVER_ENV:'test',DATABASE_URL:connection.href,CARDS_DATABASE_URL:connection.href,CARDS_SOURCE:'postgres',JWT_SECRET:secret,HOST:'127.0.0.1',PORT:String(port)}),windowsHide:true,stdio:['ignore','pipe','pipe']});
      server.stdout.on('data',chunk=>logs+=chunk);server.stderr.on('data',chunk=>logs+=chunk);
      let ready=false;
      for(let attempt=0;attempt<150;attempt++){
        if(server.exitCode!=null)throw new Error(`Production entry exited: ${logs}`);
        try{ready=(await fetch(`http://127.0.0.1:${port}/downloads.html`,{signal:AbortSignal.timeout(500)})).status===200}catch{}
        if(ready)break;await new Promise(r=>setTimeout(r,100));
      }
      assert.ok(ready,logs);assert.match(logs,/Server running/);
      db=new pg.Client({connectionString:connection.href});await db.connect();
      const until=Date.now()+3600000;
      const boss=(await db.query("INSERT INTO users(username,role) VALUES('release-boss','boss') RETURNING id")).rows[0].id;
      const player=(await db.query("INSERT INTO users(username,role,valid_until) VALUES('release-player','watcher',$1) RETURNING id",[until])).rows[0].id;
      const token=async(user,role)=>{const jti=randomUUID();await db.query('INSERT INTO user_sessions(user_id,jti) VALUES($1,$2)',[user,jti]);return jwt.sign({uid:Number(user),role,jti,env:'test'},secret,{expiresIn:'1h'})};
      const bossToken=await token(boss,'boss'),playerToken=await token(player,'watcher');
      const request=(path,token,options={})=>fetch(`http://127.0.0.1:${port}${path}`,{...options,headers:{...options.headers,...(token?{Authorization:`Bearer ${token}`}:{})}});
      assert.equal((await request('/')).status,200);assert.equal((await request('/admin/')).status,200);assert.equal((await request('/enterprise/')).status,200);
      assert.equal((await request('/api/downloads')).status,401);
      assert.deepEqual(await (await request('/api/downloads',playerToken)).json(),{releases:[]});
      assert.equal((await request('/api/admin/downloads/events',playerToken)).status,403);
      assert.equal((await request('/api/admin/downloads/events',bossToken)).status,200);
      const release=randomUUID();
      await db.query('INSERT INTO download_releases(id,title,version,filename,object_key,size,sha256,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[release,'合成发布资料','release-smoke','资料.zip',`synthetic-test/${release}`,3,'synthetic-hash',Date.now()]);
      assert.equal((await request(`/api/downloads/${release}/file`,playerToken)).status,502); // Real server with no OSS must fail closed.
      await db.query('UPDATE users SET valid_until=1 WHERE id=$1',[player]);assert.equal((await request('/api/downloads',playerToken)).status,403);
      const before=(await db.query('SELECT id,event FROM download_events ORDER BY id')).rows;assert.ok(before.some(row=>row.event==='failed'));
      const backup=await command('docker',['exec',container,'pg_dump','-U','postgres','-Fc','--no-owner',database]);assert.ok(backup.length>1000);
      await command('docker',['exec','-i',container,'pg_restore','-U','postgres','--no-owner','--exit-on-error','-d',restore],backup);
      connection.pathname=`/${restore}`;restored=new pg.Client({connectionString:connection.href});await restored.connect();
      assert.deepEqual((await restored.query('SELECT id,event FROM download_events ORDER BY id')).rows,before);
      assert.equal((await restored.query('SELECT filename FROM download_releases WHERE id=$1',[release])).rows[0].filename,'资料.zip');
      assert.equal(Number((await restored.query('SELECT COUNT(*) AS count FROM users')).rows[0].count),2);
      assert.ok(Number((await restored.query('SELECT COUNT(*) AS count FROM cards_released')).rows[0].count)>0);
    } finally {
      if(server && server.exitCode==null){server.kill();await once(server,'close')}
      await db?.end();await restored?.end();
      for(const name of created.reverse())await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
      await admin.end();assert.equal(dirname(resolve(cwd)),resolve(tmpdir()));assert.ok(basename(cwd).startsWith('wqt-download-release-'));await rm(cwd,{recursive:true,force:true});
    }
  });
