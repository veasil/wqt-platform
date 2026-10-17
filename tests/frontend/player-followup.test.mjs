import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {chromium} from 'playwright';

// Browser-only fixtures: no server startup, database, credentials, or external requests.
const root=resolve('public');
const fixture=`
user={identityId:Number(sessionStorage.getItem('fixture-identity')||1),accountId:11,guardianName:'示例守望者',validityValid:true};
account={id:11,name:'示例社工室',role:'watcher'};
session={id:101};state={values:[3,2,2,6,6],ended:false,paused:true,revision:1};
scoreOverview={scoreDetails:Object.fromEntries(names.map(n=>[n,{max:10}]))};
pending=[{id:99}];localStorage.setItem('WQT_AUTH_TOKEN','fixture-token');
window.fixture={watch,chooseAccount,studyMaterials,
 auth(){return {user:{identityId:user.identityId,accountId:user.accountId}}},
 setPending(value){pending=value;syncIdentity()},
 async endedAudio(){audioBlob=new Blob(['original session recording'],{type:'audio/webm'});audioContext={identityId:user.identityId,accountId:11,sessionId:101,draftId:crypto.randomUUID()};await persistAudioDraft();state.ended=true;ended()},
 async identity(id){sessionStorage.setItem('fixture-identity',id);user.identityId=id;await restoreAudioDraft();syncIdentity()},
 account(id){account.id=id;user.accountId=id},
 newSession(){session={id:202};state={ended:false};syncIdentity()},
 recording(){return {size:audioBlob?.size,sessionId:audioContext?.sessionId}},
 setPaid(value){user.validityValid=value}};
await restoreAudioDraft();watch();window.fixture.ready=true;`;

async function harness(t){
 let browser;
 try{browser=await chromium.launch({headless:true})}catch(error){t.skip('Chromium unavailable: '+error.message);return}
 t.after(()=>browser.close());
 const page=await browser.newPage({viewport:{width:1365,height:1000}});
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 t.after(()=>assert.deepEqual(errors,[]));
 const calls=[];
 const uploadResponse={status:503};
 const accounts=[{id:11,name:'示例社工室',role:'watcher',status:'active',valid_until:Date.now()+86400000},{id:12,name:'示例学校',role:'watcher',status:'active',valid_until:Date.now()+86400000}];
 await page.route('http://localhost/**',async route=>{
  const url=new URL(route.request().url());
  if(url.pathname==='/shared/browser/sms-cooldown.js')return route.fulfill({contentType:'text/javascript',body:await readFile(resolve('shared/browser/sms-cooldown.js'))});
  if(url.pathname.startsWith('/api/')){
   calls.push({path:url.pathname,body:route.request().postData(),headers:route.request().headers()});
   let data={};
   if(url.pathname==='/api/auth/session')data=await page.evaluate(()=>fixture.auth());
   else if(url.pathname==='/api/auth/accounts')data={accounts};
   else if(url.pathname.startsWith('/api/auth/activity-account/'))data=url.pathname.endsWith('/UNKNOWN')?{activity:{activity_code:'UNKNOWN'},accounts:[]}:{activity:{activity_code:'SCHOOL'},accounts:[accounts[1]]};
   else if(url.pathname==='/api/auth/select-account')data={token:'selected-token',user:{identityId:1,accountId:JSON.parse(route.request().postData()).accountId,guardianName:'示例守望者',validityValid:true}};
   else if(url.pathname==='/api/player/feedback')data={pending:[]};
   else if(url.pathname==='/api/game/last-session')data={session:null};
   else if(url.pathname==='/api/upload/audio')return route.fulfill({status:uploadResponse.status,contentType:'application/json',body:JSON.stringify({error:'模拟上传失败'})});
   else if(url.pathname==='/api/player/action')return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'模拟提交失败'})});
   return route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
  }
  try{
   const path=resolve(root,'.'+url.pathname);
   if(!path.startsWith(root))return route.abort();
   let body=await readFile(path);
   if(url.pathname==='/player/player.js')body=body.toString().replace(/safe\(resumeLogin\);\s*$/,fixture);
   await route.fulfill({body,contentType:({'.js':'text/javascript','.css':'text/css','.html':'text/html','.png':'image/png'})[extname(path)]||'application/octet-stream'});
  }catch{return route.fulfill({status:404,body:''})}
 });
 await page.goto('http://localhost/player/index.html');
 await page.waitForFunction(()=>!!window.fixture?.ready);
 return {page,calls,accounts,uploadResponse};
}

