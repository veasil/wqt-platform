import { BmobSMS } from "../bmob.js";
import { config } from "../config.js";

// Bmob 短信客户端：惰性初始化（在 loadConfig() 之后调用 initSms()）。
// 未配置 Bmob 时为 null，走开发环境的内存模拟验证码（mockCode）。
export let bmobSMS = null;
export function initSms() {
  if (!mockAllowed() && (!config.BMOB_APP_ID || !config.BMOB_REST_KEY)) throw new Error("SMS configuration required outside development/test");
  startQuotaCleanup();
  bmobSMS = config.BMOB_APP_ID && config.BMOB_REST_KEY
    ? new BmobSMS(config.BMOB_APP_ID, config.BMOB_REST_KEY)
    : null;
  return bmobSMS;
}

// 开发环境验证码存储：phone => { code, expiresAt, lastSent }
export const smsStore = new Map();
// 验证码有效期 / 重发间隔，可用环境变量覆盖（默认 5 分钟 / 60 秒；测试可设 0）
export const SMS_CODE_TTL_MS = Number(process.env.SMS_CODE_TTL_MS ?? 5 * 60 * 1000);
export const SMS_RESEND_INTERVAL_MS = Number(process.env.SMS_RESEND_INTERVAL_MS ?? 60 * 1000);

// ===== 发送限流（防短信轰炸 / 话费欺诈）=====
// 同手机号 60s 不重发、每日≤10 条；同 IP 每小时≤20 次。0 表示不限制（测试用）。
// 内存实现：默认单实例部署。多实例需换 Redis（见 docs 安全审计）。
export const SMS_DAILY_LIMIT = Number(process.env.SMS_DAILY_LIMIT ?? 10);
export const SMS_IP_HOURLY_LIMIT = Number(process.env.SMS_IP_HOURLY_LIMIT ?? 20);
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

// phone => { lastSent, windowStart, count }（count 为当日窗口内已发条数）
const phoneQuota = new Map();
// ip => { windowStart, count }（count 为当前小时窗口内已发条数）
const ipQuota = new Map();

// 周期清理过期配额，防内存被「换号轰炸」撑爆
let quotaCleanupTimer;
function startQuotaCleanup() {
  if (quotaCleanupTimer) return;
  quotaCleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [k, v] of phoneQuota) {
    if (now - v.windowStart >= DAY_MS && now - v.lastSent >= SMS_RESEND_INTERVAL_MS) phoneQuota.delete(k);
  }
  for (const [k, v] of ipQuota) {
    if (now - v.windowStart >= HOUR_MS) ipQuota.delete(k);
  }
  }, 10 * 60 * 1000);
  quotaCleanupTimer.unref?.();
}

export function stopSms() {
  clearInterval(quotaCleanupTimer);
  quotaCleanupTimer = undefined;
  bmobSMS = null;
}

// 发送前置限流检查（mock 与 Bmob 真实分支共用）。通过返回 {ok:true}。
export function checkSendQuota(phone, ip) {
  const now = Date.now();
  const pq = phoneQuota.get(phone);
  // 1) 同手机号 60s 重发间隔
  if (pq && SMS_RESEND_INTERVAL_MS > 0 && now - pq.lastSent < SMS_RESEND_INTERVAL_MS) {
    const waitSec = Math.ceil((SMS_RESEND_INTERVAL_MS - (now - pq.lastSent)) / 1000);
    return { ok: false, status: 429, error: `请等待 ${waitSec} 秒后重试` };
  }
  // 2) 同手机号当日上限
  if (pq && SMS_DAILY_LIMIT > 0 && now - pq.windowStart < DAY_MS && pq.count >= SMS_DAILY_LIMIT) {
    return { ok: false, status: 429, error: "今日验证码发送次数已达上限，请明天再试" };
  }
  // 3) 同 IP 每小时上限
  if (ip && SMS_IP_HOURLY_LIMIT > 0) {
    const iq = ipQuota.get(ip);
    if (iq && now - iq.windowStart < HOUR_MS && iq.count >= SMS_IP_HOURLY_LIMIT) {
      return { ok: false, status: 429, error: "操作过于频繁，请稍后再试" };
    }
  }
  return { ok: true };
}

