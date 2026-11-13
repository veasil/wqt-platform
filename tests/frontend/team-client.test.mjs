import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { webcrypto, randomUUID, createHash } from 'node:crypto';
import { once } from 'node:events';
import { createCoursewareServer } from '../../examples/courseware/emma/serve.mjs';

const source = (await readFile(new URL('../../shared/browser/team-client.js', import.meta.url), 'utf8')).replace(/^export /gm, '') + '\nglobalThis.factory = createWqtClient;';
const configuration = { platformOrigin: 'https://platform.example', clientId: 'emma', redirectUri: 'https://course.example/' };
function browserFixture() {
  const values = new Map(), requests = [];
  const location = { href: configuration.redirectUri, origin: 'https://course.example', assign(url) { this.href = url; } };
  let handler = async url => url.endsWith('/token') ? { access_token: 'limited-token', token_type: 'Bearer', expires_in: 900 } : { account: { id: 7, name: '课堂账号' }, expiresAt: Date.now() + 900000 };
  const context = { URL, URLSearchParams, TextEncoder, Uint8Array, Date, JSON, Number, String, setTimeout, clearTimeout, AbortController, btoa,
    crypto: { subtle: webcrypto.subtle, getRandomValues: value => webcrypto.getRandomValues(value), randomUUID },
    sessionStorage: { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) },
    location, history: { replaceState(_state, _title, url) { location.href = url; } },
    async fetch(url, options) {
      requests.push({ url, options, body: options.body ? JSON.parse(options.body) : null });
      const data = await handler(url, options);
      return { status: data?.httpStatus || 200, ok: !data?.httpStatus || data.httpStatus < 400, json: async () => data };
    },
  };
  runInNewContext(source, context);
  return { context, values, requests, location, client: context.factory(configuration), setHandler(fn) { handler = fn; } };
}
async function connect(fixture) {
  await fixture.client.login(); const authorize = new URL(fixture.location.href);
  fixture.location.href = configuration.redirectUri + '?code=single-use-code&state=' + authorize.searchParams.get('state');
  await fixture.client.handleCallback(); await fixture.client.getConnection();
  return authorize;
}
test('PKCE S256 round trip uses no identity secret and removes callback material', async () => {
  const fixture = browserFixture(), authorize = await connect(fixture);
  const exchange = fixture.requests.find(item => item.url.endsWith('/token'));
  assert.equal(authorize.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(createHash('sha256').update(exchange.body.code_verifier).digest('base64url'), authorize.searchParams.get('code_challenge'));
  assert.equal(exchange.options.headers.Authorization, undefined);
  assert.equal(exchange.options.credentials, 'omit');
  assert.equal(fixture.location.href, configuration.redirectUri);
  assert.equal([...fixture.values.keys()].some(key => key.endsWith(':login')), false);
});
test('wrong state, callback location, and duplicate parameters never exchange a code', async () => {
  for (const mode of ['state', 'path', 'duplicate']) {
    const fixture = browserFixture(); await fixture.client.login(); const authorization = new URL(fixture.location.href);
    const state = authorization.searchParams.get('state');
    fixture.location.href = 'https://course.example/' + (mode === 'path' ? 'wrong' : '') + '?code=one&state=' + (mode === 'state' ? 'bad' : state) + (mode === 'duplicate' ? '&code=two' : '');
    await assert.rejects(() => fixture.client.handleCallback(), error => error.code === 'INVALID_CALLBACK');
    assert.equal(fixture.requests.length, 0); assert.equal(new URL(fixture.location.href).search, '');
  }
});
test('lost write response survives client reconstruction and retries identical request only', async () => {
  const fixture = browserFixture(); await connect(fixture);
  let fail = true;
  fixture.setHandler(async url => {
    if (url.endsWith('/session')) return { account: { id: 7, name: '课堂账号' } };
    if (fail) throw new TypeError('response lost');
    return { state: { revision: 2 } };
  });
  await assert.rejects(() => fixture.client.performAction({ sessionId: 11, revision: 1, action: 'adjust', values: [4, 3, 3, 3, 3] }), error => error.outcomeUnknown);
  const first = fixture.requests.at(-1).body;
  const restored = fixture.context.factory(configuration);
  await assert.rejects(() => restored.performAction({ sessionId: 11, revision: 1, action: 'finish' }), error => error.code === 'PENDING_OPERATION');
  fail = false; await restored.retryPending();
  assert.deepEqual(fixture.requests.at(-1).body, first); assert.equal(restored.getPending(), null);
});
test('concurrent clicks cannot replace the saved operation and explicit conflict releases it', async () => {
  const fixture = browserFixture(); await connect(fixture);
  fixture.setHandler(async url => url.endsWith('/session') ? { account: { id: 7 } } : { httpStatus: 409, error: 'state changed' });
  const first = fixture.client.performAction({ sessionId: 1, revision: 0, action: 'pause' });
  await assert.rejects(() => fixture.client.performAction({ sessionId: 1, revision: 0, action: 'pause' }), error => error.code === 'PENDING_OPERATION');
  await assert.rejects(() => first, error => error.status === 409);
  assert.equal(fixture.requests.filter(item => item.url.endsWith('/action')).length, 1); assert.equal(fixture.client.getPending(), null);
});
test('reconnection to a different account never sends the pending mutation', async () => {
  const fixture = browserFixture(); await connect(fixture);
  fixture.setHandler(async url => { if (url.endsWith('/session')) return { account: { id: 7 } }; throw new TypeError('lost'); });
  await assert.rejects(() => fixture.client.startSession({ location: 'demo' }));
  const before = fixture.requests.filter(item => item.url.endsWith('/start')).length;
  fixture.setHandler(async () => ({ account: { id: 8 } }));
  await assert.rejects(() => fixture.client.retryPending(), error => error.code === 'ACCOUNT_CHANGED');
  assert.equal(fixture.requests.filter(item => item.url.endsWith('/start')).length, before);
  assert.ok(fixture.client.getPending());
});
test('storage failures prevent dispatch instead of dropping the replay key', async () => {
  const fixture = browserFixture(); await connect(fixture);
  fixture.context.sessionStorage.setItem = () => { throw new Error('blocked'); };
  const count = fixture.requests.length;
  await assert.rejects(() => fixture.client.performAction({ action: 'pause' }), error => error.code === 'STORAGE_UNAVAILABLE');
  assert.equal(fixture.requests.length, count);
});
test('standalone server serves only explicit assets and supports independent config', async () => {
  const server = createCoursewareServer({ config: configuration }); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = 'http://127.0.0.1:' + server.address().port;
  try {
    assert.match(await (await fetch(base + '/config.js')).text(), /platform\.example/);
    assert.match(await (await fetch(base + '/sdk/team-client.js')).text(), /createWqtClient/);
    for (const path of ['/.env', '/serve.mjs', '/README.md', '/src/config.js', '/%2e%2e/.env']) assert.equal((await fetch(base + path)).status, 404);
    assert.equal((await fetch(base + '/', { method: 'POST' })).status, 405);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
