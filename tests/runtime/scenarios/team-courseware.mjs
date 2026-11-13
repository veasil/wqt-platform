import assert from 'node:assert/strict';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {mkdir,readFile} from 'node:fs/promises';
import bcrypt from 'bcryptjs';
import {chromium} from 'playwright';
import jwt from 'jsonwebtoken';
import {startRuntime} from '../../../src/runtime.js';
import {dbRun,dbGet} from '../../../src/db.js';
import {cardsDbRun} from '../../../src/cards-db.js';
import {storeTeamAuthorizationCode,revokeIdentitySession} from '../../../src/services/identity-sessions.js';
import {createCoursewareServer} from '../../../examples/courseware/emma/serve.mjs';
export async function run({demo=false}={}){
 let runtime,site,browser,demoSite;
 try{
  runtime=await startRuntime({port:0,host:'127.0.0.1'});
  const base=`http://127.0.0.1:${runtime.server.address().port}`;
  const sampleConfig={platformOrigin:base,clientId:'emma-courseware',redirectUri:''};
  site=demo?createCoursewareServer({config:sampleConfig}):createServer(async(req,res)=>{
   res.setHeader('Cache-Control','no-store');
   if(req.url==='/sdk/team-client.js'){res.setHeader('Content-Type','text/javascript');res.end(await readFile(new URL('../../../shared/browser/team-client.js',import.meta.url)));return}
   res.setHeader('Content-Type','text/html');res.end('<!doctype html><meta charset="utf-8"><title>Independent courseware</title><h1>独立课件验证</h1>');
  });site.listen(0,'127.0.0.1');await once(site,'listening');
  const origin=`http://127.0.0.1:${site.address().port}`,redirect=origin+'/',now=Date.now(),password='SyntheticTeamTestOnly!';
  sampleConfig.redirectUri=redirect;
  async function fixture(phone,name){
   const id=(await dbRun('INSERT INTO identities(phone,password_hash,guardian_name,created_at) VALUES(?,?,?,?)',[phone,bcrypt.hashSync(password,10),name,now])).lastID;
   const org=(await dbRun('INSERT INTO organizations(name,owner_user_id) VALUES(?,0)',[name])).lastID;
   const account=(await dbRun("INSERT INTO accounts(organization_id,name,role,valid_until,created_at) VALUES(?,?,'boss',?,?)",[org,name,now+86400000,now])).lastID;
   await dbRun('INSERT INTO account_bindings(account_id,identity_id,started_at) VALUES(?,?,?)',[account,id,now]);return {id,account,phone};
  }
  const emma=await fixture('16600000151','示例老师'),other=await fixture('16600000152','其他组织');
  const registration=[{clientId:'emma-courseware',name:'Emma 课件',redirectUris:[redirect],identityIds:[emma.id]}];
  process.env.WQT_TEAM_APPS=JSON.stringify(registration);
  async function api(path,body,token,requestOrigin=origin){
   const res=await fetch(base+path,{method:body?'POST':'GET',headers:{Origin:requestOrigin,'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined});
   return {status:res.status,data:await res.json(),headers:res.headers};
  }
  async function login(person){const result=await api('/api/auth/login',{phone:person.phone,password,verificationMethod:'password'});assert.equal(result.status,200,JSON.stringify(result.data));return result.data.token}
  const identityToken=await login(emma),otherIdentity=await login(other);
  const options={A:{text:'先停一下',consequence:'观察环境',reason:'安全力加一',attributeEffects:{安全力:1}}};
  const card=(await cardsDbRun("INSERT INTO cards(key,safety_type,event,phase,options_json,status,title,card_code) VALUES(99151,'身体','课堂选择','青春期',?,'released','示例卡','TEAM01')",[JSON.stringify(options)])).lastID;
  const released=(await cardsDbRun("INSERT INTO cards_released(card_id,key,safety_type,event,phase,options_json,released_at,title,card_code) VALUES(?,99151,'身体','课堂选择','青春期',?,?,'示例卡','TEAM01')",[card,JSON.stringify(options),now])).lastID;
  const group=(await cardsDbRun("INSERT INTO card_groups(name,released_ids_json,is_default,created_at) VALUES('团队课件测试',?,0,?)",[JSON.stringify([released]),now])).lastID;
  if(demo){
   console.log(JSON.stringify({demo:'WQT015_READY',courseware:redirect,platform:base+'/player/',phone:emma.phone,password,cardGroupId:group,warning:'Synthetic local data only; closes and deletes owned test database on exit'}));
   await new Promise(resolve=>{process.once('SIGTERM',resolve);process.once('SIGINT',resolve);process.once('message',message=>{if(message?.type==='stop')resolve()})});return;
  }
  const start={requestId:randomUUID(),location:'独立课件',cardGroupId:group,settings:{duration:1800,counts:[2,0,0]}};
  function authInput(){const verifier=randomBytes(32).toString('base64url');return {verifier,input:{client_id:'emma-courseware',redirect_uri:redirect,state:randomBytes(24).toString('base64url'),code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256',accountId:emma.account}}}
  async function issue(token=identityToken){const attempt=authInput(),response=await api('/api/connect/authorize',attempt.input,token,base);assert.equal(response.status,200,JSON.stringify(response.data));const url=new URL(response.data.redirectUrl);assert.equal(url.searchParams.get('state'),attempt.input.state);return {grant_type:'authorization_code',client_id:'emma-courseware',redirect_uri:redirect,code:url.searchParams.get('code'),code_verifier:attempt.verifier}}
  assert.equal((await api('/api/connect/authorize',{...authInput().input,redirect_uri:'https://unregistered.example/'},identityToken)).status,400);
  assert.equal((await api('/api/connect/authorize',authInput().input,otherIdentity)).status,403);
  const grant=await issue();
  assert.equal((await api('/api/connect/token',{...grant,code_verifier:randomBytes(32).toString('base64url')})).status,400);
  assert.equal((await api('/api/connect/token',grant,null,'https://unregistered.example')).status,403);
  const exchanges=await Promise.all([api('/api/connect/token',grant),api('/api/connect/token',grant)]);
  assert.deepEqual(exchanges.map(x=>x.status).sort(),[200,400]);
  const token=exchanges.find(x=>x.status===200).data.access_token;
  assert.equal(jwt.decode(token).type,'team_app');assert.notEqual(token,identityToken);
  assert.equal((await api('/api/connect/session',null,token)).status,200);
  for(const path of ['/api/auth/session','/api/admin/stats/overview','/api/me','/api/game/last-session'])assert.equal((await api(path,null,token)).status,403,path);
  assert.equal((await api('/api/game/event',{sessionId:1,type:'fake'},token)).status,403);
  assert.equal((await api('/api/connect/session',null,token,'https://unregistered.example')).status,403);
  const started=await api('/api/player/start',start,token);assert.equal(started.status,200,JSON.stringify(started.data));
  const sid=started.data.sessionId;assert.equal((await api('/api/player/start',start,token)).data.sessionId,sid);
  const action={requestId:randomUUID(),sessionId:sid,revision:0,action:'choice',cardId:card,choice:'A'};
  const choices=await Promise.all([api('/api/player/action',action,token),api('/api/player/action',action,token)]);
  assert.ok(choices.every(x=>x.status===200),JSON.stringify(choices.map(x=>x.data)));
  assert.deepEqual(choices[0].data,choices[1].data);assert.equal(choices[0].data.state.values[0],4);
  assert.equal((await dbGet("SELECT COUNT(*)::int AS count FROM game_events WHERE session_id=? AND type='card_choice'",[sid])).count,1);
  assert.equal((await api('/api/player/action',{...action,requestId:randomUUID()},token)).status,409);
  assert.equal((await api('/api/player/action',{...action,choice:'B'},token)).status,409);
  const otherStart=await api('/api/player/start',{...start,requestId:randomUUID()},otherIdentity);
  assert.equal(otherStart.status,200,JSON.stringify(otherStart.data));
  assert.equal((await api('/api/player/session/'+otherStart.data.sessionId,null,token)).status,404);
  const read=await api('/api/player/session/'+sid,null,token);assert.equal(read.data.state.revision,1);
  const ended=await api('/api/player/action',{requestId:randomUUID(),sessionId:sid,revision:1,action:'finish'},token);
  assert.equal(ended.status,200);assert.equal(ended.data.state.ended,true);assert.equal(typeof ended.data.finalScore,'number');
  // Expired code must not exchange; no 60-second wall-clock sleep is needed.
  const expiredCode=randomBytes(32).toString('base64url');
  const decoded=jwt.decode(identityToken);
  await storeTeamAuthorizationCode(expiredCode,{clientId:'emma-courseware',redirectUri:redirect,challenge:createHash('sha256').update(grant.code_verifier).digest('base64url'),identityId:emma.id,accountId:emma.account,jti:decoded.jti,credentialVersion:decoded.credentialVersion,expiresAt:Date.now()+20});
  await new Promise(resolve=>setTimeout(resolve,40));
  assert.equal((await api('/api/connect/token',{...grant,code:expiredCode})).status,400);
  // Independent browser runs the SDK and platform authorization UI with real CORS/Redis/PG.
  browser=await chromium.launch({headless:true});const context=await browser.newContext();const page=await context.newPage();
  await context.addInitScript(({base,identityToken})=>{if(location.origin===base)localStorage.setItem('WQT_AUTH_TOKEN',identityToken)},{base,identityToken});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin);
  const configuration={platformOrigin:base,clientId:'emma-courseware',redirectUri:redirect};
  const install=async()=>page.evaluate(async config=>{const {createWqtClient}=await import('/sdk/team-client.js');window.client=createWqtClient(config)},configuration);
  await install();
  await page.evaluate(()=>window.client.login());
  await page.waitForURL(base+'/connect/authorize.html?**');
  await page.locator('#account').selectOption(String(emma.account));
  await page.locator('#connect').click();await page.waitForURL(origin+'/?code=**');
  await install();assert.equal(await page.evaluate(()=>window.client.handleCallback()),true);
  assert.equal(page.url(),redirect,'authorization code removed from browser URL');
  const connection=await page.evaluate(()=>window.client.getConnection());assert.equal(connection.account.id,emma.account);
  const browserStart=await page.evaluate(input=>window.client.startSession(input),start);
  const browserId=browserStart.sessionId;
  let browserState=await page.evaluate(id=>window.client.getSession(id),browserId);
  assert.equal(browserState.state.revision,0);
  assert.equal((await page.evaluate(id=>window.client.getCards(id),browserId)).cards.length,1);
  // Drop only the response after the real server commits. SDK must preserve exact operation across reload.
  await page.evaluate(()=>{const realFetch=window.fetch;window.fetch=async(...args)=>{const response=await realFetch(...args);if(String(args[0]).endsWith('/api/player/action')){window.fetch=realFetch;await response.text();throw new TypeError('simulated lost response after commit')}return response}});
  const uncertain=await page.evaluate(async id=>{try{await window.client.performAction({sessionId:id,revision:0,action:'adjust',values:[5,4,3,3,3]})}catch(e){return {unknown:e.outcomeUnknown,pending:window.client.getPending()}}},browserId);
  assert.equal(uncertain.unknown,true);assert.ok(uncertain.pending.body.requestId);
  await page.reload();await install();await page.evaluate(()=>window.client.getConnection());
  assert.equal((await page.evaluate(()=>window.client.getPending())).body.requestId,uncertain.pending.body.requestId);
  const replay=await page.evaluate(()=>window.client.retryPending());assert.equal(replay.state.revision,1);
  assert.equal((await dbGet("SELECT COUNT(*)::int AS count FROM game_events WHERE session_id=? AND type='adjust'",[browserId])).count,1);
  await page.reload();await install();await page.evaluate(()=>window.client.getConnection());
  browserState=await page.evaluate(id=>window.client.getSession(id),browserId);assert.deepEqual(browserState.state.values,[5,4,3,3,3]);
  const finished=await page.evaluate(id=>window.client.performAction({sessionId:id,revision:1,action:'finish'}),browserId);assert.equal(finished.state.ended,true);
  assert.equal(await page.evaluate(()=>location.origin),origin);assert.notEqual(origin,base);assert.deepEqual(errors,[]);
  // Exercise the delivered sample, not just an SDK caller.
  const uiConfig={platformOrigin:base,clientId:'emma-courseware',redirectUri:''};
  demoSite=createCoursewareServer({config:uiConfig});demoSite.listen(0,'127.0.0.1');await once(demoSite,'listening');
  uiConfig.redirectUri=`http://127.0.0.1:${demoSite.address().port}/`;
  registration[0].redirectUris.push(uiConfig.redirectUri);process.env.WQT_TEAM_APPS=JSON.stringify(registration);
  await page.goto(uiConfig.redirectUri);await page.locator('#login').click();
  await page.waitForURL(base+'/connect/authorize.html?**');await page.locator('#account').selectOption(String(emma.account));await page.locator('#connect').click();
  await page.waitForURL(uiConfig.redirectUri);await page.locator('#start').waitFor();
  await page.locator('input[name=cardGroupId]').fill(String(group));await page.locator('#start').click();
  await page.locator('#game').waitFor({state:'visible'});
  await page.locator('details summary').click();await page.locator('input[name=score0]').fill('6');
  await page.locator('#adjust-form button').click();await page.waitForFunction(()=>document.querySelector('#scores').textContent.includes('6'));
  await page.reload();await page.locator('#game').waitFor({state:'visible'});assert.match(await page.locator('#scores').innerText(),/6/);
  await page.locator('#finish').click();await page.locator('#result').waitFor({state:'visible'});
  assert.ok((await page.locator('#result').innerText()).length>0);assert.deepEqual(errors,[]);
  await mkdir('tmp/wqt015-evidence',{recursive:true});await page.screenshot({path:'tmp/wqt015-evidence/courseware-result.png',fullPage:true});
  process.env.WQT_TEAM_APPS='[]';assert.equal((await api('/api/connect/session',null,token)).status,403);
  process.env.WQT_TEAM_APPS=JSON.stringify(registration);
  await dbRun('UPDATE account_bindings SET ended_at=? WHERE account_id=? AND ended_at IS NULL',[Date.now(),emma.account]);
  assert.equal((await api('/api/connect/session',null,token)).status,403);
  await dbRun('UPDATE account_bindings SET ended_at=NULL WHERE account_id=?',[emma.account]);
  await revokeIdentitySession(emma.id);assert.equal((await api('/api/connect/session',null,token)).status,401);
  console.log('TEAM_COURSEWARE_OK');
 }finally{await browser?.close();if(demoSite)await new Promise(resolve=>demoSite.close(resolve));if(site)await new Promise(resolve=>site.close(resolve));await runtime?.stop()}
}
