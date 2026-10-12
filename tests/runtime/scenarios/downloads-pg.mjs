import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';
import multer from 'multer';
import bcrypt from 'bcryptjs';
import {Readable} from 'node:stream';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
import {readFile} from 'node:fs/promises';
import {initDb,dbRun,dbGet,dbAll,withTransaction} from '../../../src/db.js';
import {loadConfig,config} from '../../../src/config.js';
import authRouter from '../../../src/routes/auth.routes.js';
import {smsStore} from '../../../src/services/sms.js';
import {migrateDownloads} from '../../../src/db/migrations/downloads.js';
import {registerDownloadRoutes} from '../../../src/platform/downloads/routes.js';

let server;
try {
  assert.equal(config.BMOB_APP_ID,undefined); // loadConfig has not run; no external SMS call.
  await initDb();await loadConfig();
  const until=Date.now()+3600000;
  const boss=(await dbRun("INSERT INTO users(phone,password_hash,role,username) VALUES(?,?,'boss',?)",['19900000001',bcrypt.hashSync('synthetic-password',4),'test-boss'])).lastID;
  const org=(await dbRun('INSERT INTO organizations(name,owner_user_id,valid_until) VALUES(?,?,?)',['test-organization',boss,until])).lastID;
  const individual=(await dbRun("INSERT INTO users(phone,password_hash,role,username,valid_until) VALUES(?,?,'watcher',?,?)",['19900000002',bcrypt.hashSync('synthetic-password',4),'test-player',until])).lastID;
  const member=(await dbRun("INSERT INTO users(phone,password_hash,role,username,enterprise_id) VALUES(?,?,'watcher',?,?)",['19900000003',bcrypt.hashSync('synthetic-password',4),'test-member',org])).lastID;
  await migrateDownloads(dbRun);await migrateDownloads(dbRun);
  assert.equal((await dbGet('SELECT COUNT(*) AS count FROM users')).count,3);
  assert.equal((await dbGet("SELECT COUNT(*) AS count FROM pg_indexes WHERE indexname='download_events_created'")).count,1);
  const objects=new Map();let failed=false;
  const app=express();app.use(express.json());
  app.use(express.static(fileURLToPath(new URL('../../../public',import.meta.url))));
  app.use('/admin',express.static(fileURLToPath(new URL('../../../admin-web/dist',import.meta.url))));
  app.get('/admin/*',(_req,res)=>res.sendFile(fileURLToPath(new URL('../../../admin-web/dist/index.html',import.meta.url))));
  app.use(authRouter);
  registerDownloadRoutes(app,{upload:multer({storage:multer.memoryStorage(),limits:{fileSize:50*1024*1024}}),ossClient:{
    put:async(key,buffer,options)=>{assert.equal(options.headers['x-oss-object-acl'],'private');objects.set(key,Buffer.from(buffer))},
    getStream:async key=>{if(failed) throw new Error('synthetic OSS outage');return {stream:Readable.from([objects.get(key)])}},
    delete:async key=>objects.delete(key)}});
  server=app.listen(0,'127.0.0.1');await once(server,'listening');
  const base=`http://127.0.0.1:${server.address().port}`;
  const request=(path,token,options={})=>fetch(base+path,{...options,headers:{...options.headers,...(token?{Authorization:`Bearer ${token}`}:{})}});
  const login=async phone=>{
    smsStore.set(phone,{code:'123456',expiresAt:Date.now()+60000});
    const response=await request('/api/auth/login',null,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phone,password:'synthetic-password',code:'123456'})});
    assert.equal(response.status,200);return (await response.json()).token;
  };
  const bossToken=await login('19900000001'),playerToken=await login('19900000002'),memberToken=await login('19900000003');
  await dbRun("UPDATE users SET role='operator' WHERE id=?",[boss]);
  assert.equal((await request('/api/admin/downloads/events',bossToken)).status,403);
  await dbRun("UPDATE users SET role='boss' WHERE id=?",[boss]);
  assert.equal((await request('/api/downloads')).status,401);
  const form=()=>{const value=new FormData();value.append('title','合成桌游资料');value.append('version','1');value.append('file',new Blob(['synthetic-file-data']),'桌游资料.zip');return value};
  assert.equal((await request('/api/admin/downloads',playerToken,{method:'POST',body:form()})).status,403);
  assert.equal((await request('/api/admin/downloads/events',playerToken)).status,403);
  const uploaded=await request('/api/admin/downloads',bossToken,{method:'POST',body:form()});assert.equal(uploaded.status,201);const {id}=await uploaded.json();
  const release=await dbGet('SELECT * FROM download_releases WHERE id=?',[id]);assert.equal(release.filename,'桌游资料.zip');
  const list=await (await request('/api/downloads',playerToken)).json();assert.equal(list.releases.length,1);assert.equal(list.releases[0].object_key,undefined);
  const download=await request(`/api/downloads/${id}/file`,memberToken);assert.equal(download.status,200);const content=Buffer.from(await download.arrayBuffer());
  assert.equal(crypto.createHash('sha256').update(content).digest('hex'),release.sha256);
  const events=await dbAll('SELECT * FROM download_events WHERE release_id=? ORDER BY created_at',[id]);
  assert.ok(events.some(e=>e.event==='requested' && e.user_id===member && e.organization_id===org));
  // Event write completes just after response; wait for its actual persisted evidence.
  for(let attempt=0;attempt<20;attempt++){if(await dbGet("SELECT id FROM download_events WHERE release_id=? AND event='server_sent'",[id]))break;await new Promise(r=>setTimeout(r,10))}
  assert.ok(await dbGet("SELECT id FROM download_events WHERE release_id=? AND event='server_sent'",[id]));
  await dbRun('UPDATE organizations SET valid_until=? WHERE id=?',[1,org]);assert.equal((await request(`/api/downloads/${id}/file`,memberToken)).status,403);
  await dbRun("UPDATE organizations SET valid_until=?,status='suspended' WHERE id=?",[until,org]);assert.equal((await request('/api/downloads',memberToken)).status,403);
  await dbRun("UPDATE organizations SET status='active' WHERE id=?",[org]);
  await dbRun('UPDATE users SET valid_until=? WHERE id=?',[1,individual]);assert.equal((await request('/api/downloads',playerToken)).status,403);
  await dbRun('UPDATE users SET valid_until=? WHERE id=?',[until,individual]);
  const freshToken=await login('19900000002');assert.equal((await request('/api/downloads',playerToken)).status,401);assert.equal((await request('/api/downloads',freshToken)).status,200);
  failed=true;assert.equal((await request(`/api/downloads/${id}/file`,freshToken)).status,502);assert.ok(await dbGet("SELECT id FROM download_events WHERE release_id=? AND event='failed'",[id]));failed=false;
  // Real transaction rollback, including text UUID INSERT RETURNING compatibility.
  await assert.rejects(withTransaction(async tx=>{await tx.run("INSERT INTO download_events(id,request_id,event,created_at) VALUES(?,?,'rollback-probe',?)",['rollback-probe','rollback-probe',Date.now()]);throw new Error('rollback expected')}),/rollback expected/);
  assert.equal(await dbGet("SELECT * FROM download_events WHERE id='rollback-probe'"),undefined);
  // Fail publication audit inside the same transaction; neither metadata nor OSS survives.
  await dbRun("ALTER TABLE download_events ADD CONSTRAINT synthetic_reject_publication CHECK (event <> 'published') NOT VALID");
  const before=objects.size;assert.equal((await request('/api/admin/downloads',bossToken,{method:'POST',body:form()})).status,500);
  assert.equal(objects.size,before);assert.equal((await dbGet('SELECT COUNT(*) AS count FROM download_releases')).count,1);
  await dbRun('ALTER TABLE download_events DROP CONSTRAINT synthetic_reject_publication');
  // Audit unavailable: no bytes are returned.
  await dbRun('ALTER TABLE download_events RENAME TO download_events_unavailable');
  assert.equal((await request(`/api/downloads/${id}/file`,freshToken)).status,500);
  await dbRun('ALTER TABLE download_events_unavailable RENAME TO download_events');
  assert.equal((await request('/api/admin/downloads/events',bossToken)).status,200);
  if(process.env.WQT_DOWNLOAD_PG_BROWSER==='1') {
    const {chromium}=await import('playwright');
    const browser=await chromium.launch({headless:true,...(process.env.WQT_BROWSER_CHANNEL?{channel:process.env.WQT_BROWSER_CHANNEL}:{})});
    try {
      const page=await browser.newPage({acceptDownloads:true,viewport:{width:1440,height:1000}});
      const errors=[];page.on('pageerror',error=>errors.push(error.message));
      await page.addInitScript(({bossToken,playerToken})=>{
        localStorage.setItem('aw_token',bossToken);localStorage.setItem('aw_user',JSON.stringify({role:'boss',username:'合成管理员'}));localStorage.setItem('WQT_AUTH_TOKEN',playerToken);
      },{bossToken,playerToken:freshToken});
      // Restrict external HTTP without intercepting browser-managed blob downloads.
      await page.route(/^https?:\/\//,route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
      await page.goto(`${base}/admin/downloads`);
      await page.locator('.el-input__inner').nth(0).fill('浏览器联调桌游资料');
      await page.locator('.el-input__inner').nth(1).fill('2');
      await page.locator('input[type=file]').setInputFiles({name:'桌游资料.zip',mimeType:'application/zip',buffer:Buffer.from('browser-end-to-end-materials')});
      const publication=page.waitForResponse(response=>response.url().endsWith('/api/admin/downloads') && response.request().method()==='POST');
      await page.getByRole('button',{name:'上传并发布'}).click();assert.equal((await publication).status(),201);
      await page.getByText('发布成功',{exact:true}).waitFor();
      await page.getByRole('cell',{name:'浏览器联调桌游资料',exact:true}).first().waitFor();
      if(process.env.WQT_DOWNLOAD_PREVIEW_DIR)await page.screenshot({path:`${process.env.WQT_DOWNLOAD_PREVIEW_DIR}/download-admin-pg.png`,fullPage:true});
      await page.goto(`${base}/downloads.html`);await page.getByRole('heading',{name:'浏览器联调桌游资料'}).waitFor();
      const latestForBrowser=await (await request('/api/downloads',freshToken)).json();
      assert.equal(latestForBrowser.releases[0].filename,'桌游资料.zip');
      const downloading=page.waitForEvent('download');await page.getByRole('button',{name:'↓ 下载资料'}).click();const downloaded=await downloading;
      assert.equal(await downloaded.failure(),null);assert.equal(downloaded.suggestedFilename(),'桌游资料.zip');
      assert.equal((await readFile(await downloaded.path())).toString(),'browser-end-to-end-materials');
      assert.deepEqual(errors,[]);
      console.log('DOWNLOAD_PG_BROWSER_OK admin-ui-upload player-browser-download real-PG real-auth storage-double');
    } finally {await browser.close()}
  }
  console.log('DOWNLOAD_PG_OK migration-repeat login-session-expiry org-suspension private-upload checksum audit-fail-closed transaction-rollback');
  process.exitCode=0;
} catch(error){console.error(error);process.exitCode=1;}
finally{if(server)await new Promise(r=>{server.close(r);server.closeAllConnections()});process.exit(process.exitCode||0)}
