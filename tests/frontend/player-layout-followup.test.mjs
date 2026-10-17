import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {chromium} from 'playwright';

// Browser fixtures exercise the real view code without a database or external calls.
const publicRoot=resolve('public');
const fixture=`
user={identityId:1,accountId:11,guardianName:'示例守望者',validityValid:true};account={id:11,name:'暖禾社工室',role:'watcher'};
session={id:101};state={values:[3,2,2,6,6],ended:false,paused:false,revision:1,phase:0,done:[0,0,0],counts:[3,3,3],used:[],d:{},duration:1800,startedAt:Date.now(),pausedMs:0};
scoreOverview={scoreDetails:Object.fromEntries(names.map(n=>[n,{max:10}]))};
events=Array.from({length:10},(_,i)=>({type:'adjust',ts:Date.now(),payload:JSON.stringify({text:'现场协作记录 '+i,reason:'认真观察现场互动，记录大家的讨论与决定。'.repeat(25)})}));
window.fixture={game,watch,me,login};game();window.fixture.ready=true;`;

async function harness(t,width){
 const browser=await chromium.launch({headless:true});t.after(()=>browser.close());
 const page=await browser.newPage({viewport:{width,height:1000}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));t.after(()=>assert.deepEqual(errors,[]));
 await page.route('http://localhost/**',async route=>{
  const url=new URL(route.request().url());
  if(url.pathname==='/shared/browser/sms-cooldown.js')return route.fulfill({contentType:'text/javascript',body:await readFile(resolve('shared/browser/sms-cooldown.js'))});
  if(url.pathname.startsWith('/api/')){
   const pending=[{id:101,location:'青禾学校 · 现场活动反馈',ended_at:Date.now(),questionnaire:{questions:Array.from({length:12},(_,i)=>({id:'q'+i,type:'text',label:'请记录现场讨论、参与情况与改进建议 '+(i+1)}))}}];
   return route.fulfill({contentType:'application/json',body:JSON.stringify(url.pathname==='/api/player/feedback'?{pending}:{})});
  }
  try{const path=resolve(publicRoot,'.'+url.pathname);if(!path.startsWith(publicRoot))return route.abort();let body=await readFile(path);
   if(url.pathname==='/player/player.js')body=body.toString().replace(/safe\(resumeLogin\);\s*$/,fixture);
   await route.fulfill({body,contentType:({'.js':'text/javascript','.css':'text/css','.html':'text/html','.png':'image/png'})[extname(path)]||'application/octet-stream'});
  }catch{await route.fulfill({status:404,body:''})}
 });
 await page.goto('http://localhost/player/index.html');await page.waitForFunction(()=>window.fixture?.ready);await page.waitForLoadState('networkidle');return page;
}

