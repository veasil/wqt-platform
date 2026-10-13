import {test} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import express from 'express';
import authRouter from '../../src/routes/auth.routes.js';

test('retired admin login never issues a token or accesses a database for any method or phone',async()=>{
  // No initDb: any accidental legacy database access would fail this HTTP test.
  const app=express();app.use(express.json());app.use(authRouter);
  const server=app.listen(0,'127.0.0.1');await once(server,'listening');
  try {
    for(const method of ['GET','POST','PUT','PATCH','DELETE','OPTIONS']) {
      const response=await fetch(`http://127.0.0.1:${server.address().port}/api/auth/admin-login`,{
        method,headers:{'Content-Type':'application/json'},
        ...(method!=='GET'?{body:JSON.stringify({phone:'19900000001',password:'synthetic-password',code:'123456'})}:{})});
      assert.equal(response.status,410);assert.equal(response.headers.get('cache-control'),'no-store');
      assert.deepEqual(await response.json(),{error:'此登录方式已关闭，请使用密码和短信验证码登录',code:'ADMIN_LOGIN_CLOSED'});
    }
  } finally {await new Promise(r=>{server.close(r);server.closeAllConnections()})}
});
