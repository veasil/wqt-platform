import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { dbGet, dbRun, getSystemSetting } from "../db.js";
import { config } from "../config.js";
import { signToken, authMiddleware } from "../middleware/auth.js";
import { rotateSession, revokeSession, revokeUserSessions } from "../services/sessions.js";
import { normalizePhone, sendCode, verifyCode } from "../services/sms.js";
import { verifyCaptcha } from "../services/captcha.js";
import { resolveValidity } from "../account.js";

const router = Router();

// 登录成功后统一签发：轮换单设备会话 + 带 jti 的 token
async function issueSession(req, user) {
  const jti = await rotateSession(user.id, {
    deviceInfo: req.headers["user-agent"] || null,
    ip: req.ip || null,
  });
  return signToken({ ...user, jti });
}

// ======== 自助注册（默认关闭，由 ALLOW_SELF_REGISTRATION 控制）========
router.post("/api/auth/register", async (req, res) => {
  const allowSelfReg = await getSystemSetting("ALLOW_SELF_REGISTRATION", "false");
  if (allowSelfReg !== "true") {
    return res.status(403).json({ error: "自助注册已关闭，请联系管理员开通账号" });
  }
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: "缺少用户名或密码" });
  if (String(username).length < 2) return res.status(400).json({ error: "用户名太短" });
  if (String(password).length < 6) return res.status(400).json({ error: "密码至少 6 位" });

  const exists = await dbGet("SELECT id FROM users WHERE username = ?", [username]);
  if (exists) return res.status(409).json({ error: "用户名已存在" });

  const hash = bcrypt.hashSync(password, 10);
  const r = await dbRun("INSERT INTO users(username, password_hash) VALUES(?, ?)", [username, hash]);
  const user = { id: r.lastID, username };
  const token = await issueSession(req, user);
  res.json({ user, token });
});

// 登录共用三要素校验：手机号 + 密码 + 验证码，并实时检查角色和会员有效期。
async function authenticateLogin(req, { adminOnly = false } = {}) {
  const phone = normalizePhone(req.body?.phone || req.body?.username || "");
  const { password, code } = req.body || {};
  if (!phone || !password || !code) return { status: 400, error: "请填写手机号、密码和验证码" };

  const user = await dbGet(
    "SELECT id, username, phone, password_hash, role, enterprise_id, guardian_name FROM users WHERE phone = ?",
    [phone]
  );
  if (!user) return { status: 401, error: "手机号或密码错误" };
  if (!user.password_hash) return { status: 401, error: "该账号未设置密码，请联系管理员" };
  if (!bcrypt.compareSync(password, user.password_hash)) {
    return { status: 401, error: "手机号或密码错误" };
  }

  if (adminOnly && !["boss", "operator"].includes(user.role)) {
    return { status: 403, error: "⛔ 仅 boss 和运营账号可登录管理后台" };
  }

  // 验证码校验（消费，防重放）
  const v = await verifyCode(phone, String(code).trim(), { consume: true });
  if (!v.ok) return { status: 400, error: v.error || "验证码错误" };

  // 会员有效期校验（登录时即拦截，给出明确提示）
  const validity = await resolveValidity(user.id);
  if (!validity.valid) {
    return { status: 403, error: "账号已到期或被停用，请联系管理员", code: validity.reason, validUntil: validity.until };
  }

  const token = await issueSession(req, user);
  return { user, token, adminOnly };
}

function loginResponse(result) {
  return {
    user: {
      id: result.user.id,
      username: result.user.username || result.user.phone,
      phone: result.user.phone,
      guardianName: result.user.guardian_name,
      role: result.user.role || "watcher",
      enterpriseId: result.user.enterprise_id || null,
      isProfileComplete: result.adminOnly ? true : !!result.user.guardian_name,
    },
    token: result.token,
  };
}

// ======== 主登录：手机号 + 密码 + 验证码（三要素，单设备）========
router.post("/api/auth/login", async (req, res) => {
  const result = await authenticateLogin(req);
  if (result.error) return res.status(result.status).json({ error: result.error, ...(result.code ? { code: result.code, validUntil: result.validUntil } : {}) });
  res.json(loginResponse(result));
});

