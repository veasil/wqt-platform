import assert from 'node:assert/strict';
import {test} from 'node:test';
import {runNodeScript} from '../helpers/runtime-test-env.mjs';

test('frontend assets negotiate compression without changing content, identity responses or API transport', async () => {
  const result = await runNodeScript(`
    import assert from 'node:assert/strict';
    import {randomUUID} from 'node:crypto';
    import {mkdir,writeFile,unlink} from 'node:fs/promises';
    import {resolve} from 'node:path';
    import http from 'node:http';
    import {gunzipSync} from 'node:zlib';
    import {createApp} from './src/app.js';
    const name='wqt-compression-'+randomUUID()+'.js';
    const directory=resolve('admin-web/dist/assets'),file=resolve(directory,name);
    const body=Buffer.from('/* synthetic static frontend fixture */\\n'.repeat(4000));
    await mkdir(directory,{recursive:true});await writeFile(file,body,{flag:'wx'});
    const server=createApp().listen(0,'127.0.0.1');
    await new Promise(r=>server.once('listening',r));
    const request=(path,encoding)=>new Promise((resolve,reject)=>{
      http.get({hostname:'127.0.0.1',port:server.address().port,path,headers:{'Accept-Encoding':encoding}},response=>{
        const chunks=[];response.on('data',chunk=>chunks.push(chunk));
        response.on('end',()=>resolve({status:response.statusCode,headers:response.headers,body:Buffer.concat(chunks)}));
      }).on('error',reject);
    });
    try {
      const compressed=await request('/admin/assets/'+name,'gzip');
      assert.equal(compressed.status,200);assert.equal(compressed.headers['content-encoding'],'gzip');
      assert.match(compressed.headers.vary,/Accept-Encoding/i);
      assert.deepEqual(gunzipSync(compressed.body),body);assert.ok(compressed.body.length<body.length/2);
      const original=await request('/admin/assets/'+name,'gzip;q=0, identity');
      assert.equal(original.status,200);assert.equal(original.headers['content-encoding'],undefined);
      assert.deepEqual(original.body,body);
      for (const path of ['/player/player.js','/shared/browser/sms-cooldown.js']) {
        const zipped=await request(path,'gzip');
        const plain=await request(path,'identity');
        assert.equal(zipped.status,200);assert.equal(zipped.headers['content-encoding'],'gzip');
        assert.deepEqual(gunzipSync(zipped.body),plain.body);
      }
      const api=await request('/api/auth/verification-options','gzip');
      assert.equal(api.status,200);assert.equal(api.headers['content-encoding'],undefined);
      console.log('FRONTEND_COMPRESSION_CONTRACT_PASS');
    } finally {await new Promise(r=>server.close(r));await unlink(file)}
  `);
  assert.equal(result.code,0,result.stderr+'\n'+result.stdout);
  assert.match(result.stdout,/FRONTEND_COMPRESSION_CONTRACT_PASS/);
});
