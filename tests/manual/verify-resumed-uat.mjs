// Read-only HTTP checks using the existing synthetic reviewer session. Never logs tokens or PII.
import pg from 'pg';
import {createClient} from 'redis';
import jwt from 'jsonwebtoken';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const url=new URL(process.env.WQT_MIGRATION_DATABASE_URL || 'invalid:');
const namespace=url.pathname.slice(1);
if(url.hostname!=='127.0.0.1' || url.port!=='55447' || !/^wqt_r1_[a-f0-9]{20}$/.test(namespace) || process.env.WQT_TEST_REDIS_URL!=='redis://127.0.0.1:56347') throw new Error('Explicit dedicated owned UAT services required');
const db=new pg.Client({connectionString:url.toString()});
const redis=createClient({url:process.env.WQT_TEST_REDIS_URL});
await db.connect();await redis.connect();
try {
  assert.equal((await db.query('SELECT phone FROM identities WHERE id=2')).rows[0].phone,'16600000889');
  const record=JSON.parse(await redis.get(`${namespace}:identity-session:2`));
  assert.ok(record?.expiresAt>Date.now(),'Existing synthetic session required; this check never logs in or replaces a session');
  const identity=(await db.query('SELECT credential_version FROM identities WHERE id=2')).rows[0];
  const token=accountId=>jwt.sign({type:'identity',identityId:2,accountId,jti:record.jti,credentialVersion:Number(identity.credential_version),env:'prod',exp:Math.floor(record.expiresAt/1000)},'local-player-uat-synthetic-secret');
  const checks=[];
  async function check(path,accountId,status,verify){
    const response=await fetch('http://127.0.0.1:8188'+path,{headers:{Authorization:'Bearer '+token(accountId)}});
    const data=await response.json();assert.equal(response.status,status,path);verify?.(data);checks.push({path,status});
  }
  await check('/api/auth/session',30,200,data=>{
    assert.equal(data.user.accountId,30);assert.ok(!data.accounts.some(account=>[31,50].includes(account.id)));
  });
  await check('/api/cards/study',30,200);
  await check('/api/cards/study',6,403,data=>assert.equal(data.code,'PAID_ENTITLEMENT_REQUIRED'));
  await check('/api/cards/study',31,403,data=>assert.equal(data.code,'ACCOUNT_UNAVAILABLE'));
  await check('/api/auth/activity-account/WQTUAT',30,409,data=>assert.equal(data.code,'ACTIVITY_ORGANIZATION_REQUIRED'));
  await check('/api/auth/activity-account/WQTCITY',30,200,data=>assert.equal(data.accounts.length,0));
  await check('/api/auth/activity-account/WQTSOCIAL',30,200,data=>assert.deepEqual(data.accounts.map(account=>account.id),[30]));
  await check('/api/admin/operations-snapshot',29,200,data=>assert.ok(data.organizations.some(org=>org.name==='暖禾社工室（虚构）')));
  await check('/api/game/session/1',30,404); // A city admin cannot read another organization's history.
  for(const path of ['/player/','/admin/','/enterprise/']){
    const response=await fetch('http://127.0.0.1:8188'+path);assert.equal(response.status,200);checks.push({path,status:response.status});
  }
  await db.query('BEGIN');
  try {
    await assert.rejects(db.query('UPDATE account_bindings SET ended_at=NULL WHERE id=14'),error=>error.code==='23505' && error.constraint==='account_bindings_one_identity_per_organization');
  }finally{await db.query('ROLLBACK');}
  const browser=await chromium.launch({headless:true});
  try {
    const context=await browser.newContext();
    await context.addInitScript(value=>localStorage.setItem('WQT_AUTH_TOKEN',value),token(30));
    const page=await context.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto('http://127.0.0.1:8188/player/');
    await page.locator('#code-form').waitFor();
    await page.locator('#nav-me').click();
    await page.locator('#account-content[data-ready="true"]').waitFor();
    assert.ok(await page.getByRole('button',{name:'切换账号',exact:true}).isVisible());
    assert.deepEqual(errors,[]);
  }finally{await browser.close();}
  console.log(JSON.stringify({realHttp:true,realBrowser:true,preservedSyntheticSession:true,guardRejectsReactivation:true,checks}));
}finally{await redis.quit();await db.end();}
