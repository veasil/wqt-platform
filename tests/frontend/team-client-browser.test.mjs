import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { chromium } from 'playwright';
import { createCoursewareServer } from '../../examples/courseware/emma/serve.mjs';

test('independent courseware UI creates, adjusts, reloads and shows saved result', async () => {
  const config = { platformOrigin: 'http://127.0.0.1:1', clientId: 'emma-courseware', redirectUri: '' };
  const server = createCoursewareServer({ config }); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  config.redirectUri = 'http://127.0.0.1:' + server.address().port + '/';
  let browser;
  try {
    browser = await chromium.launch({ headless: true }); const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(({ config }) => {
      const key = 'wqt-team:' + config.platformOrigin + ':' + config.clientId + ':' + config.redirectUri + ':auth';
      sessionStorage.setItem(key, JSON.stringify({ accessToken: 'synthetic-limited-token', expiresAt: Date.now() + 900000 }));
    }, { config });
    let state = { revision: 0, values: [3, 3, 3, 3, 3], phase: 0, ended: false, paused: false, pending: null }, actions = 0;
    await page.route(config.platformOrigin + '/**', async route => {
      const url = new URL(route.request().url()); let data;
      if (url.pathname === '/api/connect/session') data = { account: { id: 1, name: '合成课堂账号', organizationId: 2 } };
      else if (url.pathname === '/api/player/start') data = { ok: true, sessionId: 12, initialState: { values: [99] } };
      else if (url.pathname === '/api/player/session/12') data = { session: { id: 12 }, state, scoreOverview: { finalScore: 73 }, events: [] };
      else if (url.pathname === '/api/player/cards/12') data = { cards: [] };
      else if (url.pathname === '/api/player/action') {
        const input = route.request().postDataJSON(); actions++;
        assert.equal(input.revision, state.revision); assert.ok(input.requestId);
        state = { ...state, revision: state.revision + 1, ...(input.action === 'adjust' ? { values: input.values } : { ended: true }) };
        data = { state, type: input.action, payload: {} };
      } else throw new Error('Unexpected endpoint: ' + url.pathname);
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
    });
    await page.goto(config.redirectUri);
    await page.waitForFunction(() => !document.querySelector('#start').disabled);
    await page.click('#start'); await page.waitForFunction(() => document.querySelectorAll('.score strong').length === 5);
    assert.equal(await page.locator('.score strong').first().textContent(), '3', 'uses persisted GET state, not start initialState');
    await page.locator('summary').click(); await page.fill('[name=score0]', '5'); await page.locator('#adjust-form button').click();
    await page.waitForFunction(() => document.querySelector('.score strong')?.textContent === '5');
    await page.reload(); await page.waitForFunction(() => document.querySelector('.score strong')?.textContent === '5');
    await page.click('#finish'); await page.waitForFunction(() => document.querySelector('#result strong')?.textContent === '73');
    await page.reload(); await page.waitForFunction(() => document.querySelector('#result strong')?.textContent === '73');
    assert.equal(actions, 2); assert.deepEqual(errors, []);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  } finally {
    await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  }
});
