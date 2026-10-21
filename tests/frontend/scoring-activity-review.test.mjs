import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {chromium} from 'playwright';
const publicRoot=resolve('public');
const fixture=`
user={identityId:1,accountId:11,guardianName:'测试守望者',validityValid:true};account={id:11,name:'测试账号',role:'watcher'};
state=null;session=null;settings={GAME_MODES:JSON.stringify([{id:'standard',name:'标准模式',time:300,distribution:{启蒙期:1,成长期:0,青春期:0}}])};groups=[{id:1,name:'测试卡组',is_default:1}];
localStorage.setItem('WQT_AUTH_TOKEN','synthetic');window.fixture={me,activities,snapshot(){return JSON.stringify({session,state})}};activities();window.fixture.ready=true;`;
async function harness(t,width){
  const browser=await chromium.launch({headless:true});t.after(()=>browser.close());
  const page=await browser.newPage({viewport:{width,height:900}}), calls=[], errors=[];
  let submitted=false,created=null,reviewing=false;
  const survey={questions:[{id:'q',label:'现场观察',type:'text'}]};
  const preset={cardGroupId:1,mode:'standard',duration:600,counts:[2,1,0],ageRange:{min:8,max:12}};
  page.on('pageerror',e=>errors.push(e.message));t.after(()=>assert.deepEqual(errors,[]));
  await page.route('http://localhost/**',async route=>{
    const path=new URL(route.request().url()).pathname;
    if(path==='/api/session-files/test.webm')return route.fulfill({contentType:'audio/webm',body:'synthetic-recording'});
    if(path==='/api/session-files/report.html')return route.fulfill({contentType:'text/html',body:'synthetic-report'});
    if(path.startsWith('/api/')){
      const body=route.request().postDataJSON();calls.push({path,body});let data={},status=200;
      if(path==='/api/player/feedback'){
        if(body){submitted=true;data={ok:true}}
        else data={pending:submitted||!reviewing?[]:[{id:9,location:'学校',ended_at:Date.now(),questionnaire:survey}]};
      }
      else if(path==='/api/player/start'){status=403;data={error:'权益已到期，请先开通权益'}}
      else if(path.startsWith('/api/activities/by-code/'))data={activity:{id:1,name:created?.name||'指定活动',organizer:created?.location||'测试地点',activity_code:'TEST1',game_config_json:JSON.stringify(created?.configuration||preset)}};
      else if(path==='/api/me')data={user:{validityValid:true}};
      else if(path==='/api/activities/apply'){created=body;data={ok:true,id:1,activity_code:'TEST1',status:'active'}}
      else if(path==='/api/me/activities/created')data={activities:[]};
      else if(path==='/api/me/feedback'){
        data={feedback:[],surveys:submitted?[{session_id:9,location:'学校',created_at:Date.now(),questionnaire_json:JSON.stringify(survey),answers_json:JSON.stringify({q:'<img src=x onerror=alert(1)> 本场答案'})}]:[]};
      }else if(path==='/api/me/sessions'){reviewing=true;data={sessions:[{id:9,activity_name:'学校主题活动',location:'学校',started_at:Date.now(),ended_at:Date.now(),player_state_json:'{}',has_feedback:submitted}]}}
      else if(path==='/api/me/files')data={files:[{sessionId:9,type:'audio',name:'现场录音.webm',url:'/api/session-files/test.webm'},{sessionId:9,type:'report_html',name:'本局复盘.html',url:'/api/session-files/report.html'},{sessionId:10,type:'report_html',name:'其他场次.html',url:'/api/session-files/wrong.html'}]};
      else if(path==='/api/player/session/9')data={session:{id:9,started_at:Date.now(),game_settings_json:'{}'},state:{values:[3,3,3,3,3]},scoreOverview:{scoreDetails:Object.fromEntries(['安全力','脑波力','实感力','创心力','沟通力'].map(n=>[n,{max:10}]))},events:[{type:'card_choice',payload:JSON.stringify({cardCode:'B01',phase:'启蒙期',eventText:'真实选择记录',choice:'A',optionText:'观察',allOptions:{A:{text:'观察'},B:{text:'继续'}}})}]};
      return route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
    }
    try{
      const target=path.startsWith('/shared/browser/')?resolve('.'+path):resolve(publicRoot,'.'+path);
      let body=await readFile(target);
      if(path==='/player/player.js')body=body.toString().replace(/safe\(resumeLogin\);\s*$/,fixture);
      await route.fulfill({body,contentType:({'.js':'text/javascript','.css':'text/css','.html':'text/html','.png':'image/png'})[extname(target)]||'application/octet-stream'});
    }catch{await route.fulfill({status:404,body:''})}
  });
  await page.goto('http://localhost/player/index.html');await page.waitForFunction(()=>window.fixture?.ready);
  return {page,calls};
}
for(const width of [1365,390])for(const theme of ['dark','light'])test(`optional activity code and unified review at ${width}px ${theme}`,async t=>{
  const {page,calls}=await harness(t,width);
  await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
  const capture=async name=>{if(process.env.WQT_UI_SCREENSHOT_DIR){await mkdir(process.env.WQT_UI_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:resolve(process.env.WQT_UI_SCREENSHOT_DIR,`${name}-${width}-${theme}.png`),fullPage:true})}};
  await capture('activity-entry');
  assert.equal(await page.locator('#nav-me').innerText(),'个人主页');
  assert.equal(await page.locator('#code-form').isVisible(),true);
  assert.equal(await page.getByText('可跳过活动码，自行配置后开始；同日同地点的场次会自动关联。',{exact:true}).count(),0);
  const buttonBox=await page.locator('#skip-activity').boundingBox(),formBox=await page.locator('#code-form').boundingBox();
  assert.ok(buttonBox.width>=formBox.width-2 && buttonBox.y>formBox.y);
  await page.locator('#skip-activity').click();await page.locator('[name=location]').fill('自主地点');
  await page.locator('[name=ageMin]').fill('8');await page.locator('[name=ageMax]').fill('12');
  await capture('game-configuration');
  await page.locator('#config-form .primary').click();await page.waitForFunction(()=>document.querySelector('#page-error')?.textContent.includes('权益已到期'));
  const start=calls.find(c=>c.path==='/api/player/start');assert.equal(start.body.location,'自主地点');assert.equal(start.body.activityCode,undefined);
  assert.deepEqual(start.body.settings.ageRange,{min:8,max:12});
  await page.evaluate(()=>fixture.activities());
  await page.locator('[name=code]').fill('TEST1');await page.locator('#code-form button').click();await page.locator('#select-activity').click();
  await page.locator('#config-form .primary').click();await page.waitForFunction(()=>document.querySelector('#page-error')?.textContent.includes('权益已到期'));
  assert.equal(calls.filter(c=>c.path==='/api/player/start').at(-1).body.activityCode,'TEST1');
  assert.equal(await page.locator('[name=duration]').inputValue(),'600');
  await page.evaluate(()=>fixture.me('feedback'));await page.waitForSelector('#account-content[data-ready=true]');
  assert.deepEqual(await page.locator('.account-tabs button').allTextContents(),['个人信息','守望学习','发起活动','复盘反馈']);
  assert.equal(await page.locator('[data-review-tab]').count(),0);
  assert.ok((await page.locator('[data-session-row="9"]').innerText()).includes('学校主题活动'));
  await capture('review-rows');
  const before=await page.evaluate(()=>fixture.snapshot());
  await page.locator('[data-session-summary="9"]').click();await page.waitForSelector('.session-summary-dialog');
  assert.equal(await page.locator('.session-summary-dialog .radar').count(),1);
  assert.ok((await page.locator('.session-summary-dialog').innerText()).includes('伍力总分'));
  await page.locator('.summary-choice summary').click();assert.ok((await page.locator('.summary-choice').innerText()).includes('真实选择记录'));
  await capture('session-summary');
  assert.equal(await page.evaluate(()=>fixture.snapshot()),before,'history summary does not replace the live game');
  await page.locator('#dialog-close').click();
  await page.locator('[data-session-feedback="9"]').click();await page.locator('#session-feedback-form textarea').fill('<img src=x onerror=alert(1)> 本场答案');
  await page.locator('#session-feedback-form button').click();await page.getByRole('button',{name:'查看反馈',exact:true}).waitFor();
  await page.locator('[data-session-feedback="9"]').click();
  assert.ok((await page.locator('.session-feedback-dialog').innerText()).includes('<img src=x onerror=alert(1)> 本场答案'));
  assert.equal(await page.locator('.session-feedback-dialog img').count(),0);await page.locator('#dialog-close').click();
  assert.equal(await page.locator('.account-tabs .active').innerText(),'复盘反馈');
  await page.locator('[data-session-document="9"]').click();
  const documentText=await page.locator('.session-summary-dialog').innerText();assert.ok(!documentText.includes('现场录音'));assert.ok(!documentText.includes('其他场次'));
  const downloading=page.waitForEvent('download');await page.locator('[data-report-download="0"]').click();
  const download=await downloading;assert.equal(download.suggestedFilename(),'本局复盘.html');assert.equal(await readFile(await download.path(),'utf8'),'synthetic-report');
  await page.locator('#dialog-close').click();
  await page.evaluate(()=>fixture.me('activities'));await page.locator('#create-activity').click();
  await page.locator('#activity-apply-form [name=name]').fill('新活动');await page.locator('#activity-apply-form [name=location]').fill('测试地点');
  assert.equal(await page.locator('#activity-apply-form .game-configuration-fields').count(),1);
  await capture('activity-creation');
  await page.locator('#activity-apply-form [type=submit]').click();await page.waitForSelector('.activity-code-result');
  assert.equal(await page.locator('.activity-code-result').innerText(),'TEST1');
  await page.locator('#start-created-activity').click();await page.waitForSelector('#config-form');
  assert.equal(await page.locator('[name=location]').inputValue(),'测试地点');
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
});
