import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import vm from 'node:vm';

const files = ['public/identity-verification.js', 'admin-web/src/utils/captcha.js', 'enterprise-panel/src/utils/captcha.js'];
const flush = () => new Promise(resolve => setImmediate(resolve));
async function harness(file, options = {}) {
  const timers = new Map(), scripts = [], calls = [], elements = [], aliyunCallbacks = [];
  let nextTimer = 0, enabled = options.enabled ?? true, mode = options.mode ?? 'ok';
  let releaseConfig;
  const window = {};
  const context = vm.createContext({window, AbortController,
    document: {head: {append(script) { scripts.push(script); }}, body:{append(element) {elements.push(element);}},
      createElement() { return {children:[],append(...children){this.children.push(...children);},remove() {this.removed = true;}}; }},
    setTimeout(fn, ms) {const id = ++nextTimer; timers.set(id, {fn,ms}); return id;},
    clearTimeout(id) {timers.delete(id);},
    fetch: async (url, init) => {
      calls.push({url, init});
      if (mode === 'hold') await new Promise((resolve, reject) => {
        releaseConfig = resolve;
        init.signal.addEventListener('abort', () => reject(new Error('aborted')), {once:true});
      });
      return {ok: true, json: async () => ({captchaEnabled: enabled, captchaAppId: 'public-app-id',...options.configuration})};
    },
  });
  const source = (await readFile(file, 'utf8')).replace('export {captchaProof, prepareCaptcha};', 'window.WqtVerification = {captchaProof, prepareCaptcha};');
  vm.runInContext(source, context);
  await flush();
  return {api:window.WqtVerification, window, scripts, calls, elements, aliyunCallbacks,
    setEnabled(value) {enabled = value;},
    setMode(value) {mode = value;},
    release() {releaseConfig?.();},
    tick(ms) {for (const [id, timer] of [...timers]) {if(ms===undefined || ms===timer.ms){timers.delete(id); timer.fn();}}},
    aliyunSdk(mode='success') {
      window.initAliyunCaptcha = callbacks => {
        aliyunCallbacks.push(callbacks);
        if(mode==='init-hold')return;
        callbacks.getInstance({show(){
          calls.push({show:'aliyun'});
          if(mode==='success')callbacks.success('synthetic-aliyun-token-'+aliyunCallbacks.length);
          else if(mode==='cancel')callbacks.onClose('userDismiss');
          else if(mode==='error')callbacks.onError({code:'synthetic-provider-error'});
        },destroyCaptcha(){calls.push({destroy:true});}});
      };
      scripts.at(-1)?.onload?.();
    },
    sdk(result = {ret:0, ticket:'ticket', randstr:'random'}) {
      window.TencentCaptcha = function(appId, callback) {this.show = () => { calls.push({show:appId}); callback(result); };};
      scripts.at(-1)?.onload?.();
    },
  };
}

for (const file of files) {
  const configuration={captchaProvider:'aliyun',captchaRegion:'cn',captchaPrefix:'synthetic-prefix',captchaSceneId:'synthetic-scene'};
  test(`${file}: Aliyun loads once, configures before SDK, and initializes fresh proof per attempt`,async()=>{
    const h=await harness(file,{configuration});
    assert.equal(h.window.AliyunCaptchaConfig.region,'cn');
    assert.equal(h.scripts[0].src,'https://o.alicdn.com/captcha-frontend/aliyunCaptcha/AliyunCaptcha.js');
    assert.equal(h.aliyunCallbacks.length,0,'warmup must not initialize a billable challenge');
    h.aliyunSdk();
    const first=await h.api.captchaProof();h.tick(0);
    const second=await h.api.captchaProof();h.tick(0);
    assert.notEqual(first.captchaVerifyParam,second.captchaVerifyParam);
    assert.equal(h.scripts.length,1);
    assert.equal(h.aliyunCallbacks[0].SceneId,configuration.captchaSceneId);
    assert.equal(h.calls.filter(c=>c.destroy).length,2);
    assert.ok(h.elements.every(e=>e.removed));
    assert.equal('captchaTicket' in first,false);
  });
  test(`${file}: Aliyun dismissal, provider error and init timeout recover for a new attempt`,async()=>{
    const h=await harness(file,{configuration});h.aliyunSdk('cancel');
    await assert.rejects(h.api.captchaProof(),/请完成/);h.tick(0);
    h.aliyunSdk('error');await assert.rejects(h.api.captchaProof(),/暂不可用/);h.tick(0);
    h.aliyunSdk('init-hold');const pending=h.api.captchaProof();await flush();
    const rejected=assert.rejects(pending,/初始化超时/);h.tick(20000);await rejected;h.tick(0);
    // A late SDK callback must not reopen the dismissed challenge.
    let lateShows=0;h.aliyunCallbacks.at(-1).getInstance({show(){lateShows++;},destroyCaptcha(){}});
    assert.equal(lateShows,0);
    h.aliyunSdk();assert.ok((await h.api.captchaProof()).captchaVerifyParam);h.tick(0);
  });
  test(`${file}: Aliyun proof is not shared and stalled or malformed challenges never pass`,async()=>{
    const h=await harness(file,{configuration});h.aliyunSdk('hold');
    const pending=h.api.captchaProof();await flush();
    await assert.rejects(h.api.captchaProof(),/正在进行/);
    const rejected=assert.rejects(pending,/已超时/);h.tick(120000);await rejected;h.tick(0);
    const next=h.api.captchaProof();await flush();const malformed=assert.rejects(next,/请完成/);
    h.aliyunCallbacks.at(-1).success({unexpected:'object'});await malformed;h.tick(0);
    h.aliyunSdk();assert.ok((await h.api.captchaProof()).captchaVerifyParam);h.tick(0);
  });
  test(`${file}: Aliyun SDK load failure retries, and invalid or changed config requires correction`,async()=>{
    const config={...configuration};const h=await harness(file,{configuration:config});
    h.scripts[0].onerror();await flush();
    const pending=h.api.captchaProof();await flush();assert.equal(h.scripts.length,2);
    h.aliyunSdk();await pending;h.tick(0);
    config.captchaPrefix='updated-prefix';await assert.rejects(h.api.captchaProof(),/刷新页面/);
    config.captchaRegion='unexpected';await assert.rejects(h.api.captchaProof(),/尚未配置/);
    config.captchaProvider='unexpected';await assert.rejects(h.api.captchaProof(),/供应商配置无效/);
  });
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

