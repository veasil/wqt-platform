import assert from 'node:assert/strict';
import {test} from 'node:test';
import http from 'node:http';
import {createApp} from '../../src/app.js';
test('only the exact scoring bridge permits the admin frame ancestor',async()=>{
 const server=createApp().listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 try{
  const base='http://127.0.0.1:'+server.address().port;
  const request=(path,options={})=>new Promise((resolve,reject)=>{http.get(base+path,options,response=>{response.resume();response.on('end',()=>resolve({status:response.statusCode,headers:{get:key=>response.headers[key]??null}}))}).on('error',reject)});
  const bridge=await request('/player/admin-session.html',{headers:{Host:'scoring.ai5000days.com'}});
  assert.equal(bridge.status,200);assert.equal(bridge.headers.get('x-frame-options'),null);
  assert.match(bridge.headers.get('content-security-policy'),/frame-ancestors https:\/\/admin\.ai5000days\.com;/);
  assert.equal(bridge.headers.get('cache-control'),'no-store');
  const wrong=await request('/player/admin-session.html',{headers:{Host:'admin.ai5000days.com'}});assert.equal(wrong.status,404);
  const player=await request('/player/');assert.match(player.headers.get('content-security-policy'),/frame-ancestors 'none'/);assert.equal(player.headers.get('x-frame-options'),'DENY');
 }finally{await new Promise(r=>server.close(r))}
});
