import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {chromium} from 'playwright';
import {initialState,applyAction} from '../../src/game/player/state.js';

const publicRoot=resolve('public');
const fixture=`
user={identityId:1,accountId:11,guardianName:'测试守望者',validityValid:true};account={id:11,name:'第二局回归测试组织账号',role:'watcher'};
settings={GAME_MODES:JSON.stringify([{id:'standard',name:'标准模式',time:300,distribution:{启蒙期:2,成长期:0,青春期:0}}])};groups=[{id:1,name:'测试卡组',is_default:1}];
localStorage.setItem('WQT_AUTH_TOKEN','synthetic');
window.nextGameFixture={keepRecording(){audioBlob=new Blob(['first round recording']);audioContext={identityId:1,accountId:11,sessionId:session.id};syncIdentity()}};
activities();`;
const card={id:1,card_code:'B01',phase:'启蒙期',safetyType:'测试风险',title:'测试情景',event:'这是一段合成题面。',options:{A:{text:'观察',consequence:'安全观察',attributeDelta:{}},B:{text:'求助',consequence:'及时求助',attributeDelta:{}}}};

async function harness(t,width,theme){
 const browser=await chromium.launch({headless:true});t.after(()=>browser.close());
 const page=await browser.newPage({viewport:{width,height:1000}}),errors=[],calls=[],sessions=new Map();
 let sequence=100;
 let feedbackGate=null;
 page.on('pageerror',error=>errors.push(error.message));
 page.on('console',message=>{if(message.type()==='error'&&message.text().startsWith('玩家操作未完成'))errors.push(message.text())});
 t.after(()=>assert.deepEqual(errors,[]));
 await page.route('http://localhost/**',async route=>{
  const path=new URL(route.request().url()).pathname;
  if(path.startsWith('/api/')){
   const body=route.request().postDataJSON();calls.push({path,body});let data={};
   if(path==='/api/player/feedback'){
    if(feedbackGate)await feedbackGate;
    data={pending:[...sessions.values()].filter(x=>x.state.ended).map(x=>({id:x.session.id}))};
   }
   else if(path==='/api/player/start'){
    const id=++sequence,state=initialState(body.settings);
    sessions.set(id,{session:{id,card_group_id:body.cardGroupId,started_at:Date.now()},state,events:[]});
    data={sessionId:id,initialState:state};
   }else if(path.startsWith('/api/player/session/'))data=sessions.get(Number(path.split('/').at(-1)));
   else if(path.startsWith('/api/player/cards/'))data={cards:[card]};
   else if(path==='/api/player/action'){
    const saved=sessions.get(body.sessionId),result=applyAction(saved.state,body,card);
    saved.state=result.state;saved.events.push({type:result.type,payload:JSON.stringify(result.payload),ts:Date.now()});data=result;
   }
   return route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
  }
  try{
   const target=path.startsWith('/shared/browser/')?resolve('.'+path):resolve(publicRoot,'.'+path);
   let body=await readFile(target);
   if(path==='/player/player.js')body=body.toString().replace(/safe\(resumeLogin\);\s*$/,fixture);
   await route.fulfill({body,contentType:({'.js':'text/javascript','.css':'text/css','.html':'text/html','.png':'image/png'})[extname(target)]||'application/octet-stream'});
  }catch{await route.fulfill({status:404,body:''})}
 });
 await page.goto('http://localhost/player/index.html');await page.locator('#code-form').waitFor();
 await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
 page.on('dialog',dialog=>dialog.accept());
 return {page,calls,errors,holdFeedback(){let release;feedbackGate=new Promise(resolve=>{release=resolve});return ()=>{feedbackGate=null;release()}}};
}

