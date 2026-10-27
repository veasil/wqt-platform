import sdk from '@alicloud/captcha20230305';
import {aliyunCaptchaEndpoints} from './captcha-config.js';

const diagnostic = value => typeof value === 'string' && /^[a-zA-Z0-9_.:-]{1,128}$/.test(value) ? value : 'UNAVAILABLE';
function logFailure(code, requestId) {
  // SDK exceptions can contain the signed request, token and credentials. Do not log them.
  console.error('Captcha provider rejected:', JSON.stringify({provider:'aliyun',code:diagnostic(code),requestId:diagnostic(requestId)}));
}

export async function verifyAliyunCaptcha(captchaVerifyParam) {
  if (typeof captchaVerifyParam !== 'string' || !captchaVerifyParam || captchaVerifyParam.length > 65536)
    return {ok:false,error:'请先完成人机验证'};
  let deadline;
  try {
    const client = new sdk.default({
      accessKeyId: process.env.ALIYUN_CAPTCHA_ACCESS_KEY_ID,
      accessKeySecret: process.env.ALIYUN_CAPTCHA_ACCESS_KEY_SECRET,
      endpoint: aliyunCaptchaEndpoints[process.env.ALIYUN_CAPTCHA_REGION],
    });
    const request = new sdk.VerifyIntelligentCaptchaRequest({
      captchaVerifyParam, sceneId: process.env.ALIYUN_CAPTCHA_SCENE_ID,
    });
    // Tickets are single-use. A lost response must never cause an automatic replay.
    const response = await Promise.race([
      client.verifyIntelligentCaptchaWithOptions(request, {
        autoretry:false,maxAttempts:1,connectTimeout:3000,readTimeout:5000,
      }),
      new Promise((_, reject) => {deadline=setTimeout(() => reject(new Error('CAPTCHA_TIMEOUT')),8000);}),
    ]);
    const body = response?.body;
    // T002 is automatic disaster recovery and T005 is console test mode, not genuine verification.
    if (body?.success === true && body.result?.verifyResult === true && body.result.verifyCode === 'T001')
      return {ok:true};
    const code = body?.result?.verifyCode || body?.code;
    logFailure(code, body?.requestId);
    return {ok:false,error:body?.success === true && body.result?.verifyResult === false
      ? '人机验证未通过，请重试' : '人机验证服务暂不可用，请联系管理员',providerCode:diagnostic(code)};
  } catch (error) {
    logFailure(error?.code || (error?.message === 'CAPTCHA_TIMEOUT' ? 'TIMEOUT' : 'SDK_ERROR'), error?.data?.RequestId);
    return {ok:false,error:'人机验证服务暂不可用，请重试'};
  } finally {clearTimeout(deadline);}
}
