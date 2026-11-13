import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { chromium } from 'playwright';
import { userErrorMessage } from '../../public/player/errors.js';

const source = await readFile(new URL('../../public/game-review.js', import.meta.url), 'utf8');
const vendor = await readFile(new URL('../../public/vendor/html2canvas-1.4.1/html2canvas.min.js', import.meta.url), 'utf8');

async function harness(t, { rendererMissing = false } = {}) {
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ acceptDownloads: true });
  const errors = [], calls = [];
  page.on('pageerror', e => errors.push(e.message));
  t.after(() => assert.deepEqual(errors, []));
  await page.route('**/*', async route => {
    const path = new URL(route.request().url()).pathname;
    calls.push(path);
    if (path === '/fixture') return route.fulfill({ contentType: 'text/html', body: '<main></main>' });
    if (path === '/api/llm/story') return route.fulfill({ json: { story: JSON.stringify({ story: { paragraphs: ['合成故事，不包含用户数据。'] } }) } });
    if (path === '/api/llm/image') return route.fulfill({ json: {} });
    if (path.includes('/vendor/')) return rendererMissing ? route.abort() : route.fulfill({ contentType: 'text/javascript', body: vendor });
    return route.fulfill({ status: 404, body: '' });
  });
  await page.goto('http://localhost/fixture');
  await page.addScriptTag({ content: source });
  const html = await page.evaluate(async () => (await GameReview.generateReport({
    session: { id: 1, startedAt: 1000, finalScore: 80 }, cards: [], skills: [], durationMs: 1000
  })).reportHtml);
  assert.ok(!html.includes('cdn.jsdelivr.net'));
  await page.setContent(html, { waitUntil: 'networkidle' });
  return { page, calls, html };
}

