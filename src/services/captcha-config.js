// Deployment-owned provider configuration. Never expose API credentials to browsers.
export const aliyunCaptchaEndpoints = Object.freeze({
  cn: 'captcha.cn-shanghai.aliyuncs.com',
  sgp: 'captcha.ap-southeast-1.aliyuncs.com',
});

export function captchaProvider(env = process.env) {
  return String(env.CAPTCHA_PROVIDER || 'tencent').trim().toLowerCase();
}

export function captchaConfigurationError(env = process.env) {
  const provider = captchaProvider(env);
  if (!['tencent', 'aliyun'].includes(provider)) return 'CAPTCHA_PROVIDER';
  const keys = provider === 'aliyun'
    ? ['ALIYUN_CAPTCHA_REGION', 'ALIYUN_CAPTCHA_PREFIX', 'ALIYUN_CAPTCHA_SCENE_ID', 'ALIYUN_CAPTCHA_ACCESS_KEY_ID', 'ALIYUN_CAPTCHA_ACCESS_KEY_SECRET']
    : ['CAPTCHA_APP_ID', 'CAPTCHA_APP_SECRET_KEY', 'TENCENT_SECRET_ID', 'TENCENT_SECRET_KEY'];
  for (const key of keys) if (typeof env[key] !== 'string' || !env[key].trim()) return key;
  if (provider === 'aliyun') {
    if (!Object.hasOwn(aliyunCaptchaEndpoints, env.ALIYUN_CAPTCHA_REGION)) return 'ALIYUN_CAPTCHA_REGION';
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(env.ALIYUN_CAPTCHA_PREFIX)) return 'ALIYUN_CAPTCHA_PREFIX';
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(env.ALIYUN_CAPTCHA_SCENE_ID)) return 'ALIYUN_CAPTCHA_SCENE_ID';
  }
  return null;
}

export function publicCaptchaOptions(env = process.env) {
  const enabled = String(env.CAPTCHA_ENABLED || '').toLowerCase() === 'true';
  const provider = captchaProvider(env);
  return {
    captchaEnabled: enabled,
    captchaProvider: provider,
    captchaAppId: enabled && provider === 'tencent' ? env.CAPTCHA_APP_ID || null : null,
    ...(enabled && provider === 'aliyun' ? {captchaRegion: env.ALIYUN_CAPTCHA_REGION || null,
      captchaPrefix: env.ALIYUN_CAPTCHA_PREFIX || null, captchaSceneId: env.ALIYUN_CAPTCHA_SCENE_ID || null} : {}),
  };
}

export function aliyunCaptchaCsp(env = process.env) {
  const empty = {scripts:[],connect:[],images:[],frames:[],fonts:[],styles:[]};
  if (captchaProvider(env) !== 'aliyun' || String(env.CAPTCHA_ENABLED).toLowerCase() !== 'true' || captchaConfigurationError(env)) return empty;
  const prefix = env.ALIYUN_CAPTCHA_PREFIX;
  const singapore = env.ALIYUN_CAPTCHA_REGION === 'sgp';
  const suffix = singapore ? 'captcha-open-southeast' : 'captcha-open';
  const resources = ['https://o.alicdn.com','https://g.alicdn.com','https://x.alicdn.com',
    singapore ? 'https://static-captcha-sgp.aliyuncs.com' : 'https://static-captcha.aliyuncs.com'];
  const apis = [prefix, `${prefix}-verify`, 'upload'].flatMap(label =>
    [`https://${label}.${suffix}.aliyuncs.com`, `https://${label}.${suffix}-b.aliyuncs.com`]);
  const device = singapore ? ['https://cloudauth-device.ap-southeast-1.aliyuncs.com','https://cloudauth-device-dualstack.ap-southeast-1.aliyuncs.com','https://ap-southeast-1.device.saf.aliyuncs.com','https://ap-southeast-1-ga.device.saf.aliyuncs.com']
    : ['https://cloudauth-device.aliyuncs.com','https://cloudauth-device-dualstack.cn-shanghai.aliyuncs.com','https://cn-shanghai.device.saf.aliyuncs.com'];
  return {scripts:[...resources,...apis,...device],connect:[...apis,...device,...resources,'data:'],images:[...resources,...apis,...device],frames:resources,fonts:['data:'],styles:resources};
}