// 仅在「确实发出一条」后调用，累加配额计数
function recordSend(phone, ip) {
  const now = Date.now();
  const pq = phoneQuota.get(phone);
  if (!pq || now - pq.windowStart >= DAY_MS) {
    phoneQuota.set(phone, { lastSent: now, windowStart: now, count: 1 });
  } else {
    pq.lastSent = now;
    pq.count += 1;
  }
  if (ip && SMS_IP_HOURLY_LIMIT > 0) {
    const iq = ipQuota.get(ip);
    if (!iq || now - iq.windowStart >= HOUR_MS) {
      ipQuota.set(ip, { windowStart: now, count: 1 });
    } else {
      iq.count += 1;
    }
  }
}

export function normalizePhone(input) {
  if (!input) return "";
  return String(input).replace(/\D/g, "");
}

// 测试登录后门：仅当配置了 TEST_LOGIN_CODE 时启用。
// TEST_LOGIN_PHONES 为逗号分隔的白名单手机号，这些号码用 TEST_LOGIN_CODE 即可通过校验，
// 不真正调用 Bmob 发短信。生产环境不要配置这两个变量即可彻底关闭。
const TEST_LOGIN_CODE = (process.env.TEST_LOGIN_CODE || "").trim();
const TEST_LOGIN_PHONES = new Set(
  (process.env.TEST_LOGIN_PHONES || "").split(",").map(s => s.trim()).filter(Boolean)
);
function mockAllowed() { return ["test", "development"].includes(process.env.NODE_ENV); }
function isTestLogin(phone) {
  return mockAllowed() && TEST_LOGIN_CODE && TEST_LOGIN_PHONES.has(normalizePhone(phone));
}

export function generateSmsCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

/**
 * 发送验证码。
 * @returns {Promise<{ok:boolean, status?:number, error?:string, mockCode?:string, smsId?:string, expiresInSeconds?:number}>}
 */
export async function sendCode(phone, ip = null) {
  if (isTestLogin(phone)) {

    return { ok: true, mockCode: TEST_LOGIN_CODE, expiresInSeconds: 600 };
  }

  // 限流：mock 与 Bmob 真实发送分支统一前置拦截（防轰炸 + 话费欺诈）
  const quota = checkSendQuota(phone, ip);
  if (!quota.ok) return quota;

  if (!bmobSMS) {
    if (!mockAllowed()) return { ok: false, status: 503, error: "短信服务未配置" };
    const now = Date.now();
    const mockCode = generateSmsCode();
    smsStore.set(phone, { code: mockCode, expiresAt: now + SMS_CODE_TTL_MS, lastSent: now });
    recordSend(phone, ip);

    return { ok: true, mockCode, expiresInSeconds: Math.floor(SMS_CODE_TTL_MS / 1000) };
  }
  try {
    const result = await bmobSMS.sendSmsCode(phone);
    recordSend(phone, ip); // 仅真实发出后才计入配额
    return { ok: true, smsId: result.smsId };
  } catch (e) {
    return { ok: false, status: 400, error: e.message };
  }
}

/**
 * 校验验证码。
 * @param {boolean} [opts.consume=true] 校验成功后是否消费（开发环境）。
 *        登录流程 consume=true（防重放）；独立的预校验端点 consume=false。
 * @returns {Promise<{ok:boolean, error?:string}>}
 */
export async function verifyCode(phone, code, { consume = true } = {}) {
  if (isTestLogin(phone)) {
    return String(code) === TEST_LOGIN_CODE
      ? { ok: true }
      : { ok: false, error: "验证码错误" };
  }
  if (!bmobSMS) {
    if (!mockAllowed()) return { ok: false, status: 503, error: "短信服务未配置" };
    const stored = smsStore.get(phone);
    if (!stored) return { ok: false, error: "验证码不存在或已过期" };
    if (Date.now() > stored.expiresAt) {
      smsStore.delete(phone);
      return { ok: false, error: "验证码已过期" };
    }
    if (stored.code !== String(code)) return { ok: false, error: "验证码错误" };
    if (consume) smsStore.delete(phone);
    return { ok: true };
  }
  try {
    await bmobSMS.verifySmsCode(phone, code);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