// ======== 开发环境显式启用的登录（不读取数据库默认密钥）========
router.post("/api/auth/dev-login", async (req, res) => {
  if (process.env.NODE_ENV !== "development" || process.env.ENABLE_DEV_LOGIN !== "true" || !process.env.DEV_LOGIN_KEY || process.env.DEV_LOGIN_KEY.length < 32 || process.env.DEV_LOGIN_KEY === "sj0127wqt") {
    return res.status(404).json({ error: "接口不存在" });
  }
  const { key } = req.body || {};
  if (!key) return res.status(400).json({ error: "缺少密钥" });
  if (key !== process.env.DEV_LOGIN_KEY) return res.status(401).json({ error: "开发者密钥错误" });

  const username = "dev_user";
  let user = await dbGet("SELECT id, username, role FROM users WHERE username = ?", [username]);
  if (!user) {
    const hash = bcrypt.hashSync("dev123456", 10);
    const r = await dbRun("INSERT INTO users(username, password_hash, role) VALUES(?, ?, 'boss')", [username, hash]);
    user = { id: r.lastID, username, role: "boss" };
  } else if (user.role !== "boss") {
    await dbRun("UPDATE users SET role='boss' WHERE id=?", [user.id]);
    user.role = "boss";
  }

  const token = await issueSession(req, user);
  res.json({ user: { id: user.id, username: user.username, role: user.role, isProfileComplete: true }, token });
});

// ======== 管理后台登录（boss/operator，完整三要素验证）========
router.post("/api/auth/admin-login", async (req, res) => {
  const result = await authenticateLogin(req, { adminOnly: true });
  if (result.error) return res.status(result.status).json({ error: result.error, ...(result.code ? { code: result.code, validUntil: result.validUntil } : {}) });
  res.json(loginResponse(result));
});

// ======== 短信验证码：发送 ========
router.post("/api/auth/sms/send", async (req, res) => {
  const phone = normalizePhone(req.body?.phone || req.body?.mobile);
  if (!phone) return res.status(400).json({ error: "缺少手机号" });
  if (phone.length < 6) return res.status(400).json({ error: "手机号格式不正确" });

  // ① 人机校验（CAPTCHA_ENABLED 时强制；未启用则放行并告警）
  const cap = await verifyCaptcha({
    ticket: req.body?.captchaTicket,
    randstr: req.body?.captchaRandstr,
    ip: req.ip,
  });
  if (!cap.ok) return res.status(400).json({ error: cap.error || "人机验证失败" });

  // ②③ 限流 + 发送（限流对 Bmob 真实分支同样生效，验证码 5 分钟过期、用一次即失效）
  const result = await sendCode(phone, req.ip);
  if (!result.ok) return res.status(result.status || 400).json({ error: result.error });

  if (result.mockCode) {
    return res.json({
      ok: true,
      mockCode: result.mockCode, // 开发环境直接返回
      expiresInSeconds: result.expiresInSeconds,
      message: "开发环境模拟短信已发送",
    });
  }
  res.json({ ok: true, smsId: result.smsId });
});

// ======== 短信验证码：预校验（不签发 token、不消费）========
// 登录已改为三要素（在 /api/auth/login 内校验验证码），此端点仅作前端可选的预校验。
router.post("/api/auth/sms/verify", async (req, res) => {
  const phone = normalizePhone(req.body?.phone || req.body?.mobile);
  const code = String(req.body?.code || "").trim();
  if (!phone || !code) return res.status(400).json({ error: "手机号或验证码缺失" });

  const v = await verifyCode(phone, code, { consume: false });
  if (!v.ok) return res.status(400).json({ error: v.error });
  res.json({ ok: true });
});

// ======== 忘记密码：手机号 + 验证码 重置密码 ========
// 前端流程：先调 /api/auth/sms/send 拿验证码，再带 phone+code+password 调本接口。
// 要求：手机号必须为已注册账号，验证码校验通过后才允许修改密码。
router.post("/api/auth/reset-password", async (req, res) => {
  const phone = normalizePhone(req.body?.phone || "");
  const { code, password } = req.body || {};
  if (!phone) return res.status(400).json({ error: "请输入手机号" });
  if (!code) return res.status(400).json({ error: "请输入验证码" });
  if (!password || String(password).length < 6) {
    return res.status(400).json({ error: "新密码至少 6 位" });
  }

  // ① 手机号必须是已有账号
  const user = await dbGet("SELECT id, phone FROM users WHERE phone = ?", [phone]);
  if (!user) return res.status(404).json({ error: "该手机号未注册，请检查后重试或注册新账号" });

  // ② 验证码校验（消费，防重放）
  const v = await verifyCode(phone, String(code).trim(), { consume: true });
  if (!v.ok) return res.status(400).json({ error: v.error || "验证码错误" });

  // ③ 更新密码 + 撤销所有在线会话（强制用新密码重新登录）
  const hash = bcrypt.hashSync(String(password), 10);
  await dbRun("UPDATE users SET password_hash = ? WHERE id = ?", [hash, user.id]);
  await revokeUserSessions(user.id);

  res.json({ ok: true, message: "密码已重置，请用新密码登录" });
});