test('score controls preview the radar, clamp values, and submit an optional reason without changing state first',async t=>{
 const h=await harness(t);if(!h)return;const {page,calls}=h;
 await page.locator('.score-controls summary').click();
 const original=await page.locator('.radar .actual').getAttribute('points');
 await page.getByRole('button',{name:'安全力加1',exact:true}).click();
 assert.equal(await page.locator('#score-value-0').inputValue(),'4');
 assert.notEqual(await page.locator('.radar .actual').getAttribute('points'),original);
 assert.equal(await page.locator('.radar-total strong').innerText(),'40分');
 assert.equal(await page.locator('.watch-score-tile strong').first().innerText(),'3');
 assert.equal(calls.filter(c=>c.path==='/api/player/action').length,0);
 for(const [width,theme] of [[1365,'dark'],[1365,'light'],[390,'dark'],[390,'light']]){
  await page.setViewportSize({width,height:1000});
  await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
  for(const selector of ['.radar-total','.score-step-row','.score-reason']){
   const box=await page.locator(selector).first().boundingBox();
   assert.ok(box.x>=0&&box.x+box.width<=width,`${selector} fits ${width}px ${theme}`);
  }
  if(process.env.WQT_PLAYER_SCREENSHOT_DIR)await page.screenshot({path:resolve(process.env.WQT_PLAYER_SCREENSHOT_DIR,`player-followup-${width}-${theme}.png`),fullPage:true});
 }
 await page.setViewportSize({width:1365,height:1000});
 for(let i=0;i<4;i++)await page.getByRole('button',{name:'安全力减1',exact:true}).click();
 assert.equal(await page.getByRole('button',{name:'安全力减1',exact:true}).isDisabled(),true);
 assert.equal(await page.locator('[name=reason]').getAttribute('required'),null);
 await page.getByRole('button',{name:'确认调整',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('#page-error').textContent.includes('模拟提交失败'));
 assert.deepEqual(JSON.parse(calls.find(c=>c.path==='/api/player/action').body).values,[0,2,2,6,6]);
 assert.equal(JSON.parse(calls.find(c=>c.path==='/api/player/action').body).reason,'');
 assert.equal(await page.locator('.radar-caption').count(),0);
 assert.equal(await page.locator('#nav-me').getAttribute('aria-label'),'我的，1 场待完成反馈');
 await page.evaluate(()=>fixture.setPending([]));
 assert.equal(await page.locator('#nav-me').getAttribute('class'),'');
});

test('new game retains original recording ownership and failure/download recovery without allowing overwrite',async t=>{
 const h=await harness(t);if(!h)return;const {page,calls}=h;
 await page.evaluate(()=>fixture.endedAudio());
 await page.getByRole('button',{name:'开启另一局',exact:true}).click();
 assert.equal(await page.getByRole('heading',{name:'选择当前活动'}).count(),1);
 await page.evaluate(()=>fixture.newSession());
 await page.locator('#pending-audio').click();
 assert.match(await page.locator('dialog').innerText(),/场次 101 的录音待保存/);
 assert.equal(await page.locator('#record-toggle').count(),0);
 await page.getByRole('button',{name:'上传并保存',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('#audio-status').textContent.includes('模拟上传失败'));
 const upload=calls.find(c=>c.path==='/api/upload/audio');
 assert.equal(upload.headers.authorization,'Bearer fixture-token');
 assert.match(upload.body,/name="sessionId"\r\n\r\n101/);
 const download=page.waitForEvent('download');
 await page.getByRole('button',{name:'下载本地副本',exact:true}).click();
 assert.equal((await download).suggestedFilename(),'游戏录音-场次101.webm');
 assert.deepEqual(await page.evaluate(()=>fixture.recording()),{size:26,sessionId:101});
});

test('stopped audio survives refresh, isolates identities, and uploads only with current authorization for its original account',async t=>{
 const h=await harness(t);if(!h)return;const {page,calls}=h;
 await page.evaluate(()=>fixture.endedAudio());
 const stored=await page.evaluate(async()=>{
  const db=await new Promise(resolve=>{const r=indexedDB.open('WQT_PLAYER_AUDIO');r.onsuccess=()=>resolve(r.result)});
  const value=await new Promise(resolve=>{const r=db.transaction('drafts').objectStore('drafts').get(1);r.onsuccess=()=>resolve(r.result)});db.close();
  return {keys:Object.keys(value),text:await value.blob.text()};
 });
 assert.equal(stored.text,'original session recording');assert.ok(!stored.keys.includes('token'));
 await page.reload();await page.waitForFunction(()=>fixture?.ready);
 assert.deepEqual(await page.evaluate(()=>fixture.recording()),{size:26,sessionId:101});
 await page.evaluate(()=>fixture.identity(2));
 assert.equal(await page.locator('#pending-audio').count(),0);
 assert.equal((await page.evaluate(()=>fixture.recording())).size,undefined);
 await page.reload();await page.waitForFunction(()=>fixture?.ready);
 assert.equal(await page.locator('#pending-audio').count(),0);
 await page.evaluate(()=>fixture.identity(1));
 await page.locator('#pending-audio').click();
 await page.evaluate(()=>fixture.account(12));
 await page.locator('#upload-audio').click();
 await page.waitForFunction(()=>document.querySelector('#audio-status').textContent.includes('原账号'));
 assert.equal(calls.filter(c=>c.path==='/api/upload/audio').length,0);
 await page.evaluate(()=>{fixture.account(11);fixture.newSession();localStorage.setItem('WQT_AUTH_TOKEN','refreshed-token')});
 await page.locator('#upload-audio').click();
 await page.waitForFunction(()=>document.querySelector('#audio-status').textContent.includes('模拟上传失败'));
 const upload=calls.find(c=>c.path==='/api/upload/audio');assert.equal(upload.headers.authorization,'Bearer refreshed-token');
 assert.match(upload.body,/name="sessionId"\r\n\r\n101/);
 page.once('dialog',d=>d.accept());await page.locator('#clear-audio').click();
 await page.waitForFunction(()=>!document.querySelector('#pending-audio'));
 await page.reload();await page.waitForFunction(()=>fixture?.ready);
 assert.equal(await page.locator('#pending-audio').count(),0);
});

test('successful audio upload clears durable draft; unavailable storage keeps a downloadable in-memory copy',async t=>{
 const h=await harness(t);if(!h)return;const {page,uploadResponse}=h;
 await page.evaluate(()=>fixture.endedAudio());uploadResponse.status=200;
 await page.locator('#pending-audio').click();await page.locator('#upload-audio').click();
 await page.waitForFunction(()=>document.querySelector('#audio-status').textContent.includes('录音已保存'));
 await page.reload();await page.waitForFunction(()=>fixture?.ready);
 assert.equal(await page.locator('#pending-audio').count(),0);
 await page.evaluate(()=>{Object.defineProperty(window,'indexedDB',{configurable:true,value:undefined})});
 await page.evaluate(()=>fixture.endedAudio());
 await page.locator('#pending-audio').click();assert.match(await page.locator('#audio-status').innerText(),/立即下载/);
 const download=page.waitForEvent('download');await page.locator('#local-audio').click();assert.equal((await download).suggestedFilename(),'游戏录音-场次101.webm');
});

test('multiple paid accounts use activity organization and carry its code into setup; unknown organization cannot select',async t=>{
 const h=await harness(t);if(!h)return;const {page,calls}=h;
 await page.evaluate(()=>fixture.chooseAccount());
 await page.locator('[name=code]').fill('UNKNOWN');
 await page.getByRole('button',{name:'查找活动并进入'}).click();
 await page.waitForFunction(()=>document.querySelector('#page-error').textContent.includes('没有绑定'));
 assert.equal(calls.filter(c=>c.path==='/api/auth/select-account').length,0);
 await page.locator('[name=code]').fill('SCHOOL');
 await page.getByRole('button',{name:'查找活动并进入'}).click();
 await page.waitForSelector('#code-form');
 assert.deepEqual(JSON.parse(calls.find(c=>c.path==='/api/auth/select-account').body),{accountId:12});
 assert.equal(await page.locator('#code-form [name=code]').inputValue(),'SCHOOL');
});

test('a single valid paid watcher skips selection and unpaid study does not issue a request',async t=>{
 const h=await harness(t);if(!h)return;const {page,calls,accounts}=h;
 accounts.splice(1,1);
 accounts.push({id:13,role:'watcher',status:'active',valid_until:null},{id:14,role:'boss',status:'active',valid_until:null});
 await page.evaluate(()=>fixture.chooseAccount());
 await page.waitForSelector('#code-form');
 assert.deepEqual(JSON.parse(calls.find(c=>c.path==='/api/auth/select-account').body),{accountId:11});
 const error=await page.evaluate(async()=>{fixture.setPaid(false);try{await fixture.studyMaterials()}catch(e){return e.message}});
 assert.match(error,/有效付费权益/);
 assert.equal(calls.filter(c=>c.path==='/api/cards/study').length,0);
});

for(const role of ['watcher','enterprise','boss'])test(`one ${role} account enters directly without creating an extra player binding`,async t=>{
 const h=await harness(t);if(!h)return;const {page,calls,accounts}=h;
 accounts.splice(1);accounts[0].role=role;
 if(role==='watcher')accounts[0].valid_until=null;
 await page.evaluate(()=>fixture.chooseAccount());
 await page.waitForSelector('#code-form');
 assert.deepEqual(JSON.parse(calls.find(c=>c.path==='/api/auth/select-account').body),{accountId:11});
 assert.equal(calls.filter(c=>c.path.startsWith('/api/auth/activity-account/')).length,0);
});

