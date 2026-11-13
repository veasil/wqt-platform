import assert from 'node:assert/strict';
import {test} from 'node:test';
import net from 'node:net';
import {runNodeScript} from '../helpers/runtime-test-env.mjs';

test('identity sessions reject writes while disconnected and recover without extending expiry',async()=>{
 const upstream=new URL(process.env.WQT_TEST_REDIS_URL || '');
 assert.equal(upstream.hostname,'127.0.0.1','Explicit local test Redis required');
 const sockets=new Set();let accepting=true;
 const proxy=net.createServer(socket=>{
  if(!accepting){socket.destroy();return}
  const remote=net.connect({host:upstream.hostname,port:Number(upstream.port)});
  sockets.add(socket);sockets.add(remote);
  socket.pipe(remote);remote.pipe(socket);
  socket.on('error',()=>remote.destroy());remote.on('error',()=>socket.destroy());
  socket.on('close',()=>{sockets.delete(socket);remote.destroy()});remote.on('close',()=>sockets.delete(remote));
 });
 await new Promise(resolve=>proxy.listen(0,'127.0.0.1',resolve));
 const port=proxy.address().port;
 // Drop only this test's TCP proxy connection, never other Redis clients.
 let outage;
 const control=net.createServer(socket=>{
  socket.on('error',()=>{});
  socket.once('data',()=>{
   accepting=false;for(const current of sockets)current.destroy();
   outage=setTimeout(()=>{accepting=true},700);socket.end('ok');
  });
 });
 await new Promise(resolve=>control.listen(0,'127.0.0.1',resolve));
 try{
  const result=await runNodeScript(`
   import assert from 'node:assert/strict';
   import net from 'node:net';
   import {setTimeout as delay} from 'node:timers/promises';
   import {initIdentitySessions,closeIdentitySessions,createIdentitySession,identitySession,revokeIdentitySession} from './src/services/identity-sessions.js';
   await initIdentitySessions();
   try{
    const original=await createIdentitySession(987654,0);
    await new Promise((resolve,reject)=>{const socket=net.connect(${control.address().port},'127.0.0.1',()=>socket.write('drop'));socket.resume();socket.on('error',reject);socket.on('close',resolve)});
    await delay(80);
    await assert.rejects(()=>createIdentitySession(987654,0),e=>e.status===503);
    let restored;
    for(let i=0;i<50;i++){try{restored=await identitySession(987654,original.jti);if(restored)break}catch(e){assert.equal(e.status,503)}await delay(100)}
    assert.deepEqual(restored,original);
    await revokeIdentitySession(987654,original.jti);
    console.log('IDENTITY_CONNECTION_RECOVERY_PASS');
   }finally{await closeIdentitySessions()}
  `,{env:{REDIS_URL:'redis://127.0.0.1:'+port,WQT_REDIS_NAMESPACE:'wqt_recovery_'+port}});
  assert.equal(result.code,0,result.stderr);assert.match(result.stdout,/IDENTITY_CONNECTION_RECOVERY_PASS/);
 }finally{
  clearTimeout(outage);for(const socket of sockets)socket.destroy();
  await Promise.all([new Promise(resolve=>proxy.close(resolve)),new Promise(resolve=>control.close(resolve))]);
 }
});
