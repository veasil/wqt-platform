import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright';
import bcrypt from 'bcryptjs';
import {createClient} from 'redis';
import {startRuntime} from '../../../src/runtime.js';
import {dbRun,dbGet} from '../../../src/db.js';
import {smsStore} from '../../../src/services/sms.js';

if (process.env.WQT_RUNTIME_TEST_CHILD!=='1' || !process.env.WQT_REDIS_NAMESPACE?.startsWith('wqt_r1_')) throw new Error('owned PG/Redis browser harness required');
export async function run() {
  let runtime,browser;
  const keys=[];
  try {
    runtime=await startRuntime({port:0,host:'127.0.0.1'});
    const base=`http://127.0.0.1:${runtime.server.address().port}`;
    const now=Date.now(),phone='16600000101',password='browser-password';
    const identity=(await dbRun('INSERT INTO identities(phone,password_hash,guardian_name,created_at) VALUES(?,?,?,?)',[phone,bcrypt.hashSync(password,10),'Browser guardian',now])).lastID;
    keys.push(`${process.env.WQT_REDIS_NAMESPACE}:identity-session:${identity}`);
    const accounts=[];
    for (const [name,role,plan] of [['Platform','boss',null],['City A','enterprise','city'],['City B','enterprise','city'],['Personal','watcher',null]]) {
      const org=(await dbRun('INSERT INTO organizations(name,owner_user_id) VALUES(?,0)',[name])).lastID;
      const subscription=plan ? (await dbRun("INSERT INTO subscriptions(organization_id,plan,account_count,starts_at,valid_until,created_at) VALUES(?,'city',20,?,?,?)",[org,now,now+86400000,now])).lastID:null;
      const account=(await dbRun('INSERT INTO accounts(organization_id,subscription_id,name,role,valid_until,created_at) VALUES(?,?,?,?,?,?)',[org,subscription,`${name} account`,role,now+86400000,now])).lastID;
      await dbRun('INSERT INTO account_bindings(account_id,identity_id,started_at) VALUES(?,?,?)',[account,identity,now]);
      accounts.push(account);
    }
    const target=(await dbRun('INSERT INTO identities(phone,password_hash,guardian_name,watcher_level,created_at) VALUES(?,?,?,\'mentor\',?)',['16600000102',bcrypt.hashSync(password,10),'Retained person',now])).lastID;
    browser=await chromium.launch({headless:true,...(process.env.WQT_TEST_BROWSER_CHANNEL ? {channel:process.env.WQT_TEST_BROWSER_CHANNEL}:{})});
    console.log('BROWSER_STARTED');
    const context=await browser.newContext({viewport:{width:1365,height:980}});
    // No third-party browser traffic is needed for these identity/account controls.
    await context.route('**/*',route=>new URL(route.request().url()).origin===base ? route.continue():route.abort());
    const page=await context.newPage();
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    const shots=process.env.WQT_UI_ARTIFACT_DIR;
    if (shots) await mkdir(shots,{recursive:true});
    const screenshot=async name=>{if(shots)await page.screenshot({path:path.join(shots,`${name}.png`),fullPage:true});};
    const code=()=>smsStore.set(phone,{code:'333333',expiresAt:Date.now()+300000});

    await page.goto(base+'/admin/login');
    await page.waitForLoadState('networkidle');
    await screenshot('admin-login');
    await page.getByPlaceholder('请输入手机号').fill(phone);
    await page.getByPlaceholder('请输入密码',{exact:true}).fill(password);
    code();await page.getByRole('button',{name:'登 录'}).click();
    await page.getByRole('heading',{name:'选择本次使用的账号'}).waitFor();
    await screenshot('admin-account-choice');
    await page.getByRole('button',{name:/Platform account/}).click();
    await page.waitForURL('**/admin/');
    await page.getByRole('menuitem',{name:'组织与权益',exact:true}).click();
    await page.getByRole('tab',{name:'用户',exact:true}).click();
    await page.getByRole('row').filter({hasText:'Retained person'}).getByRole('button',{name:'换手机号'}).click();
    const dialog=page.getByRole('dialog');
    await dialog.getByLabel('新手机号',{exact:true}).fill('16600000103');
    await dialog.getByLabel('新号码短信验证码').fill('333333');
    await dialog.getByLabel('本人核验说明').fill('Browser test: verified person, lost old phone');
    smsStore.set('16600000103',{code:'333333',expiresAt:Date.now()+300000});
    await screenshot('same-person-phone-change');
    const changedResponse=page.waitForResponse(response=>response.url().endsWith('/api/admin/identities/change-phone') && response.request().method()==='POST');
    await dialog.getByRole('button',{name:'确认核验与换号'}).click();
    assert.equal((await changedResponse).status(),200);
    await dialog.waitFor({state:'hidden'});
    const person=await dbGet('SELECT id,phone,guardian_name,watcher_level FROM identities WHERE id=?',[target]);
    assert.deepEqual(person,{id:target,phone:'16600000103',guardian_name:'Retained person',watcher_level:'mentor'});

    // Commit on the real server, then lose the response: the browser must recover
    // the same operation after a reload, and PostgreSQL must contain one package.
    await page.getByRole('tab',{name:'组织与权益'}).click();
    await page.getByRole('button',{name:'新建组织权益'}).click();
    const delivery=page.getByRole('dialog',{name:'新建组织权益'});
    await delivery.getByLabel('组织名称').fill('Browser delivery');
    await delivery.locator('.el-select').click();
    await page.getByRole('option',{name:'团队合伙人 · 5个账号'}).click();
    let lost=false;
    const requestIds=[];
    await page.route('**/api/admin/subscriptions',async route=>{
      requestIds.push(route.request().postDataJSON().requestId);
      const response=await route.fetch();
      if(!lost) {lost=true;await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Test: response lost after commit'})});}
      else await route.fulfill({response});
    });
    await delivery.getByRole('button',{name:'交付组织与账号'}).click();
    await page.getByRole('button',{name:'重试原操作'}).waitFor();
    await page.reload();await page.waitForLoadState('networkidle');
    await page.getByRole('button',{name:'重试原操作'}).click();
    const receipt=page.getByRole('dialog',{name:'交付已完成'});
    await receipt.waitFor();
    assert.equal(requestIds.length,2);assert.equal(requestIds[0],requestIds[1]);
    const delivered=await dbGet("SELECT o.id,s.id AS subscription_id,s.valid_until,s.rebind_count FROM organizations o JOIN subscriptions s ON s.organization_id=o.id WHERE o.name='Browser delivery'");
    assert.equal((await dbGet("SELECT COUNT(*)::int AS count FROM organizations WHERE name='Browser delivery'")).count,1);
    assert.equal((await dbGet('SELECT COUNT(*)::int AS count FROM accounts WHERE organization_id=?',[delivered.id])).count,5);
    await screenshot('admin-delivery-receipt');
    await receipt.getByRole('button',{name:'继续绑定使用者'}).click();
    await page.getByRole('button',{name:'首次绑定',exact:true}).first().click();
    const binding=page.getByRole('dialog',{name:'首次绑定'});
    await binding.locator('.el-select').click();
    await page.getByRole('option',{name:'Retained person · 16600000103'}).click();
    await binding.getByRole('button',{name:'确认绑定'}).click();await binding.waitFor({state:'hidden'});
    assert.equal((await dbGet('SELECT COUNT(*)::int AS count FROM account_bindings b JOIN accounts a ON a.id=b.account_id WHERE a.organization_id=? AND b.identity_id=? AND b.ended_at IS NULL',[delivered.id,target])).count,1);
    assert.equal((await dbGet('SELECT rebind_count FROM subscriptions WHERE id=?',[delivered.subscription_id])).rebind_count,0);
    await page.getByRole('tab',{name:'组织与权益'}).click();
    await page.getByRole('row').filter({hasText:'Browser delivery'}).getByRole('button',{name:'续费一年'}).click();
    const renewal=page.getByRole('dialog',{name:'续费一年'});
    await renewal.getByRole('button',{name:'确认续费一年'}).click();await renewal.waitFor({state:'hidden'});
    const renewed=await dbGet('SELECT valid_until,rebind_count FROM subscriptions WHERE id=?',[delivered.subscription_id]);
    const {addCalendarYear}=await import('../../../src/platform/accounts/service.js');
    assert.equal(renewed.valid_until,addCalendarYear(delivered.valid_until));assert.equal(renewed.rebind_count,0);
    await screenshot('admin-delivery-workbench');

    await page.goto(base+'/admin/activities');
    await page.getByRole('button',{name:'新建活动'}).click();
    const activityDialog=page.getByRole('dialog',{name:'新建活动'});
    await activityDialog.getByLabel('活动名称').fill('Browser activity');
    const activityResponse=page.waitForResponse(response=>response.url().endsWith('/api/admin/activities') && response.request().method()==='POST');
    await activityDialog.getByRole('button',{name:'保存'}).click();
    const savedActivity=await activityResponse;
    assert.equal(savedActivity.status(),200);
    assert.ok(savedActivity.request().postDataJSON().requestId);
    await activityDialog.waitFor({state:'hidden'});
    assert.equal((await dbGet("SELECT created_by_identity_id FROM activities WHERE name='Browser activity'")).created_by_identity_id,identity);

    // Exercise the product's actual invite + re-verification dialog, not just its API.
    const invitation=await page.evaluate(async organizationId=>{
      const response=await fetch('/api/admin/invite-codes',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+localStorage.getItem('aw_token')},body:JSON.stringify({organizationId,maxUses:1,expiresInDays:7,requestId:crypto.randomUUID()})});
      return {status:response.status,body:await response.json()};
    },delivered.id);
    assert.equal(invitation.status,200);
    await page.getByRole('button',{name:'切换账号',exact:true}).click();
    await page.getByRole('button',{name:/新增组织或账号/}).click();
    await page.getByPlaceholder('请输入组织或账号邀请码').fill(invitation.body.code);
    await page.getByRole('dialog').getByLabel('当前用户密码',{exact:true}).fill(password);
    const joinedResponse=page.waitForResponse(response=>response.url().endsWith('/api/auth/join-with-invite'));
    await page.getByRole('button',{name:'验证并加入',exact:true}).click();
    assert.equal((await joinedResponse).status(),200);
    await page.getByRole('button',{name:/Browser delivery/}).waitFor();
    await screenshot('invite-joined-account-choice');
    assert.equal((await dbGet('SELECT COUNT(*)::int AS count FROM account_bindings b JOIN accounts a ON a.id=b.account_id WHERE a.organization_id=? AND b.identity_id=? AND b.ended_at IS NULL',[delivered.id,identity])).count,1);
    assert.equal((await dbGet('SELECT COUNT(*)::int AS count FROM accounts WHERE organization_id=?',[delivered.id])).count,5);
    await page.getByRole('button',{name:/Platform account/}).click();
    await page.waitForURL('**/admin/');
    await page.getByRole('button',{name:'退出',exact:true}).click();
    await page.getByPlaceholder('请输入手机号').fill(phone);
    await page.getByText('短信验证',{exact:true}).click();
    await page.getByPlaceholder('请输入短信验证码').fill('333333');
    code();await page.getByRole('button',{name:'登 录'}).click();
    await page.getByRole('button',{name:/Platform account/}).click();
    await page.waitForURL('**/admin/');

    await page.goto(base+'/enterprise/login');
    await page.waitForLoadState('networkidle');
    await page.getByPlaceholder('请输入手机号').fill(phone);
    await page.getByPlaceholder('请输入密码',{exact:true}).fill(password);
    await page.getByPlaceholder('请输入短信验证码').fill('333333');
    code();await page.getByRole('button',{name:'登 录'}).click();
    await page.getByText('选择城市级管理账号',{exact:true}).waitFor();
    await screenshot('city-account-choice');
    await page.locator('.el-select').click();
    await page.getByRole('option',{name:'City A · City A account'}).click();
    await page.getByRole('button',{name:'确认账号',exact:true}).click();
    await page.waitForURL(/\/enterprise\/?$/);
    await page.getByRole('button',{name:'切换账号'}).click();
    await page.getByRole('dialog').locator('.el-select').click();
    await page.getByRole('option',{name:'City B · City B account'}).click();
    await page.getByRole('dialog').getByRole('button',{name:'确认账号'}).click();
    await page.getByRole('dialog').waitFor({state:'hidden'});
    assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('ep_user')).accountId),accounts[2]);

    await page.goto(base+'/');
    await page.waitForLoadState('networkidle');
    if(await page.locator('#welcome-screen').isVisible()) {
      await page.locator('#welcome-screen').click();
      await page.locator('#welcome-screen').waitFor({state:'hidden'});
    }
    await page.locator('#login-btn').click();
    await page.locator('#login-phone').fill(phone);
    await page.locator('#login-form input[type="password"]').fill(password);
    await page.locator('#login-form input[autocomplete="one-time-code"]').fill('333333');
    code();await page.locator('#login-form button[type="submit"]').click();
    await page.getByRole('dialog').waitFor();
    await screenshot('public-account-choice');
    await page.getByRole('combobox',{name:'组织与账号'}).selectOption(String(accounts[3]));
    page.once('dialog',dialog=>dialog.accept());
    await page.getByRole('button',{name:'确认账号',exact:true}).click();
    await page.locator('#user-badge').waitFor({state:'visible'});
    await page.locator('#switch-account-btn').click();
    await page.getByRole('combobox',{name:'组织与账号'}).selectOption(String(accounts[1]));
    await page.getByRole('button',{name:'确认账号',exact:true}).click();
    await page.getByRole('dialog').waitFor({state:'hidden'});
    await page.waitForFunction(id=>JSON.parse(localStorage.getItem('WQT_USER_CACHE')||'null')?.accountId===id,accounts[1]);
    assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('WQT_USER_CACHE')).accountId),accounts[1]);
    assert.deepEqual(errors,[],'browser JavaScript must not fail');
    console.log('ACCOUNT_UI_PASSED');
  } finally {
    if(browser)await browser.close();
    if(runtime)await runtime.stop();
    const redis=createClient({url:process.env.REDIS_URL,socket:{reconnectStrategy:false}});
    redis.on('error',()=>{});
    try {await redis.connect();if(keys.length)await redis.del(keys);} finally {if(redis.isOpen)redis.destroy();}
  }
}
