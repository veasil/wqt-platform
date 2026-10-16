import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import multer from 'multer';
import { Readable } from 'node:stream';
import { once } from 'node:events';
import { registerDownloadRoutes, hasDownloadEntitlement, isDownloadCenterObject } from '../../src/platform/downloads/routes.js';

test('download version namespace remains protected through normalized OSS names',()=>{
  for(const name of ['download-center/id','/download-center/id','other/../download-center/id','\\download-center\\id'])assert.equal(isDownloadCenterObject(name),true);
  for(const name of ['game-review/file.html','download-center-other/id',null])assert.equal(isDownloadCenterObject(name),false);
});

async function fixture(options = {}) {
  const events = [], objects = [], deletes = [], rows = [];
  let reads = 0;
  const release = { id: 'current', title: '资料', version: '1', filename: 'rules.zip', size: 3, sha256: 'hash', object_key: 'private/key', created_at: 1 };
  if(options.content)release.size=options.content.length;
  const run = async (sql, args) => {
    if (options.auditFailure && sql.includes('download_events')) throw new Error('audit unavailable');
    if (sql.includes('download_events')) events.push({ request: args[1], release: args[2], user: args[3], organization: args[6], event: args[7] });
    if (sql.includes('download_releases')) rows.push(args);
  };
  const store = { get: async () => release, all: async sql => sql.includes('download_events') ? events : [release], run,
    transaction: async work => { if (options.transactionFailure) throw new Error('transaction failed'); return work({ run }); } };
  const authenticate = (req, res, next) => {
    const mode = req.headers.authorization;
    if (!mode) return res.status(401).json({ error: '未登录' });
    req.user = { uid: 1, role: mode === 'boss' ? 'boss' : 'watcher', enterpriseId: 4 };
    req.accountValidity = { valid: mode !== 'expired', until: mode === 'expired' ? 1 : Date.now() + 100000 };

    next();
  };
  const app = express();
  registerDownloadRoutes(app, { store, authenticate, boss: (req, res, next) => req.user.role === 'boss' ? next() : res.status(403).json({ error: '无权限' }),
    upload: multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } }),
    ossClient: { put: async (...args) => objects.push(args), delete: async key => deletes.push(key), getStream: async () => {
      reads++; if (options.ossFailure) throw new Error('OSS unavailable');
      if(options.slowStream) return {stream:Readable.from((async function*(){for(let offset=0;offset<options.content.length;offset+=65536){yield options.content.subarray(offset,offset+65536);await new Promise(r=>setTimeout(r,10))}})())};
      return { stream: Readable.from([options.content || (options.shortStream ? 'zi' : 'zip')]) };
    } } });
  app.use((error, _req, res, _next) => { if (!res.headersSent) res.status(500).json({ error: error.message }); });
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  return { events, objects, deletes, rows, reads: () => reads, release,
    request: (path, mode, init = {}) => fetch(`http://127.0.0.1:${server.address().port}${path}`, { ...init, headers: { ...init.headers, ...(mode ? { Authorization: mode } : {}) } }),
    close: () => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }) };
}

