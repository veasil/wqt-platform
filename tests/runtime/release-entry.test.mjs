import assert from 'node:assert/strict';
import {test} from 'node:test';
import {runNodeScript} from '../helpers/runtime-test-env.mjs';
test('scoring-admin release directs both hosts and closes organization UI',async()=>{
 const result=await runNodeScript(`
 import assert from 'node:assert/strict';
 import http from 'node:http';
 import {once} from 'node:events';
 import {createApp} from './src/app.js';
 const server=http.createServer(createApp({runtimeConfig:{JWT_SECRET:'test'}}));
 server.listen(0,'127.0.0.1'); await once(server,'listening');
 const port=server.address().port;
 const request=(path,host)=>new Promise((resolve,reject)=>{
  http.get({hostname:'127.0.0.1',port,path,headers:{host}},res=>{
   let body='';res.on('data',chunk=>body+=chunk);res.on('end',()=>resolve({status:res.statusCode,location:res.headers.location,body}));
  }).on('error',reject);
 });
 try {
  assert.equal((await request('/','scoring.ai5000days.com')).location,'/player/');
  assert.equal((await request('/','admin.ai5000days.com')).location,'/admin/');
  assert.equal((await request('/enterprise/','scoring.ai5000days.com')).status,404);
  const health=await request('/api/health','scoring.ai5000days.com');
  assert.deepEqual(JSON.parse(health.body),{ok:true,release:'release-test'});
 }finally{await new Promise(resolve=>server.close(resolve));}
 `,{env:{WQT_RELEASE_SCOPE:'scoring-admin',WQT_ACCOUNT_MODEL:'accounts',WQT_RELEASE_SHA:'release-test'}});
 assert.equal(result.code,0,result.stderr);
});
