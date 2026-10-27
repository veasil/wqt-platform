import assert from 'node:assert/strict';
import {test} from 'node:test';
import {runNodeScript,createOwnedDatabase,dropOwnedDatabase,getTestPgAdminUrl} from '../helpers/runtime-test-env.mjs';

const env={CAPTCHA_ENABLED:'true',CAPTCHA_PROVIDER:'aliyun',ALIYUN_CAPTCHA_REGION:'cn',
  ALIYUN_CAPTCHA_PREFIX:'synthetic-prefix',ALIYUN_CAPTCHA_SCENE_ID:'server-scene',
  ALIYUN_CAPTCHA_ACCESS_KEY_ID:'synthetic-secret-id',ALIYUN_CAPTCHA_ACCESS_KEY_SECRET:'synthetic-secret-key'};

test('Aliyun proof gates password and SMS flows through owned PostgreSQL and Redis',{
 skip:!getTestPgAdminUrl()||!process.env.WQT_TEST_REDIS_URL,
},async()=>{
 const owned=await createOwnedDatabase();
 try{
  const result=await runNodeScript(`
   import assert from 'node:assert/strict';import {mock} from 'node:test';
   import sdk from '@alicloud/captcha20230305';import bcrypt from 'bcryptjs';
   let providerCalls=0;
   mock.method(sdk.default.prototype,'verifyIntelligentCaptchaWithOptions',async(request)=>{
    providerCalls++;const valid=request.captchaVerifyParam==='synthetic-valid-proof';
    assert.equal(request.sceneId,'server-scene');
    return {body:{success:true,result:{verifyResult:valid,verifyCode:valid?'T001':'F001'}}};
   });
   const {startRuntime}=await import('./src/runtime.js');const {dbRun}=await import('./src/db.js');
   let comparisons=0;const compare=bcrypt.compare;
   bcrypt.compare=(...args)=>{comparisons++;return compare(...args)};
   const runtime=await startRuntime({port:0,host:'127.0.0.1'});
   try{
    const phone='16600000938',password='SyntheticAliyunPassword!';
    const identity=(await dbRun('INSERT INTO identities(phone,password_hash,guardian_name,created_at) VALUES(?,?,?,?)',[phone,bcrypt.hashSync(password,10),'Synthetic Aliyun',Date.now()])).lastID;
    const org=(await dbRun("INSERT INTO organizations(name,owner_user_id) VALUES('Synthetic Aliyun',0)")).lastID;
    const account=(await dbRun("INSERT INTO accounts(organization_id,name,role,created_at) VALUES(?,'Synthetic Aliyun','boss',?)",[org,Date.now()])).lastID;
    await dbRun('INSERT INTO account_bindings(account_id,identity_id,started_at) VALUES(?,?,?)',[account,identity,Date.now()]);
    const base='http://127.0.0.1:'+runtime.server.address().port;
    const post=async(path,body)=>{const r=await fetch(base+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});return {status:r.status,body:await r.json()}};
    const input={phone,password,verificationMethod:'password'},proof={captchaVerifyParam:'synthetic-valid-proof'};
    for(const path of ['/api/auth/login','/api/auth/admin-login']){
     const before=comparisons;
     assert.equal((await post(path,input)).status,400);
     assert.equal((await post(path,{...input,captchaVerifyParam:'synthetic-invalid'})).status,400);
     assert.equal(comparisons,before);
     assert.equal((await post(path,{...input,...proof,password:'wrong'})).status,401);
     const login=await post(path,{...input,...proof});assert.equal(login.status,200);assert.equal(login.body.user.role,'boss');
     assert.equal(comparisons,before+2);
    }
    assert.equal((await post('/api/auth/sms/send',{phone,captchaVerifyParam:'synthetic-invalid'})).status,400);
    const sent=await post('/api/auth/sms/send',{phone,...proof});assert.equal(sent.status,200);
    assert.equal(typeof sent.body.mockCode,'string','Only isolated mock SMS is used');
    const calls=providerCalls,before=comparisons;
    assert.equal((await post('/api/auth/login',{phone,code:sent.body.mockCode,verificationMethod:'sms'})).status,200);
    assert.equal(providerCalls,calls,'SMS login must not reuse its send proof');assert.equal(comparisons,before);
    console.log('ALIYUN_PG_AUTH_PASS');
   }finally{bcrypt.compare=compare;await runtime.stop()}
  `,{env:{...env,WQT_RUNTIME_TEST_CHILD:'1',WQT_ACCOUNT_MODEL:'accounts',DATABASE_URL:owned.connectionString,
    CARDS_DATABASE_URL:owned.connectionString,CARDS_SOURCE:'postgres',JWT_SECRET:'synthetic-aliyun-test-secret',
    REDIS_URL:process.env.WQT_TEST_REDIS_URL,WQT_REDIS_NAMESPACE:owned.database},timeoutMs:60000});
  assert.equal(result.code,0,result.stderr+'\n'+result.stdout);assert.match(result.stdout,/ALIYUN_PG_AUTH_PASS/);
 }finally{await dropOwnedDatabase(owned)}
});