for(const width of [1365,1920,390])for(const theme of ['dark','light'])test(`aligned game and contained long panels at ${width}px ${theme}`,async t=>{
 const page=await harness(t,width);await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
 const screenshot=async name=>{if(process.env.WQT_LAYOUT_SCREENSHOT_DIR){await mkdir(process.env.WQT_LAYOUT_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:resolve(process.env.WQT_LAYOUT_SCREENSHOT_DIR,`wqt-visual-followup-${name}-${width}-${theme}.png`),fullPage:true})}};
 await screenshot('game');
 const axis=await page.locator('.select-card').evaluate(el=>{const center=e=>{const b=e.getBoundingClientRect();return b.x+b.width/2};return {button:center(el),symbol:center(el.querySelector('.idle-card-symbol')),title:center(el.querySelector('strong'))}});
 assert.ok(Math.abs(axis.button-axis.symbol)<1,'card symbol shares selection center');assert.ok(Math.abs(axis.button-axis.title)<1,'title shares selection center');
 await page.evaluate(()=>fixture.watch());
 assert.equal(await page.locator('#reset-score,#export').count(),0);
 const left=page.locator('.watch-status'),right=page.locator('.watch-board');
 const before=await left.boundingBox();await page.locator('.score-controls summary').click();
 const after=await left.boundingBox(),rightBox=await right.boundingBox();assert.equal(after.height,before.height,'expanding controls preserves outer height');
 if(width>950){assert.ok(Math.abs(after.height-rightBox.height)<1);assert.ok(Math.abs(after.y-rightBox.y)<1)}
 assert.ok(await left.evaluate(e=>e.scrollHeight>e.clientHeight),'expanded controls scroll inside');
 await screenshot('watch-expanded');
 await left.evaluate(e=>e.scrollTop=e.scrollHeight);await page.getByRole('button',{name:'确认调整',exact:true}).scrollIntoViewIfNeeded();
 assert.ok(await right.locator('.operation-timeline').evaluate(e=>e.scrollHeight>e.clientHeight),'long operation history scrolls');
 await screenshot('watch');
 await page.evaluate(()=>fixture.me('feedback'));await page.waitForSelector('#account-content[data-ready=true]');
 const frameGeometry=()=>page.evaluate(()=>{const frame=document.querySelector('#account-content').getBoundingClientRect();return {height:frame.height,footer:document.querySelector('.site-footer').getBoundingClientRect().top+scrollY}});
 const feedbackBefore=await frameGeometry();
 const survey=page.locator('.session-survey:not([hidden])');assert.ok(await survey.evaluate(e=>e.scrollHeight>e.clientHeight),'long questionnaire scrolls');
 await survey.evaluate(e=>e.scrollTop=e.scrollHeight);await page.getByRole('button',{name:'提交反馈并关闭本场'}).scrollIntoViewIfNeeded();
 await page.locator('.feedback-other summary').click();const other=page.locator('#general-feedback');
 assert.deepEqual(await frameGeometry(),feedbackBefore,'expanding other feedback leaves outer frame height and footer position unchanged');
 await other.locator('textarea').fill('详细反馈内容'.repeat(100));
 await screenshot('feedback-expanded');
 await other.locator('textarea').evaluate(e=>e.style.height='900px');
 assert.deepEqual(await frameGeometry(),feedbackBefore,'resizing feedback content does not move the outer frame or footer');
 assert.ok(await other.evaluate(e=>e.scrollHeight>e.clientHeight),'expanded opinion form has internal scroll');
 await other.evaluate(e=>e.scrollTop=e.scrollHeight);await page.getByRole('button',{name:'提交意见',exact:true}).scrollIntoViewIfNeeded();
 await screenshot('feedback');
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no horizontal page overflow');
});

test('render accepted brand baseline before adapting its layout',{skip:!process.env.WQT_LAYOUT_BASELINE},async t=>{
 const browser=await chromium.launch({headless:true});t.after(()=>browser.close());const page=await browser.newPage({viewport:{width:1365,height:1000}});
 for(const theme of ['dark','light']){await page.goto('file:///C:/Users/BibbTwigs/.codex/skills/wqt-brand-product-design/assets/baseline/refined.html?theme='+theme);await page.waitForLoadState('networkidle');await page.screenshot({path:resolve(process.env.WQT_LAYOUT_SCREENSHOT_DIR,`wqt-visual-followup-brand-baseline-${theme}.png`),fullPage:true})}
});

test('login and SMS clicks immediately show verification progress and recover when verification fails',async t=>{
 const page=await harness(t,1365);
 await page.evaluate(()=>{fixture.login();window.WqtVerification.captchaProof=()=>new Promise((_,reject)=>{window.rejectProof=reject})});
 await page.locator('[name=phone]').fill('16600000888');await page.locator('[name=password]').fill('synthetic-only');
 await page.locator('#auth-form .primary').click();assert.equal(await page.locator('#auth-form .primary').innerText(),'准备验证…');
 await page.evaluate(()=>rejectProof(new Error('模拟验证取消')));await page.waitForFunction(()=>!document.querySelector('#auth-form .primary').disabled);
 assert.equal(await page.locator('#auth-form .primary').innerText(),'登录');
 await page.locator('#auth-sms').click();await page.locator('[name=phone]').fill('16600000888');
 await page.locator('#send-code').click();assert.equal(await page.locator('#send-code').innerText(),'准备验证…');assert.match(await page.locator('#sms-status').innerText(),/正在准备安全验证/);
 await page.evaluate(()=>rejectProof(new Error('模拟验证取消')));await page.waitForFunction(()=>!document.querySelector('#send-code').disabled);
 assert.equal(await page.locator('#send-code').innerText(),'重新获取');
});
