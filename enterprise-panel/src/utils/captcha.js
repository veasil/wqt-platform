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

function loadSdk() {
  if (window.TencentCaptcha) return Promise.resolve();
  if (sdkFlight) return sdkFlight;
  sdkFlight = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://turing.captcha.qcloud.com/TCaptcha.js';
    script.async = true;
    const finish = error => {
      clearTimeout(timer);
      script.onload = script.onerror = null;
      if (error) { script.remove(); reject(error); }
      else resolve();
    };
    const timer = setTimeout(() => finish(new Error('人机验证加载超时，请重试')), LOAD_TIMEOUT_MS);
    script.onload = () => finish(window.TencentCaptcha ? null : new Error('人机验证加载失败，请重试'));
    script.onerror = () => finish(new Error('人机验证加载失败，请重试'));
    document.head.append(script);
  }).finally(() => { sdkFlight = null; });
  return sdkFlight;
}

async function prepareCaptcha() {
  const data = await verificationOptions();
  if (!data.captchaEnabled) return data;
  if (!data.captchaAppId) throw new Error('人机验证尚未配置，请稍后重试');
  await loadSdk();
  return data;
}

async function captchaProof() {
  if (verifying) throw new Error('人机验证正在进行，请完成当前验证');
  verifying = true;
  try {
    const data = await prepareCaptcha();
    if (!data.captchaEnabled) return {};
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

export {captchaProof, prepareCaptcha};