test('Aliyun verifies opaque proof once, pins server scene and endpoint, and rejects fallback/test/errors',async()=>{
 const result=await runNodeScript(`
  import assert from 'node:assert/strict';
  import {mock} from 'node:test';
  import sdk from '@alicloud/captcha20230305';
  import {verifyCaptcha} from './src/services/captcha.js';
  let next={body:{success:true,code:'Success',result:{verifyResult:true,verifyCode:'T001'}}};
  const calls=[],logs=[];
  mock.method(console,'error',(...args)=>logs.push(args.join(' ')));
  mock.method(sdk.default.prototype,'verifyIntelligentCaptchaWithOptions',async function(request,runtime){
    calls.push({request,runtime,endpoint:this._endpoint});
    if(next instanceof Error)throw next;
    return next;
  });
  assert.equal((await verifyCaptcha({ticket:'old-provider-ticket',randstr:'random'})).ok,false);
  for(const input of [null,{},'', 'x'.repeat(65537)])
    assert.equal((await verifyCaptcha({captchaVerifyParam:input})).ok,false);
  assert.equal(calls.length,0);
  const token='opaque-token-preserved-exactly==';
  assert.equal((await verifyCaptcha({captchaVerifyParam:token,sceneId:'attacker-scene'})).ok,true);
  assert.equal(calls[0].request.captchaVerifyParam,token);
  assert.equal(calls[0].request.sceneId,'server-scene');
  assert.equal(calls[0].endpoint,'captcha.cn-shanghai.aliyuncs.com');
  assert.equal(calls[0].runtime.autoretry,false);assert.equal(calls[0].runtime.maxAttempts,1);
  for(const response of [
    undefined,{}, {body:{success:false}}, {body:{success:true,result:{verifyResult:'true',verifyCode:'T001'}}},
    ...['T002','T005','F001','F008','F012','F018','F019'].map(code=>({body:{success:true,result:{verifyResult:code.startsWith('T'),verifyCode:code},requestId:'safe-request-id'}})),
  ]){next=response;assert.equal((await verifyCaptcha({captchaVerifyParam:token})).ok,false);}
  next=Object.assign(new Error('signed request contains secret and '+token),{code:'Forbidden.AccountAccessDenied',data:{RequestId:'safe-request-id'}});
  const before=calls.length;assert.equal((await verifyCaptcha({captchaVerifyParam:token})).ok,false);
  assert.equal(calls.length,before+1,'provider exception must not replay single-use token');
  assert.ok(logs.some(line=>line.includes('Forbidden.AccountAccessDenied')));
  assert.ok(logs.some(line=>line.includes('safe-request-id')));
  assert.ok(logs.every(line=>!line.includes(token)&&!line.includes('synthetic-secret')&&!line.includes('signed request')));
  process.env.ALIYUN_CAPTCHA_REGION='sgp';
  next={body:{success:true,result:{verifyResult:true,verifyCode:'T001'}}};
  assert.equal((await verifyCaptcha({captchaVerifyParam:token})).ok,true);
  assert.equal(calls.at(-1).endpoint,'captcha.ap-southeast-1.aliyuncs.com');
  process.env.CAPTCHA_PROVIDER='unknown';const count=calls.length;
  assert.equal((await verifyCaptcha({captchaVerifyParam:token})).ok,false);assert.equal(calls.length,count);
  process.env.CAPTCHA_PROVIDER='aliyun';delete process.env.ALIYUN_CAPTCHA_ACCESS_KEY_SECRET;
  assert.equal((await verifyCaptcha({captchaVerifyParam:token})).ok,false);assert.equal(calls.length,count);
  console.log('ALIYUN_PROVIDER_PASS');
 `,{env});
 assert.equal(result.code,0,result.stderr+'\n'+result.stdout);assert.match(result.stdout,/ALIYUN_PROVIDER_PASS/);
});