// ======== 登出：撤销当前会话 ========
router.post("/api/auth/logout", async (req, res) => {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (token) {
    try {
      const payload = jwt.verify(token, config.JWT_SECRET || "dev_secret_change_me");
      await revokeSession(payload.jti);
    } catch (_) {
      /* token 无效/过期，登出视为成功 */
    }
  }
  res.json({ ok: true });
});

// ======== 邀请码注册 ========
router.post("/api/auth/register-with-invite", async (req, res) => {
  const { code, phone, realName, nickname, password } = req.body || {};
  if (!code) return res.status(400).json({ error: "请输入邀请码" });
  if (!phone || normalizePhone(phone).length < 6) return res.status(400).json({ error: "请输入正确的手机号" });
  if (!realName || String(realName).trim().length < 1) return res.status(400).json({ error: "请输入真实姓名" });
  if (!nickname || String(nickname).trim().length < 1) return res.status(400).json({ error: "请输入昵称" });
  if (!password || String(password).length < 6) return res.status(400).json({ error: "密码至少 6 位" });

  const cleanPhone = normalizePhone(phone);

  try {
    const invite = await dbGet("SELECT * FROM invite_codes WHERE code = ? AND status = 'active'", [code.toUpperCase()]);
    if (!invite) return res.status(400).json({ error: "邀请码无效" });
    if (Date.now() > invite.expires_at) return res.status(400).json({ error: "邀请码已过期" });
    if (invite.used_count >= invite.max_uses) return res.status(400).json({ error: "邀请码已用完" });

    const exists = await dbGet("SELECT id FROM users WHERE phone = ?", [cleanPhone]);
    if (exists) return res.status(409).json({ error: "该手机号已注册" });

    let enterpriseId = null;
    if (invite.type === "organization" && invite.organization_id) {
      const org = await dbGet("SELECT * FROM organizations WHERE id = ? AND status = 'active'", [invite.organization_id]);
      if (!org) return res.status(400).json({ error: "邀请码关联的组织不存在或已停用" });
      const memberCount = await dbGet("SELECT COUNT(*) as cnt FROM users WHERE enterprise_id = ?", [org.id]);
      if (memberCount.cnt >= org.max_members) return res.status(400).json({ error: "该组织成员已满" });
      enterpriseId = org.id;
    }

    const hash = bcrypt.hashSync(password, 10);
    const r = await dbRun(
      `INSERT INTO users(phone, real_name, guardian_name, password_hash, role, enterprise_id, is_profile_complete)
       VALUES(?, ?, ?, ?, 'watcher', ?, 1)`,
      [cleanPhone, realName.trim(), nickname.trim(), hash, enterpriseId]
    );

    await dbRun("UPDATE invite_codes SET used_count = used_count + 1 WHERE id = ?", [invite.id]);

    const user = { id: r.lastID, username: cleanPhone, phone: cleanPhone, role: "watcher", enterprise_id: enterpriseId };
    const token = await issueSession(req, user);

    res.json({
      ok: true,
      user: {
        id: user.id,
        username: cleanPhone,
        phone: cleanPhone,
        realName: realName.trim(),
        guardianName: nickname.trim(),
        role: "watcher",
        enterpriseId,
        isProfileComplete: true,
      },
      token,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ======== 完善用户资料 ========
router.post("/api/auth/complete-profile", authMiddleware, async (req, res) => {
  const { guardianName, realName, password } = req.body || {};
  if (!guardianName || String(guardianName).trim().length < 1) {
    return res.status(400).json({ error: "请输入守望师名字" });
  }

  const userId = req.user.uid;
  const updateFields = ["guardian_name = ?", "is_profile_complete = 1"];
  const updateValues = [String(guardianName).trim()];

  if (realName && String(realName).trim()) {
    updateFields.push("real_name = ?");
    updateValues.push(String(realName).trim());
  }
  if (password) {
    if (password.length < 6) return res.status(400).json({ error: "密码至少需要6位" });
    updateFields.push("password_hash = ?");
    updateValues.push(bcrypt.hashSync(password, 10));
  }
  updateValues.push(userId);

  await dbRun(`UPDATE users SET ${updateFields.join(", ")} WHERE id = ?`, updateValues);

  const user = await dbGet("SELECT id, username, phone, guardian_name, real_name FROM users WHERE id = ?", [userId]);
  res.json({
    user: {
      id: user.id,
      username: user.username || user.phone,
      phone: user.phone,
      guardianName: user.guardian_name,
      realName: user.real_name,
      isProfileComplete: true,
    },
  });
});

export default router;
