(function() {
// Public configuration is refreshed for every verification attempt. Only in-flight
// requests are shared; a previously disabled setting must never bypass a later enable.
let optionsFlight;
let sdkFlight;
let verifying = false;
const LOAD_TIMEOUT_MS = 10000;

function verificationOptions() {
  if (optionsFlight) return optionsFlight;
  optionsFlight = (async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), LOAD_TIMEOUT_MS);
    try {
      const response = await fetch('/api/auth/verification-options', {
        cache: 'no-store', signal: controller.signal,
      });
      if (!response.ok) throw new Error('身份验证服务暂不可用，请重试');
      return await response.json();
    } catch (error) {
      if (controller.signal.aborted) throw new Error('身份验证服务加载超时，请重试');
      throw error;
    } finally {
      clearTimeout(timer);
    }
  })().finally(() => { optionsFlight = null; });
  return optionsFlight;
}

function loadSdk(data) {
  const aliyun = provider(data) === 'aliyun';
  if (aliyun) configureAliyun(data);
  const ready = () => aliyun ? typeof window.initAliyunCaptcha === 'function' : typeof window.TencentCaptcha === 'function';
  if (ready()) return Promise.resolve();
  if (sdkFlight) return sdkFlight;
  sdkFlight = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = aliyun ? 'https://o.alicdn.com/captcha-frontend/aliyunCaptcha/AliyunCaptcha.js' : 'https://turing.captcha.qcloud.com/TCaptcha.js';
    script.async = true;
    const finish = error => {
      clearTimeout(timer);
      script.onload = script.onerror = null;
      if (error) { script.remove(); reject(error); }
      else resolve();
    };
    const timer = setTimeout(() => finish(new Error('人机验证加载超时，请重试')), LOAD_TIMEOUT_MS);
    script.onload = () => finish(ready() ? null : new Error('人机验证加载失败，请重试'));
    script.onerror = () => finish(new Error('人机验证加载失败，请重试'));
    document.head.append(script);
  }).finally(() => { sdkFlight = null; });
  return sdkFlight;
}

async function prepareCaptcha() {
  const data = await verificationOptions();
  if (!data.captchaEnabled) return data;
  if (provider(data) === 'tencent' && !data.captchaAppId) throw new Error('人机验证尚未配置，请稍后重试');
  await loadSdk(data);
  return data;
}


let aliyunConfigKey;
let challengeSequence = 0;
function provider(data) {
  const name = data.captchaProvider || 'tencent';
  if (!['tencent', 'aliyun'].includes(name)) throw new Error('人机验证供应商配置无效，请联系管理员');
  return name;
}
function configureAliyun(data) {
  if (!['cn', 'sgp'].includes(data.captchaRegion) || !data.captchaPrefix || !data.captchaSceneId)
    throw new Error('人机验证尚未配置，请稍后重试');
  const key = JSON.stringify([data.captchaRegion, data.captchaPrefix]);
  if (aliyunConfigKey && aliyunConfigKey !== key) throw new Error('人机验证配置已更新，请刷新页面后重试');
  aliyunConfigKey = key;
  window.AliyunCaptchaConfig = {region: data.captchaRegion, prefix: data.captchaPrefix};
}

function aliyunProof(data) {
  return new Promise((resolve, reject) => {
    const root = document.createElement('div');
    const element = document.createElement('div');
    const button = document.createElement('button');
    const id = `wqt-aliyun-captcha-${++challengeSequence}`;
    element.id = id; button.id = `${id}-button`; button.type = 'button'; button.hidden = true;
    root.append(element, button); document.body.append(root);
    let instance, settled = false;
    const finish = (error, proof) => {
      if (settled) return;
      settled = true;
      clearTimeout(initTimer); clearTimeout(challengeTimer);
      // Let the SDK finish its callback before removing its own DOM.
      setTimeout(() => {
        try {instance?.hide?.(); instance?.destroyCaptcha?.();} catch { /* Always release our host elements. */ }
        finally {root.remove();}
      }, 0);
      if (error) reject(error); else resolve(proof);
    };
    const initTimer = setTimeout(() => finish(new Error('人机验证初始化超时，请重试')), 20000);
    const challengeTimer = setTimeout(() => finish(new Error('人机验证已超时，请重新验证')), 120000);
    try {
      window.initAliyunCaptcha({
        SceneId: data.captchaSceneId, mode: 'popup', element: `#${id}`, button: `#${id}-button`,
        language: 'cn', timeout: 20000,
        getInstance(value) {
          instance = value;
          if (settled) {try {instance?.hide?.(); instance?.destroyCaptcha?.();} catch { /* Late initialization is discarded. */ } return;}
          clearTimeout(initTimer);
          if (typeof instance?.show !== 'function') return finish(new Error('人机验证初始化失败，请重试'));
          try {instance.show();} catch {finish(new Error('人机验证初始化失败，请重试'));}
        },
        success(value) {
          if (typeof value !== 'string' || !value || value.length > 65536)
            return finish(new Error('请完成人机验证'));
          finish(null, {captchaVerifyParam: value});
        },
        fail() {finish(new Error('人机验证未通过，请重试'));},
        onError() {finish(new Error('人机验证服务暂不可用，请重试'));},
        onClose(reason) {if (reason === 'userDismiss') finish(new Error('请完成人机验证'));},
      });
    } catch {finish(new Error('人机验证初始化失败，请重试'));}
  });
}

async function captchaProof() {
  if (verifying) throw new Error('人机验证正在进行，请完成当前验证');
  verifying = true;
  try {
    const data = await prepareCaptcha();
    if (!data.captchaEnabled) return {};
    if (provider(data) === 'aliyun') return await aliyunProof(data);
    return await new Promise((resolve, reject) => {
      const captcha = new window.TencentCaptcha(String(data.captchaAppId), result => {
        if (result.ret === 0 && result.ticket && result.randstr) {
          resolve({captchaTicket: result.ticket, captchaRandstr: result.randstr});
        } else reject(new Error('请完成人机验证'));
      });
      captcha.show();
    });
  } finally {
    verifying = false;
  }
}

// Warm only public resources, never open a challenge or send an SMS on page load.
// A failed warmup is retried by the next explicit attempt.
prepareCaptcha().catch(() => {});

window.WqtVerification = {captchaProof, prepareCaptcha};
})();
