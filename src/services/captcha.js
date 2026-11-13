import crypto from "crypto";
import fetch from "node-fetch";
import {captchaProvider,captchaConfigurationError} from './captcha-config.js';

/**
 * 行为/图形验证码人机校验（防自动化批量刷短信）。
 *
 * 默认关闭：CAPTCHA_ENABLED 不为 "true" 时，verifyCaptcha 直接放行并打印一次告警，
 * 此时短信接口仅靠限流防护。生产环境强烈建议接入腾讯云天御后开启。
 *
 * CAPTCHA_PROVIDER=aliyun 时走验证码2.0，使用独立 ALIYUN_CAPTCHA_* 配置。
 * 未指定 provider 时兼容腾讯云天御，所需环境变量：
 *   CAPTCHA_ENABLED=true
 *   TENCENT_SECRET_ID        腾讯云 API 密钥 SecretId
 *   TENCENT_SECRET_KEY       腾讯云 API 密钥 SecretKey
 *   CAPTCHA_APP_ID           验证码 CaptchaAppId（控制台获取）
 *   CAPTCHA_APP_SECRET_KEY   验证码 AppSecretKey（控制台获取）
 *
 * 前端用天御 JS SDK 弹窗，校验通过后回调拿到 { ticket, randstr }，随发码请求一并提交。
 * 后端调用天御 DescribeCaptchaResult 二次核验，CaptchaCode===1 才算通过。
 */
export const CAPTCHA_ENABLED = String(process.env.CAPTCHA_ENABLED || "").toLowerCase() === "true";

const sha256hex = (s) => crypto.createHash("sha256").update(s, "utf8").digest("hex");
const hmac = (key, msg) => crypto.createHmac("sha256", key).update(msg, "utf8").digest();

// 腾讯云 TC3-HMAC-SHA256 签名，返回请求头
function tc3Headers({ secretId, secretKey, host, service, action, version, region, payload }) {
  const timestamp = Math.floor(Date.now() / 1000);
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10); // UTC YYYY-MM-DD
  const algorithm = "TC3-HMAC-SHA256";
  const contentType = "application/json; charset=utf-8";

  // 1) 拼接规范请求串
  const canonicalHeaders = `content-type:${contentType}\nhost:${host}\n`;
  const signedHeaders = "content-type;host";
  const canonicalRequest = [
    "POST", "/", "", canonicalHeaders, signedHeaders, sha256hex(payload),
  ].join("\n");

  // 2) 拼接待签名字符串
  const credentialScope = `${date}/${service}/tc3_request`;
  const stringToSign = [
    algorithm, timestamp, credentialScope, sha256hex(canonicalRequest),
  ].join("\n");

  // 3) 计算签名
  const secretDate = hmac("TC3" + secretKey, date);
  const secretService = hmac(secretDate, service);
  const secretSigning = hmac(secretService, "tc3_request");
  const signature = crypto.createHmac("sha256", secretSigning).update(stringToSign, "utf8").digest("hex");

  // 4) 拼接 Authorization
  const authorization =
    `${algorithm} Credential=${secretId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const headers = {
    Authorization: authorization,
    "Content-Type": contentType,
    Host: host,
    "X-TC-Action": action,
    "X-TC-Timestamp": String(timestamp),
    "X-TC-Version": version,
  };
  if (region) headers["X-TC-Region"] = region;
  return headers;
}

let warnedDisabled = false;

/**
 * 校验前端提交的验证码票据。
 * @returns {Promise<{ok:boolean, skipped?:boolean, error?:string}>}
 */
export async function verifyCaptcha({ ticket, randstr, ip, captchaVerifyParam } = {}) {
  if (!CAPTCHA_ENABLED) {
    if (!warnedDisabled) {
      console.warn("⚠️  人机验证未开启（CAPTCHA_ENABLED!=true），短信接口仅靠限流防护。生产建议接入腾讯云天御。");
      warnedDisabled = true;
    }
    return { ok: true, skipped: true };
  }

  const invalidField = captchaConfigurationError();
  if (invalidField) {
    console.error('Captcha configuration invalid:', invalidField);
    return {ok:false,error:'人机验证服务未正确配置'};
  }
  if (captchaProvider() === 'aliyun') {
    const {verifyAliyunCaptcha} = await import('./aliyun-captcha.js');
    return verifyAliyunCaptcha(captchaVerifyParam);
  }

  const secretId = process.env.TENCENT_SECRET_ID;
  const secretKey = process.env.TENCENT_SECRET_KEY;
  const captchaAppId = process.env.CAPTCHA_APP_ID;
  const appSecretKey = process.env.CAPTCHA_APP_SECRET_KEY;
  if (!secretId || !secretKey || !captchaAppId || !appSecretKey) {
    console.error("❌ CAPTCHA_ENABLED=true 但天御密钥未配齐，拒绝发送以防绕过");
    return { ok: false, error: "人机验证服务未正确配置" };
  }
  if (!ticket || !randstr) return { ok: false, error: "请先完成人机验证" };

  const host = "captcha.tencentcloudapi.com";
  const payload = JSON.stringify({
    CaptchaType: 9,
    Ticket: ticket,
    Randstr: randstr,
    UserIp: ip || "",
    CaptchaAppId: Number(captchaAppId),
    AppSecretKey: appSecretKey,
  });

  try {
    const headers = tc3Headers({
      secretId, secretKey, host,
      service: "captcha", action: "DescribeCaptchaResult", version: "2019-07-22",
      region: "", payload,
    });
    const resp = await fetch(`https://${host}`, { method: "POST", headers, body: payload, signal:globalThis.AbortSignal.timeout(8000) });
    const data = await resp.json();
    const r = data?.Response;
    if (!r || r.Error) {
      console.error("天御校验接口报错:", r?.Error?.Code || 'INVALID_RESPONSE');
      return { ok: false, error: "人机验证失败，请重试" };
    }
    // CaptchaCode === 1 表示验证通过
    if (r.CaptchaCode === 1) return { ok: true };
    return { ok: false, error: "人机验证未通过，请重试", providerCode:r.CaptchaCode };
  } catch (e) {
    console.error("天御校验异常:", e.message);
    return { ok: false, error: "人机验证服务暂不可用" };
  }
}
