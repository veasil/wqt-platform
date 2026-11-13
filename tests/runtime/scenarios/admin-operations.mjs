import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import bcrypt from 'bcryptjs';
import {createClient} from 'redis';
import {startRuntime} from '../../../src/runtime.js';
import {dbRun,dbGet} from '../../../src/db.js';
import {smsStore} from '../../../src/services/sms.js';
import {decryptVal} from '../../../src/config.js';
if(process.env.WQT_RUNTIME_TEST_CHILD!=='1' || !process.env.WQT_REDIS_NAMESPACE?.startsWith('wqt_r1_')) throw new Error('Owned test PG/Redis required');
export async function run() {
  let runtime;const ids=[];
  try {
    runtime=await startRuntime({port:0,host:'127.0.0.1'});const base=`http://127.0.0.1:${runtime.server.address().port}`,now=Date.now(),password='OperationsTest!';
    for(const phone of ['16600000801','16600000802']) ids.push((await dbRun('INSERT INTO identities(phone,password_hash,guardian_name,real_name,created_at) VALUES(?,?,?,?,?)',[phone,bcrypt.hashSync(password,10),phone,'测试用户',now])).lastID);
    const accountIds=[];
    const platformOrg=(await dbRun("INSERT INTO organizations(name,owner_user_id) VALUES('平台运营',0)")).lastID;
    for(const [name,role,identity] of [['平台','boss',ids[0]],['普通','watcher',ids[0]],['免费','watcher',ids[1]]]) {
      const id=(await dbRun('INSERT INTO accounts(organization_id,name,role,created_at) VALUES(?,?,?,?)',[role==='boss'?platformOrg:0,name,role,now])).lastID;
      await dbRun('INSERT INTO account_bindings(account_id,identity_id,started_at) VALUES(?,?,?)',[id,identity,now]);accountIds.push(id);
    }
    async function request(path,token,body,method=body ? 'POST':'GET') {
      const r=await fetch(base+path,{method,headers:{'content-type':'application/json',...(token ? {authorization:`Bearer ${token}`}:{})},body:body ? JSON.stringify(body):undefined});return {status:r.status,body:await r.json()};
    }
    async function login(phone) {smsStore.set(phone,{code:'333333',expiresAt:Date.now()+300000});const r=await request('/api/auth/login',null,{phone,password,code:'333333'});assert.equal(r.status,200);return r.body.token}
    const identityToken=await login('16600000801');
    let boss=(await request('/api/auth/select-account',identityToken,{accountId:accountIds[0]})).body.token;
    const ordinary=(await request('/api/auth/select-account',identityToken,{accountId:accountIds[1]})).body.token;
    assert.equal((await request('/api/admin/operations-snapshot',ordinary)).status,403,'union of user roles never grants a watcher token admin powers');
    const trial={requestId:randomUUID(),accountId:accountIds[2],reason:'运营核验开启'};
    assert.equal((await request('/api/admin/trials/activate',ordinary,trial)).status,403);
    const grants=await Promise.all([request('/api/admin/trials/activate',boss,trial),request('/api/admin/trials/activate',boss,trial)]);
    assert.equal(grants[0].status,200);assert.deepEqual(grants[0],grants[1]);
    const person=await dbGet('SELECT trial_started_at,trial_until,trial_activated_at,trial_granted_at FROM identities WHERE id=?',[ids[1]]);
    assert.equal(person.trial_until,null);assert.equal(person.trial_started_at,null);assert.equal(person.trial_activated_at,null);assert.ok(person.trial_granted_at);
    const freeToken=await login('16600000802');
    const rights=await request('/api/me/entitlements',freeToken);assert.equal(rights.body.experience.status,'pending_activation');assert.equal(rights.body.capabilities.startGame,false);
    const activation={requestId:randomUUID()};const activations=await Promise.all([request('/api/me/trial/activate',freeToken,activation),request('/api/me/trial/activate',freeToken,{requestId:randomUUID()})]);assert.deepEqual(activations.map(r=>r.status).sort(),[200,409]);
    const successful=activations.find(r=>r.status===200),active=await dbGet('SELECT * FROM identities WHERE id=?',[ids[1]]);assert.equal(active.trial_until-active.trial_started_at,30*86400000);assert.equal(active.trial_grant_consumed_at,active.trial_granted_at);assert.equal(active.trial_activated_at,active.trial_started_at);
    const winner=activations[0].status===200?activation:null;if(winner)assert.deepEqual((await request('/api/me/trial/activate',freeToken,winner)).body,successful.body);
    assert.equal((await request('/api/me/entitlements',freeToken)).body.capabilities.startGame,true);

    assert.equal((await request('/api/admin/trials/activate',boss,{...trial,requestId:randomUUID()})).status,409);
    assert.equal((await dbGet("SELECT COUNT(*)::int AS count FROM account_operations WHERE operation='grant-trial'")).count,1);
    const delivery=await request('/api/admin/subscriptions',boss,{requestId:randomUUID(),organizationName:'运营组织',location:'上海市浦东新区',plan:'group'});assert.equal(delivery.status,200);
    const organizationId=delivery.body.organizationId;
    let detail=await request(`/api/admin/organizations/${organizationId}`,boss);assert.equal(detail.body.organization.location,'上海市浦东新区');assert.equal(detail.body.organization.user_count,0);
    const changed=await request('/api/admin/organizations/update-info',boss,{requestId:randomUUID(),organizationId,name:'运营组织',location:'北京市海淀区',description:'运营测试'});assert.equal(changed.status,200);
    detail=await request(`/api/admin/organizations/${organizationId}`,boss);assert.equal(detail.body.organization.location,'北京市海淀区');
    const inviteInput={requestId:randomUUID(),organizationId,maxUses:2,expiresInDays:7};
    const invite=await request('/api/admin/invite-codes',boss,inviteInput);assert.equal(invite.status,200);
    assert.deepEqual(await request('/api/admin/invite-codes',boss,inviteInput),invite);
    assert.equal((await request('/api/admin/invite-codes',boss,{...inviteInput,requestId:randomUUID(),maxUses:6})).status,400);
    smsStore.set('16600000802',{code:'333333',expiresAt:Date.now()+300000});
    const joined=await request('/api/auth/register-with-invite',null,{requestId:randomUUID(),phone:'16600000802',password,smsCode:'333333',code:invite.body.code});assert.equal(joined.status,200);assert.equal(joined.body.identityId,ids[1]);assert.equal(joined.body.user.enterpriseId,organizationId);
    const passwordLogin=await request('/api/auth/admin-login',null,{phone:'16600000801',password,verificationMethod:'password'});assert.equal(passwordLogin.status,200,'platform password login needs no SMS');
    // Restore the original selected account on the new session for all remaining checks.
    boss=(await request('/api/auth/select-account',passwordLogin.body.token,{accountId:accountIds[0]})).body.token;
    assert.equal((await request('/api/auth/login',null,{phone:'16600000802',password:'wrong',verificationMethod:'password'})).status,401);
    smsStore.set('16600000802',{code:'444444',expiresAt:Date.now()+300000});
    const smsLogin=await request('/api/auth/login',null,{phone:'16600000802',code:'444444',verificationMethod:'sms'});assert.equal(smsLogin.status,200,'SMS login needs no password');
    assert.equal((await request('/api/auth/login',null,{phone:'16600000802',code:'444444',verificationMethod:'sms'})).status,400,'SMS proof is consumed');
    const joinInput={inviteCode:invite.body.code,requestId:randomUUID(),password,verificationMethod:'password'};
    const extra=await request('/api/auth/join-with-invite',smsLogin.body.token,joinInput);assert.equal(extra.status,409,'one person cannot allocate another account in the same organization');
    assert.equal((await request('/api/auth/join-with-invite',smsLogin.body.token,{...joinInput,password:'wrong'})).status,401,'request replay still verifies person');
    assert.deepEqual(await request('/api/auth/join-with-invite',smsLogin.body.token,joinInput),extra,'duplicate organization binding remains rejected');
    assert.equal((await dbGet('SELECT used_count FROM invite_codes WHERE code=?',[invite.body.code])).used_count,1,'rejected binding never consumes another invitation use');
    assert.equal((await request('/api/auth/join-with-invite',smsLogin.body.token,{...joinInput,requestId:randomUUID(),verificationMethod:'wechat'})).status,503);
    const freeCode=await request('/api/admin/invite-codes',boss,{requestId:randomUUID(),organizationId:0,maxUses:1,expiresInDays:7});assert.equal(freeCode.status,200);
    const freeCodes=await request('/api/admin/invite-codes?organizationId=0',boss);assert.ok(freeCodes.body.codes.every(c=>c.organization_id===0));
    let snapshot=(await request('/api/admin/operations-snapshot',boss)).body;
    smsStore.set('16600000802',{code:'555555',expiresAt:Date.now()+300000});
    const smsJoined=await request('/api/auth/join-with-invite',smsLogin.body.token,{inviteCode:freeCode.body.code,requestId:randomUUID(),verificationMethod:'sms',code:'555555'});assert.equal(smsJoined.status,409,'SMS proof cannot create a second free-organization binding');
    assert.equal((await dbGet('SELECT used_count FROM invite_codes WHERE code=?',[freeCode.body.code])).used_count,0);
    assert.equal((await request('/api/auth/accounts',smsLogin.body.token)).status,200,'joining preserves the login session');
    snapshot=(await request('/api/admin/operations-snapshot',boss)).body;
    const user=snapshot.users.find(u=>u.id===ids[1]);assert.equal(user.accounts.length,2);assert.ok(user.categories.includes('trial') && user.categories.includes('entitled'));
    assert.equal(snapshot.stats.totalUsers,2);assert.equal(snapshot.stats.onlineUsers,2);assert.equal(snapshot.stats.entitledOrganizations,1);
    detail=await request(`/api/admin/organizations/${organizationId}`,boss);assert.equal(detail.body.organization.user_count,1);assert.equal(detail.body.organization.online_users,1);
    const revoke={requestId:randomUUID(),identityId:ids[1]};assert.equal((await request('/api/admin/identities/revoke-session',boss,revoke)).status,200);assert.equal((await request('/api/auth/accounts',smsLogin.body.token)).status,401);
    const freshIdentity=await login('16600000802');
    const fresh=(await request('/api/auth/select-account',freshIdentity,{accountId:joined.body.accountId})).body.token;
    assert.equal((await request('/api/admin/identities/revoke-session',boss,revoke)).status,200);assert.equal((await request('/api/me',fresh)).status,200,'replay does not revoke a newer login');
    const audit=await request('/api/admin/account-operations',boss);assert.equal(audit.body.operations.find(o=>o.operation==='revoke-session').result_json,null);
    const setting={requestId:randomUUID(),key:'OPERATIONS_TEST_KEY',value:'synthetic-secret',description:'测试配置'};
    const currentOrdinary=(await request('/api/auth/select-account',passwordLogin.body.token,{accountId:accountIds[1]})).body.token;
    assert.equal((await request('/api/admin/settings',currentOrdinary)).status,403);
    assert.equal((await request('/api/admin/settings',boss,{...setting,key:'JWT_SECRET'},'PUT')).status,400);
    assert.equal((await request('/api/admin/settings',boss,{...setting,key:'CAPTCHA_ENABLED'},'PUT')).status,400,'human verification configuration is deployed via environment');
    assert.equal((await request('/api/admin/settings',boss,setting,'PUT')).status,200);
    const stored=(await dbGet('SELECT value FROM system_settings WHERE key=?',[setting.key])).value;assert.ok(stored.startsWith('enc:'));assert.equal(decryptVal(stored),setting.value);
    let settings=(await request('/api/admin/settings',boss)).body.settings;assert.equal(settings.find(s=>s.key===setting.key).value,null);
    assert.equal((await request('/api/admin/settings',boss,{...setting,requestId:randomUUID(),value:'',keepExisting:true},'PUT')).status,200);assert.equal((await dbGet('SELECT value FROM system_settings WHERE key=?',[setting.key])).value,stored);
    assert.equal((await request('/api/admin/identities/update-profile',boss,{requestId:randomUUID(),identityId:ids[1],guardianName:'保留资料',realName:'用户甲'})).status,200);
    await dbRun('UPDATE identities SET credential_version=credential_version+1 WHERE id=?',[ids[1]]);
    snapshot=(await request('/api/admin/operations-snapshot',boss)).body;assert.equal(snapshot.stats.onlineUsers,1,'invalid credential versions never inflate online count');
    const limiter=createClient({url:process.env.REDIS_URL});await limiter.connect();
    try {await limiter.set(`${process.env.WQT_REDIS_NAMESPACE}:identity-session:${ids[0]}:proof-attempts`,'30',{PX:900000});assert.equal((await request('/api/auth/admin-login',null,{phone:'16600000801',password,verificationMethod:'password'})).status,429,'verification is bounded without SMS send quotas')} finally {await limiter.quit()}
    console.log('ADMIN_OPERATIONS_PASSED');
  } finally {
    if(runtime) await runtime.stop();
    const redis=createClient({url:process.env.REDIS_URL,socket:{reconnectStrategy:false}});redis.on('error',()=>{});
    try {await redis.connect();if(ids.length) await redis.del(ids.flatMap(id=>[`${process.env.WQT_REDIS_NAMESPACE}:identity-session:${id}`,`${process.env.WQT_REDIS_NAMESPACE}:identity-session:${id}:proof-attempts`]))} finally {if(redis.isOpen) redis.destroy()}
  }
}