test('Aliyun public config, CSP and real login/SMS routes remain fail-closed without starting a database',async()=>{
 const result=await runNodeScript(`
  import assert from 'node:assert/strict';import {mock} from 'node:test';
  import sdk from '@alicloud/captcha20230305';
  import {createApp} from './src/app.js';
  import {aliyunCaptchaCsp} from './src/services/captcha-config.js';
  const calls=[];
  mock.method(console,'error',()=>{});
  mock.method(sdk.default.prototype,'verifyIntelligentCaptchaWithOptions',async(request)=>{
    calls.push(request);return {body:{success:true,result:{verifyResult:false,verifyCode:'F001'}}};
  });
  const server=createApp().listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  try{
    const base='http://127.0.0.1:'+server.address().port;
    const response=await fetch(base+'/api/auth/verification-options');const data=await response.json();
    assert.equal(response.headers.get('cache-control'),'no-store');
    assert.equal(data.captchaProvider,'aliyun');assert.equal(data.captchaRegion,'cn');
    assert.equal(data.captchaPrefix,'synthetic-prefix');assert.equal(data.captchaSceneId,'server-scene');
    assert.equal(data.captchaAppId,null);assert.ok(!JSON.stringify(data).includes('synthetic-secret'));
    assert.ok(!Object.keys(data).some(key=>/secret|accesskey/i.test(key)));
    const csp=response.headers.get('content-security-policy');
    assert.ok(csp.includes('https://o.alicdn.com'));
    assert.ok(csp.includes('https://synthetic-prefix.captcha-open.aliyuncs.com'));
    assert.ok(csp.includes('https://cloudauth-device-dualstack.cn-shanghai.aliyuncs.com'));
    assert.ok(csp.includes("font-src 'self' https://fonts.gstatic.com data:"));
    assert.ok(csp.includes("style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://o.alicdn.com https://g.alicdn.com"));
    assert.ok(!csp.includes('unsafe-eval'));assert.ok(!csp.includes('https://*'));
    const token='opaque-route-proof==';
    for(const path of ['/api/auth/login','/api/auth/admin-login','/api/auth/sms/send']){
      const post=body=>fetch(base+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
      const input={phone:'16600000888',password:'synthetic',verificationMethod:'password'};
      const before=calls.length;assert.equal((await post(input)).status,400);assert.equal(calls.length,before);
      const rejected=await post({...input,captchaVerifyParam:token});assert.equal(rejected.status,400);
      assert.equal(calls.length,before+1);assert.equal(calls.at(-1).captchaVerifyParam,token);
      assert.match((await rejected.json()).error,/人机验证/);
    }
    assert.equal(aliyunCaptchaCsp({...process.env,ALIYUN_CAPTCHA_PREFIX:'invalid.example/'}).connect.length,0);
    assert.equal(aliyunCaptchaCsp({...process.env,CAPTCHA_PROVIDER:'tencent'}).scripts.length,0);
    console.log('ALIYUN_ROUTES_PASS');
  }finally{await new Promise(resolve=>server.close(resolve));}
 `,{env:{...env,WQT_ACCOUNT_MODEL:'accounts'}});
 assert.equal(result.code,0,result.stderr+'\n'+result.stdout);assert.match(result.stdout,/ALIYUN_ROUTES_PASS/);
});

test('Aliyun official SDK serializes the API fields and a stalled request is bounded without retry',async()=>{
 const result=await runNodeScript(`
  import assert from 'node:assert/strict';import {mock} from 'node:test';
  import sdk from '@alicloud/captcha20230305';
  import {verifyAliyunCaptcha} from './src/services/aliyun-captcha.js';
  let calls=0,hold=false;
  mock.method(console,'error',()=>{});
  mock.method(sdk.default.prototype,'callApi',async function(params,request,runtime){
    calls++;assert.equal(params.action,'VerifyIntelligentCaptcha');assert.equal(params.method,'POST');
    assert.equal(params.protocol,'HTTPS');assert.equal(request.body.SceneId,'server-scene');
    assert.equal(request.body.CaptchaVerifyParam,'wire-token==');assert.equal(runtime.autoretry,false);
    if(hold)return new Promise(()=>{});
    return {statusCode:200,headers:{},body:{Success:true,Code:'Success',Result:{VerifyResult:true,VerifyCode:'T001'}}};
  });
  assert.equal((await verifyAliyunCaptcha('wire-token==')).ok,true);
  hold=true;mock.timers.enable({apis:['setTimeout']});
  const pending=verifyAliyunCaptcha('wire-token==');
  mock.timers.tick(8000);
  assert.equal((await pending).ok,false);assert.equal(calls,2);mock.timers.reset();
  console.log('ALIYUN_SDK_WIRE_PASS');
 `,{env});
 assert.equal(result.code,0,result.stderr+'\n'+result.stdout);assert.match(result.stdout,/ALIYUN_SDK_WIRE_PASS/);
});