test('new reports export offline, save a real PNG and can export again', async t => {
  const { page, calls } = await harness(t);
  assert.ok(calls.includes('/vendor/html2canvas-1.4.1/html2canvas.min.js'));
  await page.context().setOffline(true);
  assert.equal(await page.locator('#export-save').isVisible(), false);
  assert.equal(await page.locator('#export-preview').isVisible(), false);
  await page.locator('#export-btn').click();
  await page.locator('#export-save').waitFor({ state: 'visible' });
  await page.waitForFunction(() => document.querySelector('#export-preview').naturalWidth > 0);
  const first = await page.locator('#export-save').getAttribute('href');
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#export-save').click()]);
  assert.match(download.suggestedFilename(), /\.png$/);
  const stream = await download.createReadStream();
  const chunks = []; for await (const chunk of stream) chunks.push(chunk);
  assert.equal(Buffer.concat(chunks).subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  await page.locator('#export-btn').click();
  await page.waitForFunction(old => document.querySelector('#export-save').href !== old, first);
  assert.match(await page.locator('#export-status').innerText(), /图片已生成/);
});

test('missing renderer keeps the report, explains recovery and permits retry', async t => {
  const { page } = await harness(t, { rendererMissing: true });
  await page.locator('#export-btn').click();
  await page.waitForFunction(() => !document.querySelector('#export-btn').disabled);
  assert.match(await page.locator('#export-status').innerText(), /打印 \/ 存PDF/);
  assert.ok(await page.locator('#export-fault').isVisible());
  assert.match(await page.locator('#export-fault summary').innerText(), /P2/);
  assert.ok(await page.locator('#poster').isVisible());
  assert.equal(await page.locator('#export-save').isVisible(), false);
  await page.route('**/vendor/**', route => route.fulfill({ contentType: 'text/javascript', body: vendor }));
  await page.locator('#export-btn').click();
  await page.locator('#export-save').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#export-fault').isVisible(), false);
});

test('rendering failure preserves a prior image, releases canvas and allows retry', async t => {
  const { page } = await harness(t);
  await page.evaluate(() => {
    window.testCanvas = document.createElement('canvas');
    testCanvas.width = 2; testCanvas.height = 2;
    testCanvas.toBlob = callback => callback(null);
    window.html2canvas = async () => testCanvas;
  });
  await page.locator('#export-btn').click();
  await page.waitForFunction(() => !document.querySelector('#export-btn').disabled);
  assert.match(await page.locator('#export-status').innerText(), /暂未能生成/);
  assert.deepEqual(await page.evaluate(() => [testCanvas.width, testCanvas.height]), [0, 0]);
  await page.evaluate(() => { window.html2canvas = async () => { const c = document.createElement('canvas'); c.width = 2; c.height = 2; return c; }; });
  await page.locator('#export-btn').click();
  await page.locator('#export-save').waitFor({ state: 'visible' });
  const saved = await page.locator('#export-save').getAttribute('href');
  await page.evaluate(() => { window.html2canvas = async () => { throw new TypeError("undefined is not an object (evaluating 'x.length')"); }; });
  await page.locator('#export-btn').click();
  await page.waitForFunction(() => !document.querySelector('#export-btn').disabled);
  assert.equal(await page.locator('#export-save').getAttribute('href'), saved);
  assert.ok(!((await page.locator('#export-status').innerText()).includes('length')));
});

test('long report includes its ending while bounding actual canvas dimensions', async t => {
  const { page } = await harness(t);
  await page.evaluate(() => {
    const tail = document.createElement('div'); tail.style.height = '15000px'; tail.textContent = '报告结尾';
    document.querySelector('#poster').appendChild(tail);
    window.html2canvas = async (node, options) => {
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(node.getBoundingClientRect().width * options.scale);
      canvas.height = Math.floor(node.scrollHeight * options.scale);
      window.dimensions = [canvas.width, canvas.height];
      window.boundedCanvas = canvas;
      return canvas;
    };
  });
  await page.locator('#export-btn').click();
  await page.locator('#export-save').waitFor({ state: 'visible' });
  const [width, height] = await page.evaluate(() => dimensions);
  assert.ok(width * height <= 8000000 && width <= 8192 && height <= 8192);
  assert.ok(await page.getByText('报告结尾', { exact: true }).isVisible());
  assert.match(await page.locator('#export-status').innerText(), /报告较长/);
  assert.deepEqual(await page.evaluate(() => [boundedCanvas.width, boundedCanvas.height]), [0, 0]);
});

test('technical errors receive recovery guidance while business messages remain specific', () => {
  for (const error of [new TypeError('x.length'), new ReferenceError('length not found'), new SyntaxError('token')]) {
    assert.match(userErrorMessage(error), /请重试/);
    assert.ok(!userErrorMessage(error).includes(error.message));
  }
  assert.equal(userErrorMessage(new Error('当前账号权益已过期')), '当前账号权益已过期');
  assert.equal(userErrorMessage(Object.assign(new Error('internal.length'), { status: 500 })), '服务暂时无法完成此操作，请稍后重试。');
  assert.equal(userErrorMessage(Object.assign(new Error('fetch failed'), { status: 0 })), '连接暂时未能完成，请检查网络后重试。');
  assert.match(userErrorMessage(null), /请重试/);
});

test('player error boundary keeps the page usable and retains original diagnostics', async t => {
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  const diagnostics = [], uncaught = [];
  page.on('console', message => { if (message.type() === 'error') diagnostics.push(message.text()); });
  page.on('pageerror', error => uncaught.push(error.message));
  await page.route('http://localhost/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.startsWith('/api/')) return route.fulfill({ json: {} });
    try {
      const target = path.startsWith('/shared/browser/') ? resolve('.' + path) : resolve('public', '.' + path);
      let body = await readFile(target);
      if (path === '/player/player.js') body = body.toString().replace(/safe\(resumeLogin\);\s*$/, `
        entry();
        window.testPlayerError = kind => safe(async () => {
          if (kind === 'technical') throw new TypeError("undefined is not an object (evaluating 'x.length')");
          throw new Error('当前账号权益已过期');
        });`);
      return route.fulfill({ body, contentType: ({ '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.png': 'image/png' })[extname(path)] || 'application/octet-stream' });
    } catch { return route.fulfill({ status: 404 }); }
  });
  await page.goto('http://localhost/player/index.html');
  await page.waitForFunction(() => window.testPlayerError);
  await page.evaluate(() => testPlayerError('technical'));
  assert.match(await page.locator('#page-error').innerText(), /请重试/);
  assert.ok(!(await page.locator('#page-error').innerText()).includes('length'));
  assert.ok(diagnostics.some(message => message.includes('length')));
  await page.evaluate(() => testPlayerError('business'));
  assert.equal(await page.locator('#page-error').innerText(), '当前账号权益已过期');
  await page.locator('#enter').click();
  await page.locator('#auth-form').waitFor();
  assert.deepEqual(uncaught, []);
});

test('unconfirmed upload retains a local report that can be downloaded repeatedly', async t => {
  const { page } = await harness(t);
  await page.route('**/api/game/session/1', route => route.fulfill({ json: { session: { id: 1, started_at: 1000, ended_at: 2000 }, events: [] } }));
  // A success flag without a usable file URL must not discard the generated HTML.
  await page.route('**/api/upload/report', route => route.fulfill({ json: { ok: true } }));
  await page.evaluate(async () => {
    localStorage.setItem('WQT_AUTH_TOKEN', 'synthetic-test-token');
    const target = document.createElement('div');
    target.id = 'review-target'; document.body.appendChild(target);
    await GameReview.openReview(target, { sessionId: 1 });
  });
  assert.match(await page.locator('#review-target').innerText(), /云端保存失败/);
  for (let i = 0; i < 2; i++) {
    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#review-open-report').click()]);
    const stream = await download.createReadStream();
    const chunks = []; for await (const chunk of stream) chunks.push(chunk);
    assert.ok(Buffer.concat(chunks).toString().includes('html2canvas 1.4.1'));
  }
});
