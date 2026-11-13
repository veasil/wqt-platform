import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createOwnedDatabase,dropOwnedDatabase,getTestPgAdminUrl,runNodeScript} from '../helpers/runtime-test-env.mjs';

test('password login requires provider validation before password checks, including admin login', {skip:!getTestPgAdminUrl() || !process.env.WQT_TEST_REDIS_URL},async()=>{
 const owned=await createOwnedDatabase();
 try{
  const result=await runNodeScript(`
   import assert from 'node:assert/strict';
   import {mock} from 'node:test';
   let providerCalls=0;
   mock.module('node-fetch',{defaultExport:async(_url,options)=>{
    providerCalls++;const body=JSON.parse(options.body);
    return {json:async()=>({Response:{CaptchaCode:body.Ticket==='synthetic-valid-ticket'?1:15}})};
   }});
   const {startRuntime}=await import('./src/runtime.js');
   const {dbRun}=await import('./src/db.js');
   const {default:bcrypt}=await import('bcryptjs');
   const {smsStore}=await import('./src/services/sms.js');
   let comparisons=0;const compare=bcrypt.compare;
   bcrypt.compare=(...args)=>{comparisons++;return compare(...args)};
   const runtime=await startRuntime({port:0,host:'127.0.0.1'});
   try{
    const phone='16600000931',password='SyntheticCaptchaOnly!';
    const identity=(await dbRun('INSERT INTO identities(phone,password_hash,guardian_name,created_at) VALUES(?,?,?,?)',[phone,bcrypt.hashSync(password,10),'Captcha fixture',Date.now()])).lastID;
    const org=(await dbRun("INSERT INTO organizations(name,owner_user_id) VALUES('Captcha fixture',0)")).lastID;
    const account=(await dbRun("INSERT INTO accounts(organization_id,name,role,created_at) VALUES(?,'Captcha fixture','boss',?)",[org,Date.now()])).lastID;
    await dbRun('INSERT INTO account_bindings(account_id,identity_id,started_at) VALUES(?,?,?)',[account,identity,Date.now()]);
    const base='http://127.0.0.1:'+runtime.server.address().port;
    const post=async(body,path='/api/auth/login')=>{const response=await fetch(base+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});return {status:response.status,body:await response.json()}};
    const input={phone,password,verificationMethod:'password'};
    const proof={captchaTicket:'synthetic-valid-ticket',captchaRandstr:'synthetic-rand'};
    for(const path of ['/api/auth/login','/api/auth/admin-login']){
     const before=comparisons;
     assert.equal((await post(input,path)).status,400);
     assert.equal((await post({...input,phone:'16600000932'},path)).status,400);
     assert.equal((await post({...input,...proof,captchaTicket:'synthetic-invalid-ticket'},path)).status,400);
     assert.equal(comparisons,before,'No password work before genuine provider approval');
     assert.equal((await post({...input,...proof,password:'wrong'},path)).status,401);
     assert.equal((await post({...input,...proof},path)).status,200);
     assert.equal(comparisons,before+2);
    }
    const calls=providerCalls,before=comparisons;
    smsStore.set(phone,{code:'222222',expiresAt:Date.now()+300000});
    assert.equal((await post({phone,code:'222222',verificationMethod:'sms'})).status,200);
    assert.equal(comparisons,before);assert.equal(providerCalls,calls,'SMS login does not reuse a consumed send ticket');
    console.log('PASSWORD_CAPTCHA_ORDER_PASS');
   }finally{bcrypt.compare=compare;await runtime.stop()}
  `,{nodeArgs:['--experimental-test-module-mocks'],env:{WQT_RUNTIME_TEST_CHILD:'1',WQT_ACCOUNT_MODEL:'accounts',DATABASE_URL:owned.connectionString,CARDS_DATABASE_URL:owned.connectionString,CARDS_SOURCE:'postgres',JWT_SECRET:'captcha-synthetic-test-only',REDIS_URL:process.env.WQT_TEST_REDIS_URL,WQT_REDIS_NAMESPACE:owned.database,CAPTCHA_ENABLED:'true',CAPTCHA_APP_ID:'123',CAPTCHA_APP_SECRET_KEY:'synthetic',TENCENT_SECRET_ID:'synthetic',TENCENT_SECRET_KEY:'synthetic'},timeoutMs:60000});
  assert.equal(result.code,0,result.stderr+'\n'+result.stdout);assert.match(result.stdout,/PASSWORD_CAPTCHA_ORDER_PASS/);
 }finally{await dropOwnedDatabase(owned)}
});

test('production account password login fails closed when captcha is not configured',async()=>{
 const result=await runNodeScript(`
  import assert from 'node:assert/strict';
  import {createApp} from './src/app.js';
  const server=createApp().listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  try{
   const response=await fetch('http://127.0.0.1:'+server.address().port+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({phone:'16600000931',password:'synthetic',verificationMethod:'password'})});
   assert.equal(response.status,503);console.log('PASSWORD_CAPTCHA_UNCONFIGURED_PASS');
  }finally{await new Promise(resolve=>server.close(resolve))}
 `,{env:{NODE_ENV:'production',WQT_ACCOUNT_MODEL:'accounts'}});
 assert.equal(result.code,0,result.stderr);assert.match(result.stdout,/PASSWORD_CAPTCHA_UNCONFIGURED_PASS/);
});
