import assert from 'node:assert/strict';
import {test} from 'node:test';
import {runNodeScript} from './helpers/runtime-test-env.mjs';

test('configured SMS uses the provider, exposes no local code, and provider failure never falls back to mock',async()=>{
  const result=await runNodeScript(`
    import assert from 'node:assert/strict';
    import {mock} from 'node:test';
    const calls=[];
    mock.module('node-fetch',{defaultExport:async(url,options)=>{
      const body=JSON.parse(options.body);calls.push({url,body});
      assert.equal(options.headers['X-Bmob-Application-Id'],'synthetic-app');
      assert.equal(options.headers['X-Bmob-REST-API-Key'],'synthetic-key');
      if(body.mobilePhoneNumber==='16600000941')return {ok:false,json:async()=>({error:'synthetic provider unavailable'})};
      return {ok:true,json:async()=>({smsId:'synthetic-sms-id'})};
    }});
    const {config}=await import('./src/config.js');
    Object.assign(config,{BMOB_APP_ID:'synthetic-app',BMOB_REST_KEY:'synthetic-key'});
    const {initSms,stopSms,verifyCode,smsMode}=await import('./src/services/sms.js');
    const {createApp}=await import('./src/app.js');
    initSms();assert.equal(smsMode(),'live');
    const server=createApp().listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
    const base='http://127.0.0.1:'+server.address().port;
    try{
      const options=await fetch(base+'/api/auth/verification-options');
      assert.equal(options.headers.get('cache-control'),'no-store');
      const capability=await options.json();assert.equal(capability.smsMode,'live');
      assert.ok(!JSON.stringify(capability).includes('synthetic-key'));
      const send=phone=>fetch(base+'/api/auth/sms/send',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({phone})});
      const response=await send('16600000940');assert.equal(response.status,200);
      const body=await response.json();assert.equal(body.smsId,'synthetic-sms-id');assert.ok(!Object.hasOwn(body,'mockCode'));
      assert.equal(calls.length,1);assert.ok(calls[0].url.endsWith('/requestSmsCode'));
      assert.equal(body.resendAfterSeconds,60);
      const limited=await send('16600000940');assert.equal(limited.status,429);assert.equal(calls.length,1);
      const cooldown=await limited.json();assert.equal(cooldown.code,'SMS_RESEND_COOLDOWN');
      assert.ok(cooldown.retryAfterSeconds>0 && cooldown.retryAfterSeconds<=60);
      assert.equal(limited.headers.get('retry-after'),String(cooldown.retryAfterSeconds));
      assert.equal((await verifyCode('16600000940','123456')).ok,true);
      assert.ok(calls[1].url.endsWith('/verifySmsCode/123456'));
      const failed=await send('16600000941');assert.equal(failed.status,400);
      assert.deepEqual(await failed.json(),{error:'synthetic provider unavailable'});
      console.log('SMS_PROVIDER_FLOW_PASS');
    }finally{await new Promise(r=>server.close(r));stopSms()}
  `,{nodeArgs:['--experimental-test-module-mocks'],env:{WQT_ACCOUNT_MODEL:'accounts'}});
  assert.equal(result.code,0,result.stderr+'\n'+result.stdout);
  assert.match(result.stdout,/SMS_PROVIDER_FLOW_PASS/);
});

for(const [environment,mode,enabled] of [['test','mock',true],['production','unavailable',false]]){
  test(`public SMS capability distinguishes ${mode} without exposing configuration`,async()=>{
    const result=await runNodeScript(`
      import assert from 'node:assert/strict';
      import {createApp} from './src/app.js';
      const server=createApp().listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
      try{const response=await fetch('http://127.0.0.1:'+server.address().port+'/api/auth/verification-options');const data=await response.json();assert.equal(data.smsMode,${JSON.stringify(mode)});assert.equal(data.sms,${enabled});assert.equal(data.captchaAppId,null);console.log('SMS_CAPABILITY_PASS')}
      finally{await new Promise(r=>server.close(r))}
    `,{env:{NODE_ENV:environment,WQT_ACCOUNT_MODEL:'accounts'}});
    assert.equal(result.code,0,result.stderr+'\n'+result.stdout);assert.match(result.stdout,/SMS_CAPABILITY_PASS/);
  });
}
