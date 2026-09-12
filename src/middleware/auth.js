import jwt from "jsonwebtoken";
import { config } from "../config.js";
import { isSessionValid, touchSession } from "../services/sessions.js";
import { resolveValidity } from "../account.js";
import { dbGet } from "../db.js";

// JWT 签发：7 天有效，携带 role / enterpriseId / jti(单设备会话) / env(环境标记)
export function signToken(user) {
  const SERVER_ENV = config.SERVER_ENV || "prod";
  const JWT_SECRET = config.JWT_SECRET || "dev_secret_change_me";
  return jwt.sign(
    {
      uid: user.id,
      username: user.username,
      role: user.role || "watcher",
      enterpriseId: user.enterprise_id || null,
      jti: user.jti || null,
      env: SERVER_ENV,
    },
    JWT_SECRET,
    { expiresIn: "7d" }
  );
}

/**
 * 鉴权中间件，四道关卡：
 *   1. Bearer token 存在且签名有效
 *   2. 环境标记匹配（ENV_MISMATCH）
 *   3. 单设备会话有效：token 的 jti 必须是该用户当前会话（SESSION_REVOKED）
 *   4. 会员有效期：账号/组织未到期、未停用（ORG_EXPIRED / ACCOUNT_EXPIRED / ...）
 */
export async function authMiddleware(req, res, next) {
  const SERVER_ENV = config.SERVER_ENV || "prod";
  const JWT_SECRET = config.JWT_SECRET || "dev_secret_change_me";
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ error: "未登录" });

  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch (e) {
    return res.status(401).json({ error: "登录已过期，请重新登录" });
  }

  // 环境标记
  if (payload.env && payload.env !== SERVER_ENV) {
    return res.status(401).json({ error: "你已在其他环境登录，请重新登录", code: "ENV_MISMATCH" });
  }

  // 单设备：token 的 jti 必须是该用户当前有效会话（旧 token 无 jti → 失效）
  const sessionOk = await isSessionValid(payload.uid, payload.jti);
  if (!sessionOk) {
    return res.status(401).json({ error: "账号已在其他设备登录或会话已失效，请重新登录", code: "SESSION_REVOKED" });
  }

  // 会员有效期
  const validity = await resolveValidity(payload.uid);
  if (!validity.valid) {
    return res.status(403).json({ error: "账号已到期或被停用，请联系管理员", code: validity.reason, validUntil: validity.until });
  }

  const current = await dbGet("SELECT role, enterprise_id FROM users WHERE id = ?", [payload.uid]);
  if (!current) return res.status(401).json({ error: "账号不存在" });
  req.user = { ...payload, role: current.role, enterpriseId: current.enterprise_id || null };
  req.accountValidity = validity;
  touchSession(payload.jti).catch(() => {});
  next();
}
