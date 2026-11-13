import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { chromium } from 'playwright';
import { request, ApiError } from '../../public/player/api.js';
import { classifyFault, faultRecord } from '../../public/player/errors.js';

test('invalid successful JSON is explicit, never retried and a write remains unconfirmed', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return new Response('<html>proxy page</html>', { status: 200 }); });
  for (const [method, unknown] of [['GET', false], ['POST', true]]) {
    await assert.rejects(request('/synthetic', { token: null, method }), error => {
      assert.equal(error.code, 'RESPONSE_INVALID');
      assert.equal(error.outcomeUnknown, unknown);
      assert.equal(classifyFault(error).severity, unknown ? 'P1' : 'P2');
      return true;
    });
  }
  assert.equal(calls, 2);
});

test('network loss and service failures distinguish reads, writes and explicit business rejection', async t => {
  let mode = 'network', calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    if (mode === 'network') throw new TypeError('Failed to fetch');
    return Response.json({ error: 'synthetic refusal' }, { status: Number(mode) });
  });
  for (const [failure, method, severity, uncertain] of [
    ['network', 'GET', 'P2', false], ['network', 'POST', 'P1', true],
    ['503', 'GET', 'P2', false], ['503', 'POST', 'P1', true],
    ['403', 'POST', 'P3', false], ['429', 'POST', 'P3', false]
  ]) {
    mode = failure;
    await assert.rejects(request('/synthetic', { method, token: null }), error => {
      assert.equal(classifyFault(error).severity, severity);
      assert.equal(error.outcomeUnknown, uncertain);
      if (failure === 'network') assert.equal(error.cause.message, 'Failed to fetch');
      return true;
    });
  }
  assert.equal(calls, 6);
});

test('pre-canceled requests are not dispatched and primitive success bodies are rejected', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return Response.json(null); });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(request('/synthetic', { token: null, method: 'POST', signal: controller.signal }), error => {
    assert.equal(error.code, 'REQUEST_CANCELLED');
    assert.equal(error.outcomeUnknown, false);
    assert.equal(classifyFault(error).severity, 'P3');
    return true;
  });
  assert.equal(calls, 0);
  await assert.rejects(request('/synthetic', { token: null }), error => error.code === 'RESPONSE_INVALID');
});

test('classification preserves uncertainty and support records contain only approved fields', () => {
  assert.equal(classifyFault(new TypeError('secret.length')).severity, 'P2');
  assert.equal(classifyFault(new TypeError('secret.length'), { unhandled: true }).severity, 'P1');
  assert.equal(classifyFault(new ApiError('权益不足', 403)).severity, 'P3');
  assert.equal(classifyFault(new Error('unclassified')).code, 'WQT-UNKNOWN');
  const error = Object.assign(new TypeError('secret-token secret-phone secret-body'), { status: 500, requestMethod: 'POST', body: 'secret-body', url: 'https://secret-url' });
  const fault = classifyFault(error), record = faultRecord(fault, error, { view: 'game', source: 'caught', accountId: 'secret-account', query: 'secret-query' });
  assert.deepEqual(Object.keys(record), ['reference', 'code', 'severity', 'occurredAt', 'view', 'source', 'httpStatus', 'method']);
  assert.ok(!JSON.stringify(record).includes('secret'));
  assert.equal(faultRecord(fault, error, { view: 'secret-view' }).view, 'other');
  assert.ok(!['P0'].includes(record.severity));
});

