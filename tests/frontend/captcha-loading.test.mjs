import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import vm from 'node:vm';

const files = ['public/identity-verification.js', 'admin-web/src/utils/captcha.js', 'enterprise-panel/src/utils/captcha.js'];
const flush = () => new Promise(resolve => setImmediate(resolve));
async function harness(file, options = {}) {
  const timers = new Map(), scripts = [], calls = [];
  let nextTimer = 0, enabled = options.enabled ?? true, mode = options.mode ?? 'ok';
  let releaseConfig;
  const window = {};
  const context = vm.createContext({window, AbortController,
    document: {head: {append(script) { scripts.push(script); }}, createElement() { return {remove() {this.removed = true;}}; }},
    setTimeout(fn) {const id = ++nextTimer; timers.set(id, fn); return id;},
    clearTimeout(id) {timers.delete(id);},
    fetch: async (url, init) => {
      calls.push({url, init});
      if (mode === 'hold') await new Promise((resolve, reject) => {
        releaseConfig = resolve;
        init.signal.addEventListener('abort', () => reject(new Error('aborted')), {once:true});
      });
      return {ok: true, json: async () => ({captchaEnabled: enabled, captchaAppId: 'public-app-id'})};
    },
  });
  const source = (await readFile(file, 'utf8')).replace('export {captchaProof, prepareCaptcha};', 'window.WqtVerification = {captchaProof, prepareCaptcha};');
  vm.runInContext(source, context);
  await flush();
  return {api:window.WqtVerification, window, scripts, calls,
    setEnabled(value) {enabled = value;},
    setMode(value) {mode = value;},
    release() {releaseConfig?.();},
    tick() {for (const [id, fn] of [...timers]) {timers.delete(id); fn();}},
    sdk(result = {ret:0, ticket:'ticket', randstr:'random'}) {
      window.TencentCaptcha = function(appId, callback) {this.show = () => { calls.push({show:appId}); callback(result); };};
      scripts.at(-1)?.onload?.();
    },
  };
}

for (const file of files) {
  test(`${file}: prewarm deduplicates concurrent config and SDK loading without opening a challenge`, async () => {
    const h = await harness(file, {mode:'hold'});
    const one = h.api.prepareCaptcha(), two = h.api.prepareCaptcha();
    assert.equal(h.calls.length, 1);
    h.release(); await flush();
    assert.equal(h.scripts.length, 1);
    assert.equal(h.calls.some(c => c.show), false);
    h.sdk(); await Promise.all([one, two]); h.setMode('ok');
    const proof = await h.api.captchaProof();
    assert.equal(proof.captchaTicket, 'ticket');
    assert.equal(h.calls.filter(c => c.url).length, 2, 'explicit verification refreshes public configuration');
    assert.equal(h.calls[0].init.cache, 'no-store');
  });
  test(`${file}: disabled captcha does not load SDK and disabling is not cached`, async () => {
    const h = await harness(file, {enabled:false});
    assert.equal(h.scripts.length, 0);
    assert.deepEqual(Object.keys(await h.api.captchaProof()), []);
    h.setEnabled(true);
    const proof = h.api.captchaProof(); await flush();
    assert.equal(h.scripts.length, 1); h.sdk(); await proof;
  });
  test(`${file}: SDK load failure can retry`, async () => {
    const h = await harness(file);
    h.scripts[0].onerror(); await flush();
    assert.equal(h.scripts[0].removed, true);
    const proof = h.api.captchaProof(); await flush();
    assert.equal(h.scripts.length, 2); h.sdk(); await proof;
  });
  test(`${file}: stalled SDK times out, removes the script, and retries`, async () => {
    const h = await harness(file);
    const proof = h.api.captchaProof(); await flush();
    const rejected = assert.rejects(proof, /加载超时/);
    h.tick(); await rejected;
    assert.equal(h.scripts[0].removed, true);
    const retry = h.api.captchaProof(); await flush(); h.sdk(); await retry;
  });
  test(`${file}: stalled public configuration aborts and retries`, async () => {
    const h = await harness(file, {mode:'hold'});
    const proof = h.api.captchaProof();
    const rejected = assert.rejects(proof, /服务加载超时/);
    h.tick(); await rejected;
    assert.equal(h.calls[0].init.signal.aborted, true);
    h.setMode('ok');
    const retry = h.api.captchaProof(); await flush(); h.sdk(); await retry;
  });
  test(`${file}: cancellation or missing proof never returns a successful ticket`, async () => {
    const h = await harness(file); h.sdk({ret:2});
    await assert.rejects(h.api.captchaProof(), /请完成/);
    h.sdk({ret:0});
    await assert.rejects(h.api.captchaProof(), /请完成/);
  });
  test(`${file}: concurrent verification does not share a single-use ticket`, async () => {
    const h = await harness(file);
    const first = h.api.captchaProof();
    await assert.rejects(h.api.captchaProof(), /正在进行/);
    await flush(); h.sdk(); await first;
  });
}