test('download requires paid entitlement, including exact expiry and platform exemption', () => {
  assert.equal(hasDownloadEntitlement({ accountValidity: { valid: true, until: null } }), false);
  assert.equal(hasDownloadEntitlement({ accountValidity: { valid: true, until: 100 } }, 100), false);
  assert.equal(hasDownloadEntitlement({ accountValidity: { valid: true, until: 101 } }, 100), true);
});
test('production login and membership gate list and file', async () => {
  const f = await fixture(); try {
    for (const path of ['/api/downloads', '/api/downloads/current/file']) {
      for (const mode of [null, 'expired']) assert.equal((await f.request(path, mode)).status, mode ? 403 : 401);
    }
    assert.equal(f.reads(), 0); assert.equal(f.events.length, 4);
    assert.ok(f.events.every(e => e.event === 'denied'));
    assert.equal(f.events[0].user, null);
  } finally { await f.close(); }
});
test('list hides object key; successful download writes paired audit and private attachment', async () => {
  const f = await fixture(); try {
    const list = await (await f.request('/api/downloads', 'paid')).json();
    assert.equal(list.releases[0].object_key, undefined);
    const response = await f.request('/api/downloads/current/file', 'paid');
    assert.equal(await response.text(), 'zip'); assert.match(response.headers.get('content-disposition'), /attachment/);
    assert.match(response.headers.get('cache-control'), /no-store/);
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(f.events.map(e => e.event), ['requested', 'server_sent']);
    assert.equal(f.events[0].request, f.events[1].request);
    assert.equal((await f.request('/api/downloads/old/file', 'paid')).status, 404);
    assert.equal(f.reads(), 1);
  } finally { await f.close(); }
});
test('audit failure fails closed before OSS; storage failure is audited', async () => {
  for (const options of [{ auditFailure: true }, { ossFailure: true }]) {
    const f = await fixture(options); try {
      const response = await f.request('/api/downloads/current/file', 'paid');
      assert.equal(response.status, options.auditFailure ? 500 : 502);
      if (options.auditFailure) assert.equal(f.reads(), 0);
      else assert.deepEqual(f.events.map(e => e.event), ['requested', 'failed']);
    } finally { await f.close(); }
  }
});
test('truncated storage stream cannot be audited as a complete send', async () => {
  const f=await fixture({shortStream:true});
  try {
    await assert.rejects(async()=>{const response=await f.request('/api/downloads/current/file','paid');await response.arrayBuffer()});
    for(let attempt=0;attempt<20 && !f.events.some(e=>e.event==='failed');attempt++)await new Promise(r=>setTimeout(r,10));
    assert.deepEqual(f.events.map(e=>e.event),['requested','failed']);
  } finally {await f.close()}
});
test('four simultaneous 8 MiB downloads retain complete bytes and distinct audit requests',async()=>{
  const content=Buffer.alloc(8*1024*1024,42),f=await fixture({content});
  try {
    await Promise.all(Array.from({length:4},async()=>{
      const response=await f.request('/api/downloads/current/file','paid');assert.equal(response.status,200);
      assert.deepEqual(Buffer.from(await response.arrayBuffer()),content);
    }));
    for(let i=0;i<100 && f.events.length<8;i++)await new Promise(r=>setTimeout(r,10));
    const ids=new Set(f.events.map(event=>event.request));assert.equal(ids.size,4);
    for(const id of ids)assert.deepEqual(f.events.filter(event=>event.request===id).map(event=>event.event),['requested','server_sent']);
  } finally {await f.close()}
});
test('client cancellation records failure rather than successful send',async()=>{
  const f=await fixture({content:Buffer.alloc(8*1024*1024,42),slowStream:true});
  try {
    const controller=new AbortController();
    const response=await f.request('/api/downloads/current/file','paid',{signal:controller.signal});
    const reader=response.body.getReader();assert.equal((await reader.read()).done,false);controller.abort();
    for(let i=0;i<100 && !f.events.some(event=>event.event==='failed');i++)await new Promise(r=>setTimeout(r,10));
    assert.deepEqual(f.events.map(event=>event.event),['requested','failed']);
  } finally {await f.close()}
});
test('platform-only upload and audit; private upload includes checksum and compensates database failure', async () => {
  for (const options of [{}, { transactionFailure: true }]) {
    const f = await fixture(options); try {
      for (const path of ['/api/admin/downloads', '/api/admin/downloads/events']) assert.equal((await f.request(path, 'paid')).status, 403);
      const form = new FormData(); form.append('title', '桌游'); form.append('version', '2'); form.append('file', new Blob(['zip']), '桌游资料.zip');
      assert.equal((await f.request('/api/admin/downloads', 'paid', { method: 'POST', body: form })).status, 403);
      const response = await f.request('/api/admin/downloads', 'boss', { method: 'POST', body: form });
      assert.equal(response.status, options.transactionFailure ? 500 : 201);
      assert.equal(f.objects[0][2].headers['x-oss-object-acl'], 'private');
      if (options.transactionFailure) assert.deepEqual(f.deletes, [f.objects[0][0]]);
      else { assert.match(f.rows[0][6], /^[a-f0-9]{64}$/); assert.equal(f.rows[0][3], '桌游资料.zip'); assert.equal(f.events[0].event, 'published'); }
    } finally { await f.close(); }
  }
});