async function player(t) {
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  let writes = 0;
  await page.route('http://localhost/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/player/action') { writes++; return route.abort(); }
    if (path.startsWith('/api/')) return route.fulfill({ json: {} });
    try {
      const file = path.startsWith('/shared/browser/') ? resolve('.' + path) : resolve('public', '.' + path);
      let body = await readFile(file);
      if (path === '/player/player.js') body = body.toString().replace(/safe\(resumeLogin\);\s*$/, `
        user={identityId:1,accountId:11,guardianName:'合成用户'};account={id:11,name:'合成账号'};pending=[{id:9}];
        localStorage.setItem('WQT_AUTH_TOKEN','secret-token');entry();
        window.faultFixture={readInvalid:()=>safe(refreshPending),
          uncertain:()=>safe(()=>write('/api/player/action',{sessionId:1,action:'pause'})),
          pending:()=>pending.length};`);
      return route.fulfill({ body, contentType: ({ '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.png': 'image/png' })[extname(file)] || 'application/octet-stream' });
    } catch { return route.fulfill({ status: 404 }); }
  });
  await page.goto('http://localhost/player/index.html');
  await page.waitForFunction(() => window.faultFixture);
  return { page, writes: () => writes };
}

test('invalid feedback preserves current data and copy failure provides a manual path', async t => {
  const { page } = await player(t);
  await page.evaluate(() => faultFixture.readInvalid());
  assert.equal(await page.evaluate(() => faultFixture.pending()), 1);
  assert.equal(await page.locator('.fault-details').getAttribute('data-severity'), 'P2');
  await page.locator('.fault-details summary').click();
  assert.match(await page.locator('.fault-details').innerText(), /WQT-RESPONSE-INVALID/);
  const record = await page.locator('.fault-details textarea').inputValue();
  assert.ok(!record.includes('secret-token'));
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { value: { writeText: async () => { throw new Error('denied'); } }, configurable: true }));
  await page.getByRole('button', { name: '复制故障信息' }).click();
  await page.waitForFunction(() => document.querySelector('.fault-details').textContent.includes('手动复制'));
  assert.equal(await page.locator('.fault-details textarea').inputValue(), record);
  if (process.env.WQT_FAULT_SCREENSHOTS) {
    await mkdir(process.env.WQT_FAULT_SCREENSHOTS, { recursive: true });
    for (const [width, theme] of [[1365, 'dark'], [390, 'dark'], [390, 'light']]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
      await page.screenshot({ path: resolve(process.env.WQT_FAULT_SCREENSHOTS, `${width}-${theme}.png`), fullPage: true });
    }
  }
});

test('uncertain writes retain the original operation and are not automatically resubmitted', async t => {
  const { page, writes } = await player(t);
  await page.evaluate(() => faultFixture.uncertain());
  assert.equal(writes(), 1);
  assert.equal(await page.locator('.fault-details').getAttribute('data-severity'), 'P1');
  assert.match(await page.locator('#page-error').innerText(), /结果尚未确认/);
  const pending = await page.evaluate(() => JSON.parse(sessionStorage.getItem('WQT_PLAYER_PENDING:1:11')));
  assert.ok(pending.requestId);
  assert.equal(pending.body.action, 'pause');
  await page.locator('.fault-details summary').click();
  assert.match(await page.locator('.fault-details').innerText(), /不要另建一笔/);
  assert.equal(writes(), 1);
});

test('uncaught events and rejected promises receive explanations without replacing the page', async t => {
  const { page } = await player(t);
  await page.evaluate(() => setTimeout(() => { throw new TypeError('synthetic.length'); }, 0));
  await page.waitForFunction(() => document.querySelector('.fault-details')?.dataset.severity === 'P1');
  assert.ok(!(await page.locator('#page-error').innerText()).includes('length'));
  assert.ok(await page.locator('#enter').isVisible());
  await page.locator('#page-error').evaluate(el => el.remove());
  await page.evaluate(() => { Promise.reject(new ReferenceError('synthetic-secret')); });
  await page.locator('#player-fault-notice').waitFor();
  await page.locator('#player-fault-notice .fault-details summary').click();
  const record = JSON.parse(await page.locator('#player-fault-notice textarea').inputValue());
  assert.equal(record.source, 'rejection');
  assert.ok(!JSON.stringify(record).includes('synthetic-secret'));
  await page.getByRole('button', { name: '收起提示' }).click();
  assert.equal(await page.locator('#player-fault-notice').count(), 0);
  assert.equal(await page.evaluate(() => localStorage.getItem('WQT_AUTH_TOKEN')), 'secret-token');
});