test('leaving a settled game while feedback loads does not render the old settlement in the next game setup',async t=>{
 const {page,errors,holdFeedback}=await harness(t,1365,'light');
 await page.locator('#skip-activity').click();await page.locator('[name=location]').fill('回归地点');
 await page.locator('#config-form .primary').click();await page.locator('#pick').waitFor();
 const release=holdFeedback();
 const waiting=page.waitForRequest('**/api/player/feedback');
 await page.locator('#finish').click();await waiting;
 // The session is settled, but the original finish handler is still awaiting feedback.
 await page.locator('#nav-game').click();await page.locator('#another').click();
 await page.locator('#code-form').waitFor();
 const completed=page.waitForResponse('**/api/player/feedback');
 release();await completed;
 await new Promise(resolve=>setTimeout(resolve,100));
 assert.equal(await page.locator('#page-error').innerText(),'');
 assert.equal(await page.locator('#code-form').count(),1,'late completion keeps the next-round screen');
 assert.deepEqual(errors,[]);
});

for(const width of [360,390,701,820,1100,1101,1365])for(const theme of ['dark','light'])test(`two complete games preserve state and header at ${width}px ${theme}`,async t=>{
 const {page,calls,errors}=await harness(t,width,theme);
 for(let round=1;round<=2;round++){
  await page.locator('#skip-activity').click();
  await page.locator('[name=location]').fill('回归测试地点');
  await page.locator('#config-form .primary').click();
  await page.locator('#pick').waitFor();
  assert.equal(await page.locator('#page-error').innerText(),'');
  await page.locator('#pick').click();await page.locator('[data-card="1"]').click();
  await page.locator('[data-choice="A"]').click();await page.locator('#confirm').click();
  await page.locator('#feedback-text').waitFor();
  if(process.env.WQT_UI_SCREENSHOT_DIR){
   await mkdir(process.env.WQT_UI_SCREENSHOT_DIR,{recursive:true});
   await page.screenshot({path:resolve(process.env.WQT_UI_SCREENSHOT_DIR,`round-${round}-${width}-${theme}.png`),fullPage:true});
  }
  const header=await page.locator('header').evaluate(element=>{
   const rect=e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom}};
   return {bounds:rect(element),items:[...element.querySelectorAll('.brand,.nav,.identity,.theme-toggle')].map(e=>({name:e.className,...rect(e)})),controls:[...element.querySelectorAll('button')].map(e=>({name:e.textContent,...rect(e)}))};
  });
  for(const item of [...header.items,...header.controls]){
   assert.ok(item.left>=header.bounds.left-1&&item.right<=header.bounds.right+1,`round ${round}: header ${item.name} fits ${width}px: ${JSON.stringify(header)}`);
  }
  for(let i=0;i<header.items.length;i++)for(let j=i+1;j<header.items.length;j++){
   const a=header.items[i],b=header.items[j];
   assert.ok(Math.min(a.right,b.right)-Math.max(a.left,b.left)<=1||Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)<=1,`round ${round}: ${a.name} overlaps ${b.name} at ${width}px: ${JSON.stringify(header)}`);
  }
  const navigation=await page.locator('.nav button').evaluateAll(buttons=>buttons.map(button=>({text:button.textContent,height:button.getBoundingClientRect().height,lineHeight:parseFloat(getComputedStyle(button).lineHeight),padding:parseFloat(getComputedStyle(button).paddingTop)+parseFloat(getComputedStyle(button).paddingBottom),border:parseFloat(getComputedStyle(button).borderTopWidth)+parseFloat(getComputedStyle(button).borderBottomWidth)})));
  for(const item of navigation)assert.ok(item.height<=Math.max(40,item.lineHeight+item.padding+item.border)+1,`round ${round}: navigation ${item.text} wraps at ${width}px: ${JSON.stringify(item)}`);
  assert.ok(await page.locator('#identity-menu').evaluate(button=>button.clientWidth>=70),`round ${round}: account name must remain readable at ${width}px`);
  await page.locator('#finish').click();await page.locator('#another').waitFor();
  if(round===1)await page.evaluate(()=>nextGameFixture.keepRecording());
  await page.locator('#another').click();await page.locator('#code-form').waitFor();
  assert.equal(await page.locator('#page-error').innerText(),'');
 }
 assert.equal(calls.filter(x=>x.path==='/api/player/start').length,2);
 assert.equal(calls.filter(x=>x.path==='/api/player/action'&&x.body.action==='finish').length,2);
 assert.deepEqual(errors,[]);
});
