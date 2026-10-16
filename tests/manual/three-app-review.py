"""Three-app authenticated walkthrough with a QA-only session fixture in owned UAT.

This does not solve captcha or authenticate the user's review identity.
"""
from pathlib import Path
import json, subprocess
from playwright.sync_api import sync_playwright
BASE='http://127.0.0.1:8188'
OUT=Path('C:/ArdenDev/tmp/wqt-three-app-review');OUT.mkdir(parents=True,exist_ok=True)
source=r'''
import fs from 'node:fs';import dotenv from 'dotenv';import pg from 'pg';import jwt from 'jsonwebtoken';import {randomUUID} from 'node:crypto';import {createClient} from 'redis';import {provisionUatReviewer} from './tests/helpers/uat-reviewer.mjs';
await (await fetch('http://127.0.0.1:8188/api/public/brand-resource')).json();
const local=dotenv.parse(fs.readFileSync('.env'));
const adminUrl='postgres://wqt_test:local_synthetic_only@127.0.0.1:55447/postgres',admin=new pg.Client({connectionString:adminUrl});await admin.connect();
const names=(await admin.query("SELECT datname FROM pg_database WHERE datname ~ '^wqt_r1_[a-f0-9]{20}$' AND datname IN(SELECT datname FROM pg_stat_activity WHERE pid<>pg_backend_pid())")).rows;await admin.end();
if(names.length!==1)throw new Error('Ambiguous owned UAT database');
const database=names[0].datname,url=new URL(adminUrl);url.pathname='/'+database;
const db=new pg.Client({connectionString:url.href});await db.connect();
try{
 const qa=await provisionUatReviewer(db,{phone:'16600000889',password:'PlayerUat2026!'});
 const again=await provisionUatReviewer(db,{phone:'16600000889',password:'PlayerUat2026!'});
 if(JSON.stringify(qa)!==JSON.stringify(again))throw new Error('Fixture not idempotent');
 const reviewer=(await db.query('SELECT a.role,s.plan FROM identities i JOIN account_bindings b ON b.identity_id=i.id AND b.ended_at IS NULL JOIN accounts a ON a.id=b.account_id LEFT JOIN subscriptions s ON s.id=a.subscription_id WHERE i.phone=$1',[local.WQT_UAT_REVIEW_PHONE])).rows;
 if(!reviewer.some(a=>a.role==='boss')||!reviewer.some(a=>a.role==='enterprise'&&a.plan==='city')||!reviewer.some(a=>a.role==='watcher'))throw new Error('Reviewer permissions incomplete');
 const identity=(await db.query("SELECT id,credential_version FROM identities WHERE phone='16600000889'")).rows[0];
 const now=Date.now(),session={jti:randomUUID(),createdAt:now,credentialVersion:Number(identity.credential_version),expiresAt:now+86400000};
 const redis=createClient({url:'redis://127.0.0.1:56347'});await redis.connect();try{await redis.set(database+':identity-session:'+identity.id,JSON.stringify(session),{PXAT:session.expiresAt})}finally{await redis.quit()}
 const token=jwt.sign({type:'identity',identityId:Number(identity.id),accountId:Number(qa.accounts.watcher),credentialVersion:Number(identity.credential_version),jti:session.jti,env:'prod',exp:Math.floor(session.expiresAt/1000)},'local-player-uat-synthetic-secret');
 process.stdout.write(JSON.stringify({token,watcher:Number(qa.accounts.watcher),boss:Number(qa.accounts.boss),enterprise:Number(qa.accounts.enterprise)}));
}finally{await db.end()}
'''
result=subprocess.run(['node','--input-type=module','-e',source],capture_output=True,text=True,encoding='utf-8',check=True)
fixture=json.loads(result.stdout)
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True);context=browser.new_context(viewport={'width':1440,'height':1000})
 player=context.new_page();player.goto(BASE+'/player/');player.evaluate('(token)=>localStorage.setItem("WQT_AUTH_TOKEN",token)',fixture['token']);player.reload();player.locator('#code-form').wait_for()
 def session(token):
  response=context.request.get(BASE+'/api/auth/session',headers={'Authorization':'Bearer '+token});assert response.ok,response.status;return response.json()
 original=session(fixture['token'])['session']
 admin=context.new_page();admin.goto(BASE+'/admin/login');admin.get_by_role('button',name='使用当前登录身份继续').click();admin.locator('.account-option').filter(has_text='自动验证城市组织 · 平台管理验收账号').click();admin.get_by_role('heading',name='驾驶舱',exact=True).wait_for(timeout=10000)
 organization=context.new_page();organization.goto(BASE+'/enterprise/login');organization.get_by_role('button',name='使用当前登录身份继续').click();organization.locator('.el-select__wrapper').click();organization.get_by_role('option').filter(has_text='城市级组织管理验收账号').click();organization.get_by_role('button',name='确认账号',exact=True).click();organization.get_by_role('heading',name='驾驶舱').wait_for()
 for page,key,role in [(player,'WQT_AUTH_TOKEN','watcher'),(admin,'aw_token','boss'),(organization,'ep_token','enterprise')]:
  token=page.evaluate('(key)=>localStorage.getItem(key)',key);data=session(token);assert data['session']==original;assert data['user']['role']==role
  endpoint='/api/enterprise/dashboard' if role=='enterprise' else '/api/admin/stats/overview' if role=='boss' else '/api/me'
  response=context.request.get(BASE+endpoint,headers={'Authorization':'Bearer '+token});assert response.ok,(role,response.status)
  page.screenshot(path=str(OUT/(role+'.png')),full_page=True)
 for page in [player,admin,organization]:page.reload();page.wait_for_load_state('networkidle')
 assert player.locator('#code-form').count()==1
 assert '/login' not in admin.url and '/login' not in organization.url
 browser.close();print('THREE_APP_REVIEW_PASS: reviewer permissions, one fixed session, account isolation, protected APIs, reload')
