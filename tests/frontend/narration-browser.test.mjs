import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { chromium } from 'playwright';

test('new player listen button uses authenticated narration, pauses, resumes and stops on page change', async t => {
  const browser = await chromium.launch({ headless: true }); t.after(() => browser.close());
  const page = await browser.newPage(); const calls = [], errors = [];
  page.on('pageerror', e => errors.push(e.message));
  // Verifies actual browser UI integration with stub playback, not sound quality.
  await page.addInitScript(() => {
    window.audioStats = { plays: 0, pauses: 0 };
    window.Audio = class {
      constructor() { this.paused = true; }
      async play() { this.paused = false; window.audioStats.plays++; }
      pause() { this.paused = true; window.audioStats.pauses++; }
      removeAttribute() {} load() {}
    };
  });
  const fixture = `
user={identityId:1,accountId:11,guardianName:'测试守望者',validityValid:true};account={id:11,name:'测试账号'};
localStorage.setItem('WQT_AUTH_TOKEN','synthetic');session={id:9};practice=false;
state={duration:600,counts:[2,1,0],phase:0,done:[0,0,0],values:[3,3,3,3,3],used:[],skillCards:{},choices:[],d:{},startedAt:Date.now(),paused:false,pausedMs:0,ended:false,failures:0};
card={id:2,card_code:'B02',title:'测试题面',event:'小伍收到了一条消息。',safetyType:'社交',options:{A:{text:'先核实'},B:{text:'与伙伴讨论'}}};
window.fixture={leave(){show('entry','<p>已离开</p>')},snapshot(){return JSON.stringify(state)}};game();`;
  await page.route('http://localhost/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.startsWith('/api/player/narration/')) {
      calls.push({ path, method: route.request().method(), auth: route.request().headers().authorization });
      return route.fulfill({ contentType: 'audio/mpeg', body: Buffer.from('ID3-synthetic') });
    }
    if (path.startsWith('/api/')) return route.fulfill({ contentType: 'application/json', body: '{}' });
    try {
      const target = path.startsWith('/shared/browser/') ? resolve('.' + path) : resolve('public', '.' + path);
      let body = await readFile(target);
      if (path === '/player/player.js') body = body.toString().replace(/safe\(resumeLogin\);\s*$/, fixture);
      return route.fulfill({ body, contentType: ({ '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.png': 'image/png' })[extname(path)] || 'application/octet-stream' });
    } catch { return route.fulfill({ status: 404 }); }
  });
  await page.goto('http://localhost/player/index.html');
  await page.waitForFunction(() => window.fixture);
  const before = await page.evaluate(() => window.fixture.snapshot());
  await page.click('#listen'); await page.waitForFunction(() => document.querySelector('#listen').textContent.includes('暂停朗读'));
  assert.deepEqual(calls, [{ path: '/api/player/narration/9/2', method: 'POST', auth: 'Bearer synthetic' }]);
  await page.click('#listen'); assert.match(await page.locator('#listen').innerText(), /继续朗读/);
  await page.click('#listen'); await page.waitForFunction(() => window.audioStats.plays === 2);
  assert.equal(calls.length, 1);
  assert.equal(await page.evaluate(() => window.fixture.snapshot()), before);
  const pauses = await page.evaluate(() => window.audioStats.pauses);
  await page.evaluate(() => window.fixture.leave());
  assert.equal(await page.evaluate(() => window.audioStats.pauses), pauses + 1);
  assert.deepEqual(errors, []);
});
