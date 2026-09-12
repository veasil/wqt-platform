import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import fetch from "node-fetch";
import fs, { promises as fsPromises } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { dbRun, dbGet, dbAll, saveSmsCode, verifySmsCode, addGameEvent, getGameEvents, getSystemSetting, getAllSettings } from "./db.js";
import { cardsDbRun, cardsDbGet, cardsDbAll } from "./cards-db.js";
import { BmobSMS } from "./bmob.js";
import { config as defaultConfig, decryptVal } from "./config.js";
import { authMiddleware } from "./middleware/auth.js";
import { requireRole, requireEnterprise } from "./middleware/rbac.js";
import { resolveValidity } from "./account.js";
import { normalizePhone } from "./services/sms.js";
import { generateWithDashScope, generateWithToApis } from "./services/image-generation.js";
import authRouter from "./routes/auth.routes.js";
import accountAdminRouter from "./routes/account-admin.routes.js";
import adminDataRouter from "./routes/admin-data.routes.js";
import multer from "multer";
import crypto from "crypto";
import { ROOT_DIR } from "./paths.js";
export function createApp({ runtimeConfig = defaultConfig, ossClient = null } = {}) {
  const config = runtimeConfig;
  const app = express();
  const JWT_SECRET = config.JWT_SECRET || "dev_secret_change_me";
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });






// 信任反向代理（Zeabur/nginx），让 req.ip 取到真实客户端 IP——短信接口 IP 限流依赖它
  app.set("trust proxy", 1);

// ======== 安全响应头 (HSTS / CSP / X-Frame-Options 等) ========
// CSP 白名单按前端实际加载的外部资源收敛：
//   - script: cdn.jsdelivr.net (html2canvas)；内联脚本/事件处理器较多，暂放 'unsafe-inline'，后续可改 nonce
//   - style:   fonts.googleapis.com；内联 <style> 普遍，放 'unsafe-inline'
//   - font:    fonts.gstatic.com (Google Fonts 实际字体文件)
//   - img/media: 阿里云 OSS 香港桶（卡面/音频）；img 另含 data: (LLM 文生图返回 base64)
//   - connect: 仅同源（前端不直连外部 API，LLM/OSS 都走后端代理）
  app.use(helmet({
  // 关闭 COEP：OSS/jsdelivr/gstatic 不发 CORP 头，require-corp 会把这些图片/脚本/字体全部拦掉
  crossOriginEmbedderPolicy: false,
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      "default-src": ["'self'"],
      "script-src": ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
      // helmet 默认带 script-src-attr 'none' 会屏蔽所有 onclick=/onsubmit= 等内联事件处理器
      // (index.html/my.html 等大量用到)，显式放开与 script-src 同等放宽，保持现状不破
      "script-src-attr": ["'unsafe-inline'"],
      "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      "font-src": ["'self'", "https://fonts.gstatic.com"],
      "img-src": ["'self'", "data:", "https://ai5000days-scoring-system-hk.oss-cn-hongkong.aliyuncs.com"],
      "media-src": ["'self'", "https://ai5000days-scoring-system-hk.oss-cn-hongkong.aliyuncs.com"],
      "connect-src": ["'self'"],
      "frame-ancestors": ["'none'"],
      "object-src": ["'none'"],
      "base-uri": ["'self'"],
      "form-action": ["'self'"],
    },
  },
  // frame-ancestors 'none' 已覆盖；X-Frame-Options 留 DENY 作为旧浏览器回退
  xFrameOptions: { action: "deny" },
  // HSTS：max-age 1 年，含子域
  strictTransportSecurity: { maxAge: 31536000, includeSubDomains: true, preload: true },
  referrerPolicy: { policy: "strict-origin-when-cross-origin" },
}));

  app.use(morgan("dev"));
// 复盘报告内嵌大量 base64 图片（卡面/插画/品牌 banner），单独放宽该路由的 body 上限；
// 其余接口仍走 2mb 全局限制（此中间件先于全局解析，express.json 解析后会 skip 重复解析）。
  app.use("/api/upload/report", express.json({ limit: "16mb" }));
  app.use(express.json({ limit: "2mb" }));

// 本地开发：同域访问最省事；如果你前后端分离，这里把 origin 改成你的前端地址
  app.use(cors({
  origin: true,
  credentials: false
}));

// 静态资源
const __filename = fileURLToPath(import.meta.url);
const __dirname = ROOT_DIR;
  app.use(express.static(path.join(ROOT_DIR, "public")));

// 组织管理前端 SPA
const enterpriseDist = path.join(ROOT_DIR, "enterprise-panel", "dist");
  app.use("/enterprise", express.static(enterpriseDist));
  app.get("/enterprise/*", (req, res, next) => {
  if (req.path.startsWith("/enterprise/api")) return next();
  res.sendFile(path.join(enterpriseDist, "index.html"), err => { if (err) next(); });
});

// 中台管理前端 SPA（admin-web，替代 Streamlit）
const adminWebDist = path.join(ROOT_DIR, "admin-web", "dist");
  app.use("/admin", express.static(adminWebDist));
  app.get("/admin/*", (req, res, next) => {
  if (req.path.startsWith("/admin/api")) return next();
  res.sendFile(path.join(adminWebDist, "index.html"), err => { if (err) next(); });
});



// ======== API: 数据库测试 ========
  app.get("/api/db/test", async (req, res) => {
  // ... (omitted for brevity)
});

// ======== API: System Settings ========
  app.get("/api/settings", async (req, res) => {
  try {
    const settings = await getAllSettings();
    // 过滤掉敏感或不适合前端直接看到的配置（如果有的话）
    // 目前全部返回
    res.json({ ok: true, settings });
  } catch (e) {
    res.status(500).json({ error: "Failed to fetch settings" });
  }
});


  app.get("/api/me", authMiddleware, async (req, res) => {
  try {
    const user = await dbGet(
      "SELECT id, username, phone, real_name, guardian_name, role, watcher_level, enterprise_id FROM users WHERE id = ?",
      [req.user.uid]
    );
    if (!user) return res.status(404).json({ error: "用户不存在" });

    // 会员期限：组织成员跟随组织、独立用户用自身 valid_until（resolveValidity 统一判定）
    const validity = await resolveValidity(req.user.uid);

    res.json({
      user: {
        id: user.id,
        username: user.username || user.phone,
        phone: user.phone,
        realName: user.real_name || null,
        guardianName: user.guardian_name,
        isProfileComplete: !!user.guardian_name,
        role: user.role || 'watcher',
        watcherLevel: user.watcher_level || 'initial',
        enterpriseId: user.enterprise_id || null,
        validUntil: validity.until ?? null,
        validityValid: validity.valid,
        validitySource: user.enterprise_id ? 'org' : 'user'
      }
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 我的活动列表
  app.get("/api/me/activities", authMiddleware, async (req, res) => {
  const uid = req.user.uid;
  try {
    const rows = await dbAll(`
      SELECT a.id, a.name, a.activity_code, a.started_at, a.ended_at,
             as2.table_no, gs.final_score, gs.started_at as session_started,
             gs.ended_at as session_ended, gs.id as session_id
      FROM activity_sessions as2
      JOIN activities a ON a.id = as2.activity_id
      JOIN game_sessions gs ON gs.id = as2.session_id
      WHERE gs.user_id = ?
      ORDER BY gs.started_at DESC
    `, [uid]);
    res.json({ activities: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 我发起/申请的活动（含审核状态）。status: pending_approval | active | ...
  app.get("/api/me/activities/created", authMiddleware, async (req, res) => {
  const uid = req.user.uid;
  try {
    const rows = await dbAll(`
      SELECT a.id, a.name, a.organizer, a.activity_code, a.started_at, a.ended_at, a.status, a.created_at,
             COUNT(DISTINCT as2.session_id) as table_count
      FROM activities a
      LEFT JOIN activity_sessions as2 ON as2.activity_id = a.id
      WHERE a.created_by = ?
      GROUP BY a.id
      ORDER BY a.created_at DESC
    `, [uid]);
    res.json({ activities: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 提交感想/反馈
  app.post("/api/me/feedback", authMiddleware, async (req, res) => {
  const uid = req.user.uid;
  const { type = 'reflection', content, activity_id, session_id } = req.body || {};
  if (!content || !String(content).trim()) return res.status(400).json({ error: "内容不能为空" });
  try {
    const result = await dbRun(
      "INSERT INTO user_feedback(user_id, type, content, activity_id, session_id) VALUES(?,?,?,?,?)",
      [uid, type, content.trim(), activity_id || null, session_id || null]
    );
    res.json({ ok: true, id: result.lastID });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 提交升级申请
  app.post("/api/me/level-application", authMiddleware, async (req, res) => {
  const uid = req.user.uid;
  const { reason } = req.body || {};
  try {
    const user = await dbGet("SELECT watcher_level FROM users WHERE id = ?", [uid]);
    if (!user) return res.status(404).json({ error: "用户不存在" });

    // 检查是否已有 pending 申请
    const existing = await dbGet(
      "SELECT id FROM watcher_level_applications WHERE user_id = ? AND status = 'pending'", [uid]
    );
    if (existing) return res.status(400).json({ error: "已有待审核的申请，请等待" });

    const levelMap = { initial: 'advanced', advanced: 'mentor' };
    const toLevel = levelMap[user.watcher_level];
    if (!toLevel) return res.status(400).json({ error: "已是最高等级，无需申请" });

    const result = await dbRun(
      "INSERT INTO watcher_level_applications(user_id, from_level, to_level, reason) VALUES(?,?,?,?)",
      [uid, user.watcher_level, toLevel, reason || null]
    );
    res.json({ ok: true, id: result.lastID, fromLevel: user.watcher_level, toLevel });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 查询升级申请状态
  app.get("/api/me/level-application", authMiddleware, async (req, res) => {
  const uid = req.user.uid;
  try {
    const row = await dbGet(
      "SELECT * FROM watcher_level_applications WHERE user_id = ? ORDER BY created_at DESC LIMIT 1",
      [uid]
    );
    res.json({ application: row || null });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 修改密码
  app.put("/api/me/password", authMiddleware, async (req, res) => {
  const { oldPassword, newPassword } = req.body || {};
  if (!newPassword || String(newPassword).length < 6) return res.status(400).json({ error: "新密码至少 6 位" });
  try {
    const user = await dbGet("SELECT password_hash FROM users WHERE id = ?", [req.user.uid]);
    if (!user) return res.status(404).json({ error: "用户不存在" });
    // 如果用户已有密码，必须验证旧密码
    if (user.password_hash) {
      if (!oldPassword) return res.status(400).json({ error: "请输入旧密码" });
      if (!bcrypt.compareSync(oldPassword, user.password_hash)) return res.status(401).json({ error: "旧密码错误" });
    }
    const hash = bcrypt.hashSync(newPassword, 10);
    await dbRun("UPDATE users SET password_hash = ? WHERE id = ?", [hash, req.user.uid]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 更新个人信息（已登录用户编辑资料）
  app.put("/api/me/profile", authMiddleware, async (req, res) => {
  const { guardianName, realName } = req.body || {};
  const userId = req.user.uid;

  const updateFields = [];
  const updateValues = [];

  if (guardianName && String(guardianName).trim()) {
    updateFields.push("guardian_name = ?");
    updateValues.push(String(guardianName).trim());
  }
  if (realName && String(realName).trim()) {
    updateFields.push("real_name = ?");
    updateValues.push(String(realName).trim());
  }

  if (updateFields.length === 0) {
    return res.status(400).json({ error: "没有需要更新的字段" });
  }

  try {
    updateValues.push(userId);
    await dbRun(`UPDATE users SET ${updateFields.join(", ")} WHERE id = ?`, updateValues);

    const user = await dbGet("SELECT id, username, phone, guardian_name, real_name, role, enterprise_id FROM users WHERE id = ?", [userId]);
    res.json({
      user: {
        id: user.id,
        username: user.username || user.phone,
        phone: user.phone,
        realName: user.real_name || null,
        guardianName: user.guardian_name,
        role: user.role,
        enterpriseId: user.enterprise_id || null
      }
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 我的游戏场次列表（排除废弃的空场次）
  app.get("/api/me/sessions", authMiddleware, async (req, res) => {
  const uid = req.user.uid;
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const offset = Number(req.query.offset) || 0;

  try {
    const rows = await dbAll(
      `SELECT id, started_at, ended_at, final_score, game_mode, status, payload_json
       FROM game_sessions WHERE user_id = ? AND status != 'abandoned'
       ORDER BY started_at DESC LIMIT ? OFFSET ?`,
      [uid, limit, offset]
    );
    const total = await dbGet(
      "SELECT COUNT(*) as cnt FROM game_sessions WHERE user_id = ? AND status != 'abandoned'",
      [uid]
    );
    res.json({ sessions: rows, total: total.cnt });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 我的 OSS 文件列表（录音 + 复盘报告）
  app.get("/api/me/files", authMiddleware, async (req, res) => {
  if (!ossClient) return res.status(500).json({ error: "服务器未配置 OSS" });

  const uid = req.user.uid;
  const customDomain = process.env.ALIYUN_OSS_CUSTOM_DOMAIN
    ? process.env.ALIYUN_OSS_CUSTOM_DOMAIN.replace(/\/$/, "")
    : null;

  try {
    const files = [];

    // 列出录音文件
    const audioResult = await ossClient.list({ prefix: `game-audio/user_${uid}_`, 'max-keys': 100 });
    if (audioResult.objects) {
      for (const obj of audioResult.objects) {
        files.push({
          name: obj.name.split('/').pop(),
          key: obj.name,
          type: 'audio',
          size: obj.size,
          lastModified: obj.lastModified,
          url: customDomain ? `${customDomain}/${obj.name}` : obj.url
        });
      }
    }

    // 列出复盘报告
    const reportResult = await ossClient.list({ prefix: `game-review/report_${uid}_`, 'max-keys': 100 });
    if (reportResult.objects) {
      for (const obj of reportResult.objects) {
        files.push({
          name: obj.name.split('/').pop(),
          key: obj.name,
          type: obj.name.endsWith('.html') ? 'report_html' : 'report_md',
          size: obj.size,
          lastModified: obj.lastModified,
          url: customDomain ? `${customDomain}/${obj.name}` : obj.url
        });
      }
    }

    // 按时间倒序
    files.sort((a, b) => new Date(b.lastModified) - new Date(a.lastModified));
    res.json({ files });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ======== API: Boss 组织管理 ========

// 创建组织 + 组织管理员账号
  app.post("/api/admin/organizations", authMiddleware, requireRole('boss'), async (req, res) => {
  const { orgName, description, maxMembers, adminPhone, adminName, adminPassword } = req.body || {};
  if (!orgName) return res.status(400).json({ error: "组织名称不能为空" });
  if (!adminPhone) return res.status(400).json({ error: "管理员手机号不能为空" });
  const cleanPhone = normalizePhone(adminPhone);
  if (cleanPhone.length < 6) return res.status(400).json({ error: "管理员手机号格式不正确" });

  try {
    // 检查手机号是否已关联其他组织
    const existingUser = await dbGet("SELECT id, enterprise_id, role FROM users WHERE phone = ?", [cleanPhone]);
    if (existingUser && (existingUser.role === 'boss' || existingUser.role === 'operator')) {
      return res.status(409).json({ error: "该账号已是系统管理员（boss/运营），不能作为组织管理员" });
    }
    if (existingUser && existingUser.enterprise_id) {
      return res.status(409).json({ error: "该手机号已关联其他组织" });
    }

    // 创建组织
    const orgResult = await dbRun(
      "INSERT INTO organizations(name, description, max_members, owner_user_id) VALUES(?,?,?,?)",
      [orgName, description || null, maxMembers || 50, 0] // owner_user_id 先占位
    );
    const orgId = orgResult.lastID;

    let adminUserId;
    if (existingUser) {
      // 已有账号：升级为组织管理员
      await dbRun("UPDATE users SET role='enterprise', enterprise_id=? WHERE id=?", [orgId, existingUser.id]);
      adminUserId = existingUser.id;
    } else {
      // 创建新用户
      const defaultPwd = adminPassword || cleanPhone.slice(-6);
      const hash = bcrypt.hashSync(defaultPwd, 10);
      const r = await dbRun(
        "INSERT INTO users(phone, guardian_name, real_name, password_hash, role, enterprise_id, is_profile_complete) VALUES(?,?,?,?,'enterprise',?,1)",
        [cleanPhone, adminName || null, adminName || null, hash, orgId]
      );
      adminUserId = r.lastID;
    }

    // 回填 owner_user_id
    await dbRun("UPDATE organizations SET owner_user_id=? WHERE id=?", [adminUserId, orgId]);

    res.json({
      ok: true,
      organization: { id: orgId, name: orgName, maxMembers: maxMembers || 50 },
      adminUser: { id: adminUserId, phone: cleanPhone, role: 'enterprise' }
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 列出所有组织
  app.get("/api/admin/organizations", authMiddleware, requireRole('boss'), async (req, res) => {
  try {
    const rows = await dbAll(`
      SELECT o.*,
        (SELECT COUNT(*) FROM users WHERE enterprise_id = o.id) as current_members,
        u.guardian_name as owner_name, u.phone as owner_phone
      FROM organizations o
      LEFT JOIN users u ON u.id = o.owner_user_id
      ORDER BY o.created_at DESC
    `);
    res.json({ organizations: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 更新组织
  app.put("/api/admin/organizations/:id", authMiddleware, requireRole('boss'), async (req, res) => {
  const { name, description, maxMembers, status } = req.body || {};
  try {
    const org = await dbGet("SELECT * FROM organizations WHERE id = ?", [req.params.id]);
    if (!org) return res.status(404).json({ error: "组织不存在" });
    await dbRun(
      "UPDATE organizations SET name=?, description=?, max_members=?, status=?, updated_at=? WHERE id=?",
      [name || org.name, description ?? org.description, maxMembers || org.max_members,
       status || org.status, Date.now(), req.params.id]
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 停用组织
  app.delete("/api/admin/organizations/:id", authMiddleware, requireRole('boss'), async (req, res) => {
  try {
    await dbRun("UPDATE organizations SET status='suspended', updated_at=? WHERE id=?", [Date.now(), req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Boss 给组织加人
  app.post("/api/admin/organizations/:id/members", authMiddleware, requireRole('boss'), async (req, res) => {
  const orgId = Number(req.params.id);
  const { phone, guardianName, realName, password } = req.body || {};
  if (!phone) return res.status(400).json({ error: "手机号不能为空" });
  const cleanPhone = normalizePhone(phone);

  try {
    const org = await dbGet("SELECT * FROM organizations WHERE id = ? AND status = 'active'", [orgId]);
    if (!org) return res.status(404).json({ error: "组织不存在或已停用" });

    // 检查配额
    const memberCount = await dbGet("SELECT COUNT(*) as cnt FROM users WHERE enterprise_id = ?", [orgId]);
    if (memberCount.cnt >= org.max_members) return res.status(400).json({ error: "组织成员已满" });

    // 检查手机号
    const exists = await dbGet("SELECT id, enterprise_id FROM users WHERE phone = ?", [cleanPhone]);
    if (exists && exists.enterprise_id) return res.status(409).json({ error: "该手机号已关联组织" });

    if (exists) {
      await dbRun("UPDATE users SET enterprise_id=? WHERE id=?", [orgId, exists.id]);
      res.json({ ok: true, user: { id: exists.id, phone: cleanPhone } });
    } else {
      const defaultPwd = password || cleanPhone.slice(-6);
      const hash = bcrypt.hashSync(defaultPwd, 10);
      const r = await dbRun(
        "INSERT INTO users(phone, guardian_name, real_name, password_hash, role, enterprise_id, is_profile_complete) VALUES(?,?,?,?,'watcher',?,1)",
        [cleanPhone, guardianName || null, realName || null, hash, orgId]
      );
      res.json({ ok: true, user: { id: r.lastID, phone: cleanPhone } });
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ======== Boss 邀请码管理 ========
  app.post("/api/admin/invite-codes", authMiddleware, requireRole('boss'), async (req, res) => {
  const { maxUses, expiresInDays, organizationId } = req.body || {};
  try {
    const code = await generateInviteCode();
    const expiresAt = Date.now() + (expiresInDays || 3) * 24 * 60 * 60 * 1000;
    const type = organizationId ? 'organization' : 'general';
    const result = await dbRun(
      "INSERT INTO invite_codes(code, type, organization_id, created_by, max_uses, expires_at) VALUES(?,?,?,?,?,?)",
      [code, type, organizationId || null, req.user.uid, maxUses || 1, expiresAt]
    );
    res.json({ ok: true, id: result.lastID, code, type, expiresAt });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

  app.get("/api/admin/invite-codes", authMiddleware, requireRole('boss'), async (req, res) => {
  try {
    const rows = await dbAll(`
      SELECT ic.*, o.name as org_name, u.guardian_name as creator_name
      FROM invite_codes ic
      LEFT JOIN organizations o ON o.id = ic.organization_id
      LEFT JOIN users u ON u.id = ic.created_by
      ORDER BY ic.created_at DESC
    `);
    res.json({ codes: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ======== API: 组织管理员端点 ========

// 获取本组织信息
  app.get("/api/enterprise/info", authMiddleware, requireEnterprise, async (req, res) => {
  try {
    const memberCount = await dbGet("SELECT COUNT(*) as cnt FROM users WHERE enterprise_id = ?", [req.org.id]);
    res.json({
      organization: {
        id: req.org.id,
        name: req.org.name,
        description: req.org.description,
        maxMembers: req.org.max_members,
        currentMembers: memberCount.cnt,
        createdAt: req.org.created_at,
        validUntil: req.org.valid_until,
        status: req.org.status
      }
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 列出本组织成员
  app.get("/api/enterprise/members", authMiddleware, requireEnterprise, async (req, res) => {
  try {
    const members = await dbAll(`
      SELECT u.id, u.username, u.phone, u.real_name, u.guardian_name, u.watcher_level, u.created_at,
        (SELECT MAX(gs.started_at) FROM game_sessions gs WHERE gs.user_id = u.id) as last_active,
        (SELECT COUNT(*) FROM game_sessions gs WHERE gs.user_id = u.id) as total_games
      FROM users u
      WHERE u.enterprise_id = ? AND u.id != ?
      ORDER BY u.created_at DESC
    `, [req.org.id, req.user.uid]);
    const memberCount = await dbGet("SELECT COUNT(*) as cnt FROM users WHERE enterprise_id = ?", [req.org.id]);
    res.json({
      members,
      quota: { max: req.org.max_members, used: memberCount.cnt }
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 创建成员账号
  app.post("/api/enterprise/members", authMiddleware, requireEnterprise, async (req, res) => {
  const { phone, guardianName, realName, password } = req.body || {};
  if (!phone) return res.status(400).json({ error: "手机号不能为空" });
  const cleanPhone = normalizePhone(phone);

  try {
    // 检查配额
    const memberCount = await dbGet("SELECT COUNT(*) as cnt FROM users WHERE enterprise_id = ?", [req.org.id]);
    if (memberCount.cnt >= req.org.max_members) return res.status(400).json({ error: "成员已达上限" });

    const exists = await dbGet("SELECT id, enterprise_id FROM users WHERE phone = ?", [cleanPhone]);
    if (exists && exists.enterprise_id) return res.status(409).json({ error: "该手机号已关联组织" });
    if (exists) {
      await dbRun("UPDATE users SET enterprise_id=? WHERE id=?", [req.org.id, exists.id]);
      return res.json({ ok: true, user: { id: exists.id, phone: cleanPhone } });
    }

    const defaultPwd = password || cleanPhone.slice(-6);
    const hash = bcrypt.hashSync(defaultPwd, 10);
    const r = await dbRun(
      "INSERT INTO users(phone, guardian_name, real_name, password_hash, role, enterprise_id, is_profile_complete) VALUES(?,?,?,?,'watcher',?,1)",
      [cleanPhone, guardianName || null, realName || null, hash, req.org.id]
    );
    res.json({ ok: true, user: { id: r.lastID, phone: cleanPhone } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 修改成员
  app.put("/api/enterprise/members/:id", authMiddleware, requireEnterprise, async (req, res) => {
  const memberId = req.params.id;
  const { guardianName, realName, password } = req.body || {};
  try {
    const member = await dbGet("SELECT * FROM users WHERE id = ? AND enterprise_id = ?", [memberId, req.org.id]);
    if (!member) return res.status(404).json({ error: "成员不存在或不属于本组织" });

    const updates = [];
    const params = [];
    if (guardianName !== undefined) { updates.push("guardian_name=?"); params.push(guardianName); }
    if (realName !== undefined) { updates.push("real_name=?"); params.push(realName); }
    if (password) { updates.push("password_hash=?"); params.push(bcrypt.hashSync(password, 10)); }
    if (updates.length === 0) return res.status(400).json({ error: "无更新内容" });

    params.push(memberId);
    await dbRun(`UPDATE users SET ${updates.join(",")} WHERE id=?`, params);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 移除成员
  app.delete("/api/enterprise/members/:id", authMiddleware, requireEnterprise, async (req, res) => {
  try {
    const member = await dbGet("SELECT * FROM users WHERE id = ? AND enterprise_id = ?", [req.params.id, req.org.id]);
    if (!member) return res.status(404).json({ error: "成员不存在或不属于本组织" });
    await dbRun("UPDATE users SET enterprise_id = NULL WHERE id = ?", [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 单个成员统计
  app.get("/api/enterprise/members/:id/stats", authMiddleware, requireEnterprise, async (req, res) => {
  const memberId = req.params.id;
  try {
    const member = await dbGet("SELECT id, guardian_name, phone FROM users WHERE id = ? AND enterprise_id = ?", [memberId, req.org.id]);
    if (!member) return res.status(403).json({ error: "非本组织成员" });

    const sessions = await dbAll(
      "SELECT id, started_at, ended_at, final_score, game_mode FROM game_sessions WHERE user_id = ? ORDER BY started_at DESC",
      [memberId]
    );
    const totalGames = sessions.length;
    const avgScore = totalGames ? Math.round(sessions.reduce((s, r) => s + (r.final_score || 0), 0) / totalGames) : 0;
    res.json({ member, stats: { totalGames, avgScore, sessions } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 组织级统计
  app.get("/api/enterprise/dashboard", authMiddleware, requireEnterprise, async (req, res) => {
  try {
    const orgId = req.org.id;
    const totalMembers = await dbGet("SELECT COUNT(*) as cnt FROM users WHERE enterprise_id = ?", [orgId]);
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const activeMembers = await dbGet(`
      SELECT COUNT(DISTINCT gs.user_id) as cnt FROM game_sessions gs
      JOIN users u ON u.id = gs.user_id
      WHERE u.enterprise_id = ? AND gs.started_at > ?
    `, [orgId, thirtyDaysAgo]);
    const sessionStats = await dbGet(`
      SELECT COUNT(*) as total, ROUND(AVG(gs.final_score), 1) as avg_score
      FROM game_sessions gs JOIN users u ON u.id = gs.user_id
      WHERE u.enterprise_id = ?
    `, [orgId]);
    const recentSessions = await dbAll(`
      SELECT gs.id, gs.started_at, gs.ended_at, gs.final_score, gs.game_mode,
             u.guardian_name, u.phone
      FROM game_sessions gs JOIN users u ON u.id = gs.user_id
      WHERE u.enterprise_id = ?
      ORDER BY gs.started_at DESC LIMIT 10
    `, [orgId]);
    const membersByLevel = await dbAll(`
      SELECT watcher_level, COUNT(*) as cnt FROM users WHERE enterprise_id = ? GROUP BY watcher_level
    `, [orgId]);

    res.json({
      totalMembers: totalMembers.cnt,
      activeMembers: activeMembers.cnt,
      totalSessions: sessionStats.total,
      avgScore: sessionStats.avg_score,
      recentSessions,
      membersByLevel: Object.fromEntries(membersByLevel.map(r => [r.watcher_level, r.cnt]))
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 组织的游戏场次列表
  app.get("/api/enterprise/sessions", authMiddleware, requireEnterprise, async (req, res) => {
  const { page = 1, limit = 20, memberId, activityId } = req.query;
  try {
    let sql = `
      SELECT gs.id, gs.user_id, gs.started_at, gs.ended_at, gs.final_score, gs.game_mode,
             u.guardian_name, u.phone
      FROM game_sessions gs JOIN users u ON u.id = gs.user_id
      WHERE u.enterprise_id = ?
    `;
    const params = [req.org.id];
    if (memberId) { sql += " AND gs.user_id = ?"; params.push(Number(memberId)); }
    if (activityId) {
      sql += " AND gs.id IN (SELECT session_id FROM activity_sessions WHERE activity_id = ?)";
      params.push(Number(activityId));
    }

    // 总数
    const countSql = sql.replace(/SELECT gs\.id.*FROM/, "SELECT COUNT(*) as total FROM");
    const total = await dbGet(countSql, params);

    sql += " ORDER BY gs.started_at DESC LIMIT ? OFFSET ?";
    params.push(Number(limit), (Number(page) - 1) * Number(limit));
    const sessions = await dbAll(sql, params);

    res.json({ sessions, total: total.total, page: Number(page), limit: Number(limit) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ======== 组织管理员：活动管理 ========

  app.get("/api/enterprise/activities", authMiddleware, requireEnterprise, async (req, res) => {
  try {
    const rows = await dbAll(`
      SELECT a.*,
        COUNT(DISTINCT as2.session_id) as table_count,
        COUNT(DISTINCT gs.user_id) as participant_count,
        ROUND(AVG(gs.final_score), 1) as avg_score
      FROM activities a
      LEFT JOIN activity_sessions as2 ON as2.activity_id = a.id
      LEFT JOIN game_sessions gs ON gs.id = as2.session_id
      WHERE a.enterprise_id = ?
      GROUP BY a.id
      ORDER BY a.created_at DESC
    `, [req.org.id]);
    res.json({ activities: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

  app.post("/api/enterprise/activities", authMiddleware, requireEnterprise, async (req, res) => {
  const { name, organizer, started_at, ended_at } = req.body || {};
  if (!name) return res.status(400).json({ error: "活动名称不能为空" });
  try {
    const code = await generateActivityCode('enterprise');
    const result = await dbRun(
      "INSERT INTO activities(name, organizer, activity_code, started_at, ended_at, created_by, enterprise_id) VALUES(?,?,?,?,?,?,?)",
      [name, organizer || null, code, started_at || null, ended_at || null, req.user.uid, req.org.id]
    );
    res.json({ ok: true, id: result.lastID, activity_code: code });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

  app.put("/api/enterprise/activities/:id", authMiddleware, requireEnterprise, async (req, res) => {
  const { name, organizer, started_at, ended_at, status } = req.body || {};
  try {
    const existing = await dbGet("SELECT * FROM activities WHERE id = ? AND enterprise_id = ?", [req.params.id, req.org.id]);
    if (!existing) return res.status(404).json({ error: "活动不存在或不属于本组织" });
    await dbRun(
      "UPDATE activities SET name=?, organizer=?, started_at=?, ended_at=?, status=? WHERE id=?",
      [name || existing.name, organizer ?? existing.organizer, started_at ?? existing.started_at,
      ended_at ?? existing.ended_at, status || existing.status, req.params.id]
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

  app.get("/api/enterprise/activities/:id/sessions", authMiddleware, requireEnterprise, async (req, res) => {
  try {
    const activity = await dbGet("SELECT * FROM activities WHERE id = ? AND enterprise_id = ?", [req.params.id, req.org.id]);
    if (!activity) return res.status(404).json({ error: "活动不存在或不属于本组织" });
    const rows = await dbAll(`
      SELECT gs.id, gs.started_at, gs.ended_at, gs.final_score, gs.game_mode,
             u.guardian_name, u.phone, as2.table_no
      FROM activity_sessions as2
      JOIN game_sessions gs ON gs.id = as2.session_id
      JOIN users u ON u.id = gs.user_id
      WHERE as2.activity_id = ?
      ORDER BY as2.table_no ASC
    `, [req.params.id]);
    res.json({ activity, sessions: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 组织管理员：邀请码管理
  app.post("/api/enterprise/invite-codes", authMiddleware, requireEnterprise, async (req, res) => {
  const { maxUses, expiresInDays } = req.body || {};
  try {
    const code = await generateInviteCode();
    const expiresAt = Date.now() + (expiresInDays || 3) * 24 * 60 * 60 * 1000;
    const result = await dbRun(
      "INSERT INTO invite_codes(code, type, organization_id, created_by, max_uses, expires_at) VALUES(?,?,?,?,?,?)",
      [code, 'organization', req.org.id, req.user.uid, maxUses || 1, expiresAt]
    );
    res.json({ ok: true, id: result.lastID, code, expiresAt });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

  app.get("/api/enterprise/invite-codes", authMiddleware, requireEnterprise, async (req, res) => {
  try {
    const rows = await dbAll(
      "SELECT * FROM invite_codes WHERE organization_id = ? ORDER BY created_at DESC",
      [req.org.id]
    );
    res.json({ codes: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});


// ======== API: game ========
  app.post("/api/game/start", authMiddleware, async (req, res) => {
  const userId = req.user.uid;
  const ts = Number(req.body?.ts || Date.now());
  const { location, players, mode, settings, cardGroupId, activityCode } = req.body || {};

  const playersJson = players ? JSON.stringify(players) : null;
  const settingsJson = settings ? JSON.stringify(settings) : null;
  const groupId = cardGroupId ? Number(cardGroupId) : null;

  const r = await dbRun(
    "INSERT INTO game_sessions(user_id, started_at, location, players_json, game_mode, game_settings_json, card_group_id) VALUES(?, ?, ?, ?, ?, ?, ?)",
    [userId, ts, location, playersJson, mode, settingsJson, groupId]
  );
  const sessionId = r.lastID;

  // 如果传入了活动码，自动关联
  let activityInfo = null;
  if (activityCode) {
    const activity = await dbGet("SELECT * FROM activities WHERE activity_code = ? AND status = 'active'", [activityCode.toUpperCase()]);
    if (activity) {
      const maxTable = await dbGet("SELECT MAX(table_no) as max FROM activity_sessions WHERE activity_id = ?", [activity.id]);
      const table_no = (maxTable?.max || 0) + 1;
      await dbRun("INSERT OR IGNORE INTO activity_sessions(activity_id, session_id, table_no) VALUES(?,?,?)",
        [activity.id, sessionId, table_no]);
      activityInfo = { id: activity.id, name: activity.name, table_no };
    }
  }

  res.json({ ok: true, sessionId, activity: activityInfo });
});

  app.post("/api/game/finish", authMiddleware, async (req, res) => {
  const userId = req.user.uid;
  const { sessionId, endedAt, finalScore, payload, attributes } = req.body || {};
  if (!sessionId) return res.status(400).json({ error: "缺少 sessionId" });

  // 获取该场次的卡牌组信息以计算得分率
  const session = await dbGet("SELECT card_group_id FROM game_sessions WHERE id=? AND user_id=?", [sessionId, userId]);
  if (!session) return res.status(404).json({ error: "游戏不存在" });

  let scoreRate = Number(finalScore || 0);
  let scoreDetails = null;

  // 如果前端传来了各维度实际得分 (attributes) 且有关联的卡牌组
  const attrs = attributes || (payload && payload.attributes) || null;
  if (attrs && typeof attrs === "object") {
    let maxScores = null;
    const groupId = session.card_group_id;
    if (groupId) {
      const group = await cardsDbGet("SELECT max_scores_json FROM card_groups WHERE id = ?", [groupId]);
      if (group && group.max_scores_json) {
        try { maxScores = JSON.parse(group.max_scores_json); } catch (_) {}
      }
    }
    // 如果没有缓存的 max_scores，尝试用默认卡牌组
    if (!maxScores) {
      const defGroup = await cardsDbGet("SELECT max_scores_json FROM card_groups WHERE is_default = 1 LIMIT 1");
      if (defGroup && defGroup.max_scores_json) {
        try { maxScores = JSON.parse(defGroup.max_scores_json); } catch (_) {}
      }
    }

    if (maxScores) {
      // 计算各维度得分率
      const details = {};
      let totalRate = 0;
      let dimCount = 0;
      for (const [dim, maxVal] of Object.entries(maxScores)) {
        const actual = Number(attrs[dim] || 0);
        const rate = maxVal > 0 ? Math.min(actual / maxVal, 1) : 0;
        details[dim] = { actual, max: maxVal, rate: Math.round(rate * 10000) / 10000 };
        totalRate += rate;
        dimCount++;
      }
      scoreRate = dimCount > 0 ? Math.round((totalRate / dimCount) * 100) : 0;
      scoreDetails = details;
    }
  }

  await dbRun(
    "UPDATE game_sessions SET ended_at=?, final_score=?, score_details_json=?, payload_json=? WHERE id=? AND user_id=?",
    [Number(endedAt || Date.now()), scoreRate, scoreDetails ? JSON.stringify(scoreDetails) : null, JSON.stringify(payload || {}), sessionId, userId]
  );

  res.json({ ok: true, finalScore: scoreRate, scoreDetails });
});

  app.post("/api/game/event", authMiddleware, async (req, res) => {
  const userId = req.user.uid;
  const { sessionId, type, payload } = req.body || {};
  if (!sessionId || !type) return res.status(400).json({ error: "缺少 sessionId 或 type" });

  const session = await dbGet("SELECT id FROM game_sessions WHERE id = ? AND user_id = ?", [sessionId, userId]);
  if (!session) return res.status(404).json({ error: "游戏不存在" });

  await addGameEvent(sessionId, String(type), payload || {});
  res.json({ ok: true });
});

  app.get("/api/game/last-session", authMiddleware, async (req, res) => {
  const userId = req.user.uid;
  const session = await dbGet(
    "SELECT * FROM game_sessions WHERE user_id = ? ORDER BY started_at DESC LIMIT 1",
    [userId]
  );
  res.json({ session: session || null });
});

  app.get("/api/game/session/:id", authMiddleware, async (req, res) => {
  const userId = req.user.uid;
  const sessionId = Number(req.params.id);
  if (!sessionId) return res.status(400).json({ error: "sessionId 不正确" });

  const session = await dbGet("SELECT * FROM game_sessions WHERE id = ? AND user_id = ?", [sessionId, userId]);
  if (!session) return res.status(404).json({ error: "游戏不存在" });

  const events = await getGameEvents(sessionId);
  res.json({ session, events });
});

// ======== API: Cards Management ========

// 卡牌格式化辅助：将 cards_released 行转为前端卡牌对象
function formatReleasedCard(c) {
  return {
    id: c.card_id,
    key: c.key,
    card_code: c.card_code || null,
    safetyType: c.safety_type,
    event: c.event,
    phase: c.phase,
    status: 'released',
    audio_url: c.audio_url || null,
    attribute_reason: c.attribute_reason || null,
    title: c.title || null,
    guide_text: c.guide_text || null,
    options: JSON.parse(c.options_json)
  };
}

// 1. Get all cards (Public Game API)
// 支持 ?group_id=:id；未指定时优先使用 is_default 卡牌组；
// 若无任何卡牌组则回退到"每个 key 取最新快照"的旧行为。
  app.get("/api/cards", async (req, res) => {
  try {
    let groupId = req.query.group_id ? Number(req.query.group_id) : null;

    if (!groupId) {
      const def = await cardsDbGet("SELECT id FROM card_groups WHERE is_default = 1 LIMIT 1");
      if (def) groupId = def.id;
    }

    if (groupId) {
      const group = await cardsDbGet("SELECT * FROM card_groups WHERE id = ?", [groupId]);
      if (group) {
        let ids = [];
        try { ids = JSON.parse(group.released_ids_json || "[]"); } catch (_) {}
        if (ids.length === 0) return res.json({ cards: [], group: { id: group.id, name: group.name, maxScores: null } });

        const placeholders = ids.map(() => "?").join(",");
        const rows = await cardsDbAll(
          `SELECT * FROM cards_released WHERE id IN (${placeholders})`,
          ids
        );
        // 按 ids 顺序重排
        const byId = new Map(rows.map(r => [r.id, r]));
        const ordered = ids.map(i => byId.get(i)).filter(Boolean);
        let maxScores = null;
        try { maxScores = group.max_scores_json ? JSON.parse(group.max_scores_json) : null; } catch (_) {}
        return res.json({
          cards: ordered.map(formatReleasedCard),
          group: { id: group.id, name: group.name, maxScores }
        });
      }
    }

    // 回退：每个 key 最新快照
    const cards = await cardsDbAll(`
      SELECT cr.* FROM cards_released cr
      INNER JOIN (
        SELECT key, MAX(released_at) as max_t FROM cards_released GROUP BY key
      ) latest ON cr.key = latest.key AND cr.released_at = latest.max_t
      ORDER BY cr.key ASC
    `);
    res.json({ cards: cards.map(formatReleasedCard) });
  } catch (e) {
    res.status(500).json({ error: "Failed to fetch cards: " + e.message });
  }
});

// 1a-study. 守望学习：在 /api/cards 基础上回连 cards 表补全
// subtopic / whitepaper_ref / trainer_material_json（培训资料，未进发布快照）。
async function enrichWithStudyFields(releasedRows) {
  const cards = releasedRows.map(formatReleasedCard);
  const cardIds = [...new Set(releasedRows.map(r => r.card_id).filter(Boolean))];
  if (cardIds.length === 0) return cards;
  const ph = cardIds.map(() => "?").join(",");
  const extra = await cardsDbAll(
    `SELECT id, subtopic, whitepaper_ref, trainer_material_json FROM cards WHERE id IN (${ph})`,
    cardIds
  );
  const byId = new Map(extra.map(e => [e.id, e]));
  return cards.map(c => {
    const e = byId.get(c.id);
    let tm = null;
    if (e && e.trainer_material_json) {
      try {
        const j = JSON.parse(e.trainer_material_json);
        tm = {
          mentorIndex: j.mentor_index || "",
          trainerNotes: j.trainer_notes || "",
          extraCases: j.extra_cases || ""
        };
      } catch (_) {}
    }
    return {
      ...c,
      subtopic: e?.subtopic || null,
      whitepaperRef: e?.whitepaper_ref || null,
      trainerMaterial: tm
    };
  });
}

// 守望学习为会员权益：authMiddleware 内含 resolveValidity，无会员/已到期/被停用直接 403
  app.get("/api/cards/study", authMiddleware, async (req, res) => {
  try {
    let groupId = req.query.group_id ? Number(req.query.group_id) : null;
    if (!groupId) {
      const def = await cardsDbGet("SELECT id FROM card_groups WHERE is_default = 1 LIMIT 1");
      if (def) groupId = def.id;
    }

    let rows;
    if (groupId) {
      const group = await cardsDbGet("SELECT * FROM card_groups WHERE id = ?", [groupId]);
      if (!group) return res.status(404).json({ error: "卡牌组不存在" });
      let ids = [];
      try { ids = JSON.parse(group.released_ids_json || "[]"); } catch (_) {}
      if (ids.length === 0) return res.json({ cards: [], group: { id: group.id, name: group.name } });
      const ph = ids.map(() => "?").join(",");
      const fetched = await cardsDbAll(`SELECT * FROM cards_released WHERE id IN (${ph})`, ids);
      const byId = new Map(fetched.map(r => [r.id, r]));
      rows = ids.map(i => byId.get(i)).filter(Boolean);
      const cards = await enrichWithStudyFields(rows);
      return res.json({ cards, group: { id: group.id, name: group.name } });
    }

    // 回退：每个 key 最新快照
    rows = await cardsDbAll(`
      SELECT cr.* FROM cards_released cr
      INNER JOIN (
        SELECT key, MAX(released_at) as max_t FROM cards_released GROUP BY key
      ) latest ON cr.key = latest.key AND cr.released_at = latest.max_t
      ORDER BY cr.key ASC
    `);
    const cards = await enrichWithStudyFields(rows);
    res.json({ cards });
  } catch (e) {
    res.status(500).json({ error: "Failed to fetch study cards: " + e.message });
  }
});

// 1b. 公开：卡牌组列表（供前端三条杠菜单）
  app.get("/api/card-groups", async (req, res) => {
  try {
    const groups = await cardsDbAll("SELECT id, name, description, is_default, released_ids_json FROM card_groups ORDER BY is_default DESC, id ASC");
    const result = groups.map(g => {
      let count = 0;
      try { count = (JSON.parse(g.released_ids_json || "[]")).length; } catch (_) {}
      return { id: g.id, name: g.name, description: g.description || "", is_default: !!g.is_default, count };
    });
    res.json({ groups: result });
  } catch (e) {
    res.status(500).json({ error: "Failed to fetch card groups: " + e.message });
  }
});

// 1c. Admin：卡牌组 CRUD
  app.get("/api/admin/card-groups", authMiddleware, async (req, res) => {
  try {
    const groups = await cardsDbAll("SELECT * FROM card_groups ORDER BY is_default DESC, id ASC");
    const result = groups.map(g => {
      let ids = [];
      try { ids = JSON.parse(g.released_ids_json || "[]"); } catch (_) {}
      return {
        id: g.id, name: g.name, description: g.description || "",
        is_default: !!g.is_default, count: ids.length,
        released_ids: ids,
        created_at: g.created_at, updated_at: g.updated_at
      };
    });
    res.json({ groups: result });
  } catch (e) {
    res.status(500).json({ error: "Failed: " + e.message });
  }
});

  app.get("/api/admin/card-groups/:id", authMiddleware, async (req, res) => {
  try {
    const group = await cardsDbGet("SELECT * FROM card_groups WHERE id = ?", [req.params.id]);
    if (!group) return res.status(404).json({ error: "卡牌组不存在" });
    let ids = [];
    try { ids = JSON.parse(group.released_ids_json || "[]"); } catch (_) {}

    let cards = [];
    if (ids.length > 0) {
      const placeholders = ids.map(() => "?").join(",");
      const rows = await cardsDbAll(`SELECT * FROM cards_released WHERE id IN (${placeholders})`, ids);
      const byId = new Map(rows.map(r => [r.id, r]));
      cards = ids.map(i => byId.get(i)).filter(Boolean).map(r => ({
        released_id: r.id,
        card_id: r.card_id,
        key: r.key,
        safety_type: r.safety_type,
        event: r.event,
        phase: r.phase,
        version_label: r.version_label
      }));
    }

    res.json({
      id: group.id, name: group.name, description: group.description || "",
      is_default: !!group.is_default,
      released_ids: ids,
      cards,
      created_at: group.created_at, updated_at: group.updated_at
    });
  } catch (e) {
    res.status(500).json({ error: "Failed: " + e.message });
  }
});

// 辅助：把沙盒 card_ids 解析为 released_ids；如该 card 当前 version 尚未发布，则自动 snapshot
async function resolveReleasedIdsFromCardIds(cardIds, releasedBy, label) {
  const out = [];
  const now = Date.now();
  for (const cid of cardIds) {
    const card = await cardsDbGet("SELECT * FROM cards WHERE id = ?", [cid]);
    if (!card) continue;
    // 强制升级为 active（既然加入卡牌组就视为发布）
    if (card.status !== 'active') {
      await cardsDbRun("UPDATE cards SET status='active', updated_at=? WHERE id=?", [now, cid]);
    }
    // 复用：若已存在 from_version_id == current_version_id 的快照，直接用
    let snap = null;
    if (card.current_version_id) {
      snap = await cardsDbGet(
        "SELECT id FROM cards_released WHERE card_id=? AND from_version_id=? ORDER BY id DESC LIMIT 1",
        [card.id, card.current_version_id]
      );
    }
    if (snap) {
      out.push(snap.id);
      continue;
    }
    // 新建快照
    const ins = await cardsDbRun(
      `INSERT INTO cards_released
       (card_id, key, safety_type, event, phase, options_json, audio_url, attribute_reason, card_code, title, guide_text, version_label, from_version_id, released_by, released_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [card.id, card.key, card.safety_type, card.event, card.phase, card.options_json,
       card.audio_url, card.attribute_reason, card.card_code, card.title, card.guide_text,
       label || (card.version_label || `v${card.version || 1}版`),
       card.current_version_id, releasedBy, now]
    );
    out.push(ins.lastID);
  }
  return out;
}

// 计算卡牌组各维度理论满分（每张卡取该维度最高选项值，然后所有卡求和）
async function computeMaxScoresForGroup(releasedIdsJson) {
  let ids = [];
  try { ids = JSON.parse(releasedIdsJson || "[]"); } catch (_) {}
  if (ids.length === 0) return null;

  const placeholders = ids.map(() => "?").join(",");
  const rows = await cardsDbAll(
    `SELECT options_json FROM cards_released WHERE id IN (${placeholders})`, ids
  );

  const maxScores = {}; // { "安全力": total, "脑波力": total, ... }
  for (const row of rows) {
    let options;
    try { options = JSON.parse(row.options_json); } catch (_) { continue; }
    // 每张卡：取每个维度在所有选项中的最大值
    const cardMax = {};
    for (const optKey of Object.keys(options)) {
      const effects = options[optKey]?.attributeEffects;
      if (!effects) continue;
      for (const [attr, val] of Object.entries(effects)) {
        const v = Number(val) || 0;
        if (v > (cardMax[attr] || 0)) cardMax[attr] = v;
      }
    }
    // 累加到总分
    for (const [attr, val] of Object.entries(cardMax)) {
      maxScores[attr] = (maxScores[attr] || 0) + val;
    }
  }
  return Object.keys(maxScores).length > 0 ? maxScores : null;
}

  app.post("/api/admin/card-groups", authMiddleware, async (req, res) => {
  try {
    const { name, description, released_ids, card_ids, is_default } = req.body || {};
    if (!name) return res.status(400).json({ error: "name required" });
    let ids = [];
    if (Array.isArray(card_ids) && card_ids.length > 0) {
      ids = await resolveReleasedIdsFromCardIds(
        card_ids.map(Number).filter(Boolean), req.user.uid, `加入卡牌组：${name}`
      );
    } else if (Array.isArray(released_ids)) {
      ids = released_ids.map(Number).filter(Boolean);
    }
    const now = Date.now();
    const idsJson = JSON.stringify(ids);
    const maxScores = await computeMaxScoresForGroup(idsJson);
    const result = await cardsDbRun(
      `INSERT INTO card_groups (name, description, released_ids_json, max_scores_json, is_default, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [name, description || "", idsJson, maxScores ? JSON.stringify(maxScores) : null, is_default ? 1 : 0, req.user.uid, now, now]
    );
    if (is_default) {
      await cardsDbRun("UPDATE card_groups SET is_default = 0 WHERE id != ?", [result.lastID]);
    }
    res.json({ ok: true, id: result.lastID, count: ids.length });
  } catch (e) {
    res.status(500).json({ error: "Failed: " + e.message });
  }
});

  app.put("/api/admin/card-groups/:id", authMiddleware, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const existing = await cardsDbGet("SELECT * FROM card_groups WHERE id = ?", [id]);
    if (!existing) return res.status(404).json({ error: "卡牌组不存在" });

    const { name, description, released_ids, card_ids, is_default } = req.body || {};
    const newName = name != null ? name : existing.name;
    const newDesc = description != null ? description : existing.description;

    let newIdsJson = existing.released_ids_json;
    if (Array.isArray(card_ids)) {
      const resolved = await resolveReleasedIdsFromCardIds(
        card_ids.map(Number).filter(Boolean), req.user.uid, `加入卡牌组：${newName}`
      );
      newIdsJson = JSON.stringify(resolved);
    } else if (Array.isArray(released_ids)) {
      newIdsJson = JSON.stringify(released_ids.map(Number).filter(Boolean));
    }
    const newDefault = is_default != null ? (is_default ? 1 : 0) : existing.is_default;
    const now = Date.now();
    const maxScores = await computeMaxScoresForGroup(newIdsJson);

    await cardsDbRun(
      `UPDATE card_groups SET name=?, description=?, released_ids_json=?, max_scores_json=?, is_default=?, updated_at=? WHERE id=?`,
      [newName, newDesc, newIdsJson, maxScores ? JSON.stringify(maxScores) : null, newDefault, now, id]
    );
    if (newDefault) {
      await cardsDbRun("UPDATE card_groups SET is_default = 0 WHERE id != ?", [id]);
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: "Failed: " + e.message });
  }
});

  app.delete("/api/admin/card-groups/:id", authMiddleware, async (req, res) => {
  try {
    await cardsDbRun("DELETE FROM card_groups WHERE id = ?", [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: "Failed: " + e.message });
  }
});

// 2. Get all cards (Admin API - Filterable)
  app.get("/api/admin/cards", authMiddleware, async (req, res) => {
  try {
    const { status } = req.query;
    let sql = "SELECT * FROM cards";
    const params = [];

    if (status) {
      sql += " WHERE status = ?";
      params.push(status);
    } else {
      // Default to showing all except deleted? Or just all? 
      // Let's show all for admin if no status specified, or maybe excluding deleted by default unless requested.
      // For now, simple logic: all.
    }

    sql += " ORDER BY id DESC"; // Newest first for admin

    const cards = await cardsDbAll(sql, params);
    const formattedCards = cards.map(c => ({
      id: c.id,
      key: c.key,
      card_code: c.card_code || null,
      workbench: c.workbench || '经典版',
      safetyType: c.safety_type,
      event: c.event,
      phase: c.phase,
      status: c.status,
      audio_url: c.audio_url || null,
      attribute_reason: c.attribute_reason || null,
      title: c.title || null,
      guide_text: c.guide_text || null,
      subtopic: c.subtopic || null,
      whitepaper_ref: c.whitepaper_ref || null,
      trainer_material: (() => { try { return c.trainer_material_json ? JSON.parse(c.trainer_material_json) : null; } catch { return null; } })(),
      notes: c.notes || '[]',
      current_version_id: c.current_version_id || null,
      author_id: c.author_id || null,
      updatedAt: c.updated_at,
      options: JSON.parse(c.options_json)
    }));
    res.json({ cards: formattedCards });
  } catch (e) {
    res.status(500).json({ error: "Failed to fetch admin cards: " + e.message });
  }
});

// 2. Generate card using LLM
// fs already imported at top of file

  app.post("/api/admin/generate-card", authMiddleware, async (req, res) => {
  const { topic, content } = req.body;
  if (!topic && !content) return res.status(400).json({ error: "Missing topic or content" });

  // Read the prompt template
  const promptPath = path.join(ROOT_DIR, "cards-generation-prompt.md");
  let systemPrompt;
  try {
    systemPrompt = await fsPromises.readFile(promptPath, "utf-8");
  } catch (e) {
    console.error("Failed to read prompt file:", e);
    return res.status(500).json({ error: "Failed to read prompt template" });
  }

  // Construct the full user message
  const userMessage = `请根据以下信息生成卡牌 JSON：\n${topic ? `Topic: ${topic}\n` : ""}${content ? `Content: ${content}` : ""}`;

  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "Server missing DEEPSEEK_API_KEY" });

  const model = process.env.DEEPSEEK_MODEL || "deepseek-chat";

  try {
    const response = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage }
        ],
        temperature: 1.0, // Creativity
        response_format: { type: "json_object" } // Force JSON if supported, or just trust prompt
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`DeepSeek API error: ${response.status} ${errText}`);
    }

    const data = await response.json();
    const generatedContent = data.choices[0].message.content;

    let cardJson;
    try {
      cardJson = JSON.parse(generatedContent);
    } catch (e) {
      // Try to extract JSON from code block if present
      const match = generatedContent.match(/```json\n([\s\S]*?)\n```/);
      if (match) {
        cardJson = JSON.parse(match[1]);
      } else {
        throw new Error("Failed to parse JSON from LLM response");
      }
    }

    res.json({ card: cardJson, raw: generatedContent });

  } catch (e) {
    console.error("Card Generation Error:", e);
    res.status(500).json({ error: e.message });
  }
});

// 3. Save a new card
  app.post("/api/cards", authMiddleware, async (req, res) => {
  const card = req.body;

  // Basic validation
  if (!card.safetyType || !card.event || !card.phase || !card.options) {
    return res.status(400).json({ error: "Invalid card data structure" });
  }

  try {
    // Find next key if not provided or if provided key already exists
    let key = card.key;
    let exists = false;

    if (key) {
      const row = await cardsDbGet("SELECT 1 FROM cards WHERE key = ?", [key]);
      if (row) exists = true;
    }

    if (!key || exists) {
      // Auto-generate a key (max + 1)
      const maxKeyRow = await cardsDbGet("SELECT MAX(key) as k FROM cards");
      const maxKey = maxKeyRow?.k || 0;
      key = maxKey + 1;
    }

    const optionsJson = JSON.stringify(card.options);

    // New cards start as 'pending'
    const status = 'pending';
    const version = 1;
    const createdAt = Date.now();

    const attributeReason = card.attributeReason || null;
    // 2026 卡牌包新增字段
    const cardCode = card.card_code || null;
    const workbench = card.workbench || '经典版';
    const title = card.title || null;
    const guideText = card.guide_text || null;
    const subtopic = card.subtopic || null;
    const whitepaperRef = card.whitepaper_ref || null;
    const trainerMaterialJson = card.trainer_material ? JSON.stringify(card.trainer_material) : null;

    const result = await cardsDbRun(
      `INSERT INTO cards (key, safety_type, event, phase, options_json, attribute_reason, status, version, created_at, updated_at, author_id,
         card_code, workbench, title, guide_text, subtopic, whitepaper_ref, trainer_material_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [key, card.safetyType, card.event, card.phase, optionsJson, attributeReason, status, version, createdAt, createdAt, req.user.uid,
        cardCode, workbench, title, guideText, subtopic, whitepaperRef, trainerMaterialJson]
    );

    // 同时在 card_versions 建初版
    const versionResult = await cardsDbRun(
      `INSERT INTO card_versions (card_id, key, safety_type, event, phase, options_json, attribute_reason, version, version_label, author_id, branch, created_at,
         card_code, workbench, title, guide_text, subtopic, whitepaper_ref, trainer_material_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [result.lastID, key, card.safetyType, card.event, card.phase, optionsJson, attributeReason, 1, 'v1-初版', req.user.uid, 'main', createdAt,
        cardCode, workbench, title, guideText, subtopic, whitepaperRef, trainerMaterialJson]
    );

    // 回写 current_version_id
    await cardsDbRun("UPDATE cards SET current_version_id = ? WHERE id = ?", [versionResult.lastID, result.lastID]);

    res.json({ ok: true, id: result.lastID, key, status });
  } catch (e) {
    console.error("Save Card Error:", e);
    res.status(500).json({ error: "Failed to save card: " + e.message });
  }
});

// 4. Update Card (沙盒自由编辑 / 状态变更)
  app.put("/api/cards/:id", authMiddleware, async (req, res) => {
  const { id } = req.params;
  const updates = req.body;

  try {
    const existing = await cardsDbGet("SELECT * FROM cards WHERE id = ?", [id]);
    if (!existing) return res.status(404).json({ error: "Card not found" });

    const safetyType = updates.safetyType || existing.safety_type;
    const event = updates.event || existing.event;
    const phase = updates.phase !== undefined ? updates.phase : existing.phase;
    const status = updates.status || existing.status;
    const optionsJson = updates.options ? JSON.stringify(updates.options) : existing.options_json;
    const audioUrl = updates.audio_url !== undefined ? (updates.audio_url || null) : existing.audio_url;
    const attributeReason = updates.attributeReason !== undefined ? (updates.attributeReason || null) : existing.attribute_reason;
    const updatedAt = Date.now();

    // 2026 卡牌包新增字段（未传则保留原值）
    const cardCode = updates.card_code !== undefined ? (updates.card_code || null) : existing.card_code;
    const workbench = updates.workbench !== undefined ? (updates.workbench || '经典版') : existing.workbench;
    const title = updates.title !== undefined ? (updates.title || null) : existing.title;
    const guideText = updates.guide_text !== undefined ? (updates.guide_text || null) : existing.guide_text;
    const subtopic = updates.subtopic !== undefined ? (updates.subtopic || null) : existing.subtopic;
    const whitepaperRef = updates.whitepaper_ref !== undefined ? (updates.whitepaper_ref || null) : existing.whitepaper_ref;
    const trainerMaterialJson = updates.trainer_material !== undefined
      ? (updates.trainer_material ? JSON.stringify(updates.trainer_material) : null)
      : existing.trainer_material_json;

    let deletedAt = existing.deleted_at;
    if (status === 'deleted' && existing.status !== 'deleted') {
      deletedAt = Date.now();
    } else if (status !== 'deleted') {
      deletedAt = null;
    }

    await cardsDbRun(
      `UPDATE cards SET safety_type=?, event=?, phase=?, options_json=?, status=?, audio_url=?, attribute_reason=?, updated_at=?, deleted_at=?,
         card_code=?, workbench=?, title=?, guide_text=?, subtopic=?, whitepaper_ref=?, trainer_material_json=? WHERE id=?`,
      [safetyType, event, phase, optionsJson, status, audioUrl, attributeReason, updatedAt, deletedAt,
        cardCode, workbench, title, guideText, subtopic, whitepaperRef, trainerMaterialJson, id]
    );

    res.json({ ok: true, id, status });

  } catch (e) {
    console.error("Update Card Error:", e);
    res.status(500).json({ error: "Failed to update card: " + e.message });
  }
});

// 4.5 Bulk Release API (批量发布到游戏)
  app.post("/api/admin/cards/bulk-release", authMiddleware, async (req, res) => {
  const { cardIds, secretKey } = req.body;
  if (!cardIds || !Array.isArray(cardIds) || cardIds.length === 0) {
    return res.status(400).json({ error: "No cardIds provided" });
  }

  let devKey = process.env.DEV_KEY || "sj0127wqt";
  try {
    const sysDbRow = await dbGet("SELECT setting_value FROM system_settings WHERE setting_key = 'DEV_KEY'");
    if (sysDbRow && sysDbRow.setting_value) devKey = sysDbRow.setting_value;
  } catch (e) { }

  if (secretKey !== devKey) {
    return res.status(403).json({ error: "密钥不正确，拒绝发布！" });
  }

  try {
    const results = [];
    const now = Date.now();
    for (const id of cardIds) {
      const card = await cardsDbGet("SELECT * FROM cards WHERE id = ?", [id]);
      if (!card) continue;

      // 插入 cards_released 快照
      await cardsDbRun(
        `INSERT INTO cards_released (card_id, key, safety_type, event, phase, options_json, audio_url, attribute_reason, version_label, from_version_id, released_by, released_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [card.id, card.key, card.safety_type, card.event, card.phase, card.options_json,
         card.audio_url, card.attribute_reason, card.version_label || `v${card.version || 1}版`, card.current_version_id, req.user.uid, now]
      );

      // 确保 cards.status 为 active
      if (card.status !== 'active') {
        await cardsDbRun("UPDATE cards SET status='active', updated_at=? WHERE id=?", [now, id]);
      }

      results.push({ id, key: card.key });
    }

    res.json({ ok: true, results });
  } catch (e) {
    console.error("Bulk Release Error:", e);
    res.status(500).json({ error: "Failed to bulk release cards: " + e.message });
  }
});

// 兼容旧路由
  app.post("/api/admin/cards/bulk-publish", authMiddleware, (req, res, next) => {
  req.url = '/api/admin/cards/bulk-release';
  next();
});

// 4.6 Bulk Upsert API (按 key upsert 卡牌到沙盒，含写版本，DEV_KEY 鉴权)
  app.post("/api/admin/cards/bulk-upsert", async (req, res) => {
  const { cards, secretKey, authorId, status, versionLabel } = req.body || {};
  if (!Array.isArray(cards) || cards.length === 0) {
    return res.status(400).json({ error: "No cards provided" });
  }

  let devKey = process.env.DEV_KEY || "sj0127wqt";
  try {
    const sysDbRow = await dbGet("SELECT setting_value FROM system_settings WHERE setting_key = 'DEV_KEY'");
    if (sysDbRow && sysDbRow.setting_value) devKey = sysDbRow.setting_value;
  } catch (e) { }
  if (secretKey !== devKey) {
    return res.status(403).json({ error: "密钥不正确" });
  }

  const finalStatus = status || 'active';
  const label = versionLabel || '沙盒同步';
  const author = Number.isInteger(authorId) ? authorId : null;
  const now = Date.now();
  const results = [];

  try {
    for (const c of cards) {
      if (!c || c.key == null || !c.safetyType || !c.event || !c.options) {
        results.push({ key: c?.key, ok: false, error: "missing fields" });
        continue;
      }
      const optionsJson = JSON.stringify(c.options);
      const attrReason = c.attributeReason || null;
      const existing = await cardsDbGet("SELECT id, version FROM cards WHERE key = ?", [c.key]);
      let cardId, newVer;
      if (existing) {
        newVer = (existing.version || 1) + 1;
        await cardsDbRun(
          `UPDATE cards SET safety_type=?, phase=?, event=?, options_json=?, attribute_reason=?, status=?, version=?, updated_at=?, author_id=?, branch='release' WHERE id=?`,
          [c.safetyType, c.phase || null, c.event, optionsJson, attrReason, finalStatus, newVer, now, author, existing.id]
        );
        cardId = existing.id;
      } else {
        const ins = await cardsDbRun(
          `INSERT INTO cards (key, safety_type, phase, event, options_json, attribute_reason, status, version, created_at, updated_at, author_id, branch)
           VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, 'release')`,
          [c.key, c.safetyType, c.phase || null, c.event, optionsJson, attrReason, finalStatus, now, now, author]
        );
        cardId = ins.lastID;
        newVer = 1;
      }
      const verIns = await cardsDbRun(
        `INSERT INTO card_versions (card_id, key, safety_type, event, phase, options_json, attribute_reason, status, version, version_label, created_at, author_id, note, branch, promoted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'main', ?)`,
        [cardId, c.key, c.safetyType, c.event, c.phase || null, optionsJson, attrReason, finalStatus, newVer, label, now, author, c.note || null, now]
      );
      await cardsDbRun("UPDATE cards SET current_version_id=? WHERE id=?", [verIns.lastID, cardId]);
      results.push({ key: c.key, id: cardId, version: newVer, ok: true, action: existing ? 'updated' : 'inserted' });
    }
    res.json({ ok: true, count: results.length, results });
  } catch (e) {
    console.error("Bulk Upsert Error:", e);
    res.status(500).json({ error: "Failed to bulk upsert: " + e.message });
  }
});

// 5. Soft Delete Card (Shortcut)
  app.delete("/api/cards/:id", authMiddleware, async (req, res) => {
  const { id } = req.params;
  try {
    const existing = await cardsDbGet("SELECT * FROM cards WHERE id = ?", [id]);
    if (!existing) return res.status(404).json({ error: "Card not found" });

    const newVersion = (existing.version || 0) + 1;
    const now = Date.now();

    await cardsDbRun(
      `UPDATE cards SET status='deleted', version=?, updated_at=?, deleted_at=? WHERE id=?`,
      [newVersion, now, now, id]
    );

    res.json({ ok: true, id, status: 'deleted' });
  } catch (e) {
    res.status(500).json({ error: "Failed to delete card: " + e.message });
  }
});

// ======== API: LLM proxy（可选） ========
// 你原 index.html 里把 Key 写死在前端了（非常危险），这里提供一个安全的后端代理。
  app.post("/api/llm/story", authMiddleware, async (req, res) => {
  const prompt = req.body?.prompt;
  if (!prompt) return res.status(400).json({ error: "缺少 prompt" });

  const rawMaxTokens = Number(req.body?.max_tokens);
  const maxTokens = Number.isFinite(rawMaxTokens) ? Math.min(Math.max(rawMaxTokens, 200), 8000) : 1200;
  const rawTemperature = Number(req.body?.temperature);
  const temperature = Number.isFinite(rawTemperature) ? Math.min(Math.max(rawTemperature, 0), 1.2) : 0.7;

  // 获取模型配置
  let provider = req.body?.provider || "";
  let model = req.body?.model || "";

  try {
    // 默认从数据库中读取全局使用的生产环境配置为主
    if (!provider || !model) {
      const pRow = await dbGet("SELECT value FROM system_settings WHERE key = 'DEFAULT_LLM_PROVIDER'");
      const mRow = await dbGet("SELECT value FROM system_settings WHERE key = 'DEFAULT_LLM_MODEL'");
      if (pRow && pRow.value) provider = provider || pRow.value;
      if (mRow && mRow.value) model = model || mRow.value;
    }

    // 后备方案机制
    provider = provider || "OpenAI";
    model = model || "gpt-4o-mini";

    let apiKey = "";
    let baseUrl = "";

    // 从数据库 system_settings 拿当前 provider 的配置（注意解密）
    if (provider === "OpenAI") {
       let kRow = await dbGet("SELECT value FROM system_settings WHERE key = 'OPENAI_API_KEY'");
       let uRow = await dbGet("SELECT value FROM system_settings WHERE key = 'OPENAI_BASE_URL'");
       apiKey = (kRow && kRow.value) ? decryptVal(kRow.value) : process.env.OPENAI_API_KEY;
       baseUrl = (uRow && uRow.value) ? decryptVal(uRow.value) : (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1/chat/completions");
    } else if (provider === "Google Gemini") {
       let kRow = await dbGet("SELECT value FROM system_settings WHERE key = 'GEMINI_API_KEY'");
       let uRow = await dbGet("SELECT value FROM system_settings WHERE key = 'GEMINI_BASE_URL'");
       apiKey = (kRow && kRow.value) ? decryptVal(kRow.value) : process.env.GEMINI_API_KEY;
       baseUrl = (uRow && uRow.value) ? decryptVal(uRow.value) : (process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions");
    } else if (provider === "阿里云 DashScope") {
       let kRow = await dbGet("SELECT value FROM system_settings WHERE key = 'DASHSCOPE_API_KEY'");
       let uRow = await dbGet("SELECT value FROM system_settings WHERE key = 'DASHSCOPE_BASE_URL'");
       apiKey = (kRow && kRow.value) ? decryptVal(kRow.value) : process.env.DASHSCOPE_API_KEY;
       baseUrl = (uRow && uRow.value) ? decryptVal(uRow.value) : (process.env.DASHSCOPE_BASE_URL || "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions");
    } else {
       // DeepSeek 或 其他兼容
       let kRow = await dbGet("SELECT value FROM system_settings WHERE key = 'DEEPSEEK_API_KEY'");
       let uRow = await dbGet("SELECT value FROM system_settings WHERE key = 'DEEPSEEK_BASE_URL'");
       apiKey = (kRow && kRow.value) ? decryptVal(kRow.value) : process.env.DEEPSEEK_API_KEY;
       baseUrl = (uRow && uRow.value) ? decryptVal(uRow.value) : (process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com/chat/completions");
       model = model || process.env.DEEPSEEK_MODEL || "deepseek-chat";
    }

    if (!apiKey) {
       return res.status(400).json({ error: `后端未配置 ${provider} 的 API_KEY` });
    }

    const start_time = Date.now();
    const isCodex = baseUrl.includes("/v1/responses");

    let reqBody;
    if (isCodex) {
      reqBody = {
        model,
        input: [
          {
            type: "message",
            role: "user",
            content: [
              { type: "input_text", text: prompt }
            ]
          }
        ]
      };
    } else {
      reqBody = {
        model,
        messages: [{ role: "user", content: prompt }],
        max_tokens: maxTokens,
        temperature
      };
    }
    
    // 调用 API
    const r = await fetch(baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify(reqBody)
    });

    if (!r.ok) {
      const t = await r.text().catch(() => "");
      console.error(`LLM Call Failed [${provider}]: ${r.status} - ${t}`);
      return res.status(502).json({ error: `LLM 调用失败(${r.status}) ${t?.slice(0, 200)}` });
    }

    const data = await r.json();
    let story = "";
    if (isCodex) {
       story = data?.output?.[0]?.content?.[0]?.text || "";
    } else {
       story = data?.choices?.[0]?.message?.content || "";
    }
    
    const elapsedMs = Date.now() - start_time;
    // 返回带上耗时统计
    res.json({ story, performance: { elapsed_ms: elapsedMs, provider, model } });
  } catch (e) {
    console.error(`LLM Network Error:`, e);
    res.status(502).json({ error: "LLM 网络请求失败" });
  }
});

// ======== API: 文生图 / 参考图生图（复盘报告插画 / banner）========
// 返回 base64 data URI，便于前端 html2canvas 导出海报时无跨域问题。
// provider=toapis 时支持 multipart image、imageUrl、image_urls、imageDataUri 作为参考图。
  app.post("/api/llm/image", authMiddleware, upload.single("image"), async (req, res) => {
  const prompt = (req.body?.prompt || "").toString().trim();
  if (!prompt) return res.status(400).json({ error: "缺少 prompt" });

  const size = (req.body?.size || "1024*1024").toString();

  try {
    const getSetting = async (key, fallback = "") => {
      const row = await dbGet("SELECT value FROM system_settings WHERE key = ?", [key]);
      return row && row.value ? decryptVal(row.value) : fallback;
    };

    const provider = String(
      req.body?.provider
        || await getSetting("IMAGE_PROVIDER", process.env.IMAGE_PROVIDER || (process.env.TOAPIS_API_KEY ? "toapis" : "dashscope"))
    ).toLowerCase();

    if (provider === "toapis") {
      const apiKey = await getSetting("TOAPIS_API_KEY", process.env.TOAPIS_API_KEY);
      if (!apiKey) {
        return res.status(501).json({ error: "后端未配置 TOAPIS_API_KEY（生图功能不可用）" });
      }

      const result = await generateWithToApis({
        apiKey,
        baseUrl: await getSetting("TOAPIS_BASE_URL", process.env.TOAPIS_BASE_URL || "https://toapis.com"),
        model: req.body?.model || await getSetting("TOAPIS_IMAGE_MODEL", process.env.TOAPIS_IMAGE_MODEL || "gpt-image-2"),
        prompt,
        size,
        resolution: req.body?.resolution || await getSetting("TOAPIS_IMAGE_RESOLUTION", process.env.TOAPIS_IMAGE_RESOLUTION || "1k"),
        quality: req.body?.quality || await getSetting("TOAPIS_IMAGE_QUALITY", process.env.TOAPIS_IMAGE_QUALITY || "medium"),
        file: req.file,
        body: req.body,
        timeoutMs: Number(req.body?.timeoutMs) || 120000
      });
      return res.json(result);
    }

    const apiKey = await getSetting("DASHSCOPE_API_KEY", process.env.DASHSCOPE_API_KEY);
    if (!apiKey) {
      return res.status(501).json({ error: "后端未配置 DASHSCOPE_API_KEY（生图功能不可用）" });
    }
    const model = await getSetting("DASHSCOPE_IMAGE_MODEL", process.env.DASHSCOPE_IMAGE_MODEL || "wanx2.1-t2i-turbo");
    const result = await generateWithDashScope({ apiKey, model, prompt, size });
    res.json(result);
  } catch (e) {
    console.error("生图接口异常:", e);
    const status = String(e.message || "").includes("超时") ? 504 : 502;
    res.status(status).json({ error: e.message || "生图网络请求失败" });
  }
});

// ======== API: Upload to OSS ========
  app.post("/api/upload/audio", authMiddleware, upload.single("file"), async (req, res) => {
  if (!ossClient) return res.status(500).json({ error: "服务器未配置 OSS" });
  if (!req.file) return res.status(400).json({ error: "未上传文件" });

  try {
    const filename = `game-audio/user_${req.user.uid}_${Date.now()}.webm`;
    const result = await ossClient.put(filename, req.file.buffer);

    // 生成访问链接
    let url = result.url;
    if (process.env.ALIYUN_OSS_CUSTOM_DOMAIN) {
      const domain = process.env.ALIYUN_OSS_CUSTOM_DOMAIN.replace(/\/$/, "");
      url = `${domain}/${result.name}`;
    }

    res.json({ ok: true, url });
  } catch (e) {
    console.error("OSS Upload Error:", e);
    res.status(500).json({ error: "上传失败: " + e.message });
  }
});

  app.post("/api/upload/report", authMiddleware, async (req, res) => {
  if (!ossClient) return res.status(500).json({ error: "服务器未配置 OSS" });

  const { html, markdown } = req.body || {};
  if (!html && !markdown) return res.status(400).json({ error: "缺少报告内容" });

  try {
    const timestamp = Date.now();
    const resultUrls = {};
    const customDomain = process.env.ALIYUN_OSS_CUSTOM_DOMAIN
      ? process.env.ALIYUN_OSS_CUSTOM_DOMAIN.replace(/\/$/, "")
      : null;

    if (html) {
      const filename = `game-review/report_${req.user.uid}_${timestamp}.html`;
      const r = await ossClient.put(filename, Buffer.from(html));
      resultUrls.htmlUrl = customDomain ? `${customDomain}/${r.name}` : r.url;
    }

    if (markdown) {
      const filename = `game-review/report_${req.user.uid}_${timestamp}.md`;
      const r = await ossClient.put(filename, Buffer.from(markdown));
      resultUrls.markdownUrl = customDomain ? `${customDomain}/${r.name}` : r.url;
    }

    res.json({ ok: true, ...resultUrls });
  } catch (e) {
    console.error("OSS Upload Error:", e);
    res.status(500).json({ error: "上传失败: " + e.message });
  }
});



// ======== API: OSS Management (Admin) ========
  app.get("/api/admin/oss/files", authMiddleware, async (req, res) => {
  if (!ossClient) return res.status(500).json({ error: "服务器未配置 OSS" });

  try {
    const { prefix, marker, maxKeys, delimiter } = req.query;
    const query = {
      prefix: prefix || null,
      marker: marker || null,
      'max-keys': maxKeys ? Number(maxKeys) : 20,
      delimiter: delimiter || "/" // Default to directory mode
    };

    // ossClient.list returns { objects: [], prefixes: [], nextMarker: string, res: ... }
    const result = await ossClient.list(query);

    const customDomain = process.env.ALIYUN_OSS_CUSTOM_DOMAIN
      ? process.env.ALIYUN_OSS_CUSTOM_DOMAIN.replace(/\/$/, "")
      : null;

    const files = (result.objects || []).map(obj => ({
      name: obj.name,
      url: customDomain ? `${customDomain}/${obj.name}` : obj.url,
      size: obj.size,
      lastModified: obj.lastModified
    }));

    // Prefixes are subdirectories
    const folders = result.prefixes || [];

    res.json({
      ok: true,
      files,
      folders,
      nextMarker: result.nextMarker,
      isTruncated: result.isTruncated
    });
  } catch (e) {
    console.error("OSS List Error:", e);
    res.status(500).json({ error: "获取文件列表失败: " + e.message });
  }
});

  app.delete("/api/admin/oss/files", authMiddleware, async (req, res) => {
  if (!ossClient) return res.status(500).json({ error: "服务器未配置 OSS" });

  const { filename } = req.body; // Expect JSON body: { "filename": "path/to/file" }
  if (!filename) return res.status(400).json({ error: "未指定文件名" });

  try {
    // ossClient.delete returns result object
    const result = await ossClient.delete(filename);
    console.log(`🗑️ Deleted OSS file: ${filename}`, result.res.status);

    res.json({ ok: true, filename });
  } catch (e) {
    console.error("OSS Delete Error:", e);
    res.status(500).json({ error: "删除文件失败: " + e.message });
  }
});

// ======== API: 活动管理 ========

// 活动码品类前缀（1 位）。新增品类时在此登记即可。
const ACTIVITY_CATEGORY_PREFIX = {
  test: 'T',        // 测试活动
  series: 'S',      // 系列活动
  enterprise: 'E',  // 企业级活动
  apply: 'A',       // 组织申请活动（pending_approval）
  general: 'G',     // 普通/官方活动（默认）
};

// 生成活动码：<品类前缀1位><4位随机>，共 5 位（如 T7K9Q / E3M8X）。
//   - 随机字符集去掉易混淆的 0/O/1/I；查询侧大小写不敏感（lookup 时 toUpperCase）。
//   - 不再用顺序自增：避免可枚举猜测、不暴露活动总数，也绕开 id 序列脱节的唯一约束坑。
//   - 历史 ACT-xxx 旧码不受影响（仍可按原值查询）。
async function generateActivityCode(category = 'general') {
  const prefix = ACTIVITY_CATEGORY_PREFIX[category] || ACTIVITY_CATEGORY_PREFIX.general;
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  for (let attempt = 0; attempt < 12; attempt++) {
    const bytes = crypto.randomBytes(4);
    let rand = "";
    for (let i = 0; i < 4; i++) rand += alphabet[bytes[i] % alphabet.length];
    const code = prefix + rand;
    const exists = await dbGet("SELECT id FROM activities WHERE activity_code = ?", [code]);
    if (!exists) return code;
  }
  // 极小概率连续碰撞，回退加时间戳后缀保证唯一
  return `${prefix}${Date.now().toString(36).toUpperCase()}`;
}

// 生成唯一邀请码：8 位大写字母+数字（去掉易混淆的 0/O/1/I），与 invite_codes.code 去重
async function generateInviteCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  for (let attempt = 0; attempt < 10; attempt++) {
    const bytes = crypto.randomBytes(8);
    let code = "";
    for (let i = 0; i < 8; i++) code += alphabet[bytes[i] % alphabet.length];
    const exists = await dbGet("SELECT id FROM invite_codes WHERE code = ?", [code]);
    if (!exists) return code;
  }
  // 极小概率连续碰撞，回退加时间戳后缀保证唯一
  return `INV${Date.now().toString(36).toUpperCase()}`;
}

  app.get("/api/admin/activities", authMiddleware, async (req, res) => {
  try {
    const rows = await dbAll(`
      SELECT a.*,
        COUNT(DISTINCT as2.session_id) as table_count,
        COUNT(DISTINCT gs.user_id) as participant_count,
        ROUND(AVG(gs.final_score), 1) as avg_score
      FROM activities a
      LEFT JOIN activity_sessions as2 ON as2.activity_id = a.id
      LEFT JOIN game_sessions gs ON gs.id = as2.session_id
      GROUP BY a.id
      ORDER BY a.created_at DESC
    `);
    res.json({ activities: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

  app.post("/api/admin/activities", authMiddleware, async (req, res) => {
  const { name, organizer, started_at, ended_at, category } = req.body || {};
  if (!name) return res.status(400).json({ error: "活动名称不能为空" });
  try {
    const code = await generateActivityCode(category || 'general');
    const result = await dbRun(
      "INSERT INTO activities(name, organizer, activity_code, started_at, ended_at, created_by) VALUES(?,?,?,?,?,?)",
      [name, organizer || null, code, started_at || null, ended_at || null, req.user.uid]
    );
    res.json({ ok: true, id: result.lastID, activity_code: code });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

  app.put("/api/admin/activities/:id", authMiddleware, async (req, res) => {
  const { id } = req.params;
  const { name, organizer, started_at, ended_at, status } = req.body || {};
  try {
    const existing = await dbGet("SELECT * FROM activities WHERE id = ?", [id]);
    if (!existing) return res.status(404).json({ error: "活动不存在" });
    await dbRun(
      "UPDATE activities SET name=?, organizer=?, started_at=?, ended_at=?, status=? WHERE id=?",
      [name || existing.name, organizer ?? existing.organizer, started_at ?? existing.started_at,
      ended_at ?? existing.ended_at, status || existing.status, id]
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

  app.get("/api/admin/activities/:id/sessions", authMiddleware, async (req, res) => {
  try {
    const rows = await dbAll(`
      SELECT gs.id, gs.started_at, gs.ended_at, gs.final_score, gs.game_mode,
             u.guardian_name, u.phone, as2.table_no
      FROM activity_sessions as2
      JOIN game_sessions gs ON gs.id = as2.session_id
      JOIN users u ON u.id = gs.user_id
      WHERE as2.activity_id = ?
      ORDER BY as2.table_no ASC
    `, [req.params.id]);
    res.json({ sessions: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 游戏开始时关联活动（通过活动码）
  app.post("/api/game/join-activity", authMiddleware, async (req, res) => {
  const { activity_code, session_id } = req.body || {};
  if (!activity_code || !session_id) return res.status(400).json({ error: "缺少参数" });
  try {
    const activity = await dbGet("SELECT * FROM activities WHERE activity_code = ? AND status = 'active'", [activity_code.toUpperCase()]);
    if (!activity) return res.status(404).json({ error: "活动码无效或活动已结束" });

    // 获取该活动当前最大桌号
    const maxTable = await dbGet("SELECT MAX(table_no) as max FROM activity_sessions WHERE activity_id = ?", [activity.id]);
    const table_no = (maxTable?.max || 0) + 1;

    await dbRun(
      "INSERT OR IGNORE INTO activity_sessions(activity_id, session_id, table_no) VALUES(?,?,?)",
      [activity.id, session_id, table_no]
    );
    res.json({ ok: true, activity_id: activity.id, activity_name: activity.name, table_no });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 公开：通过活动码查询活动信息（用于前端开局时自动填充）
  app.get("/api/activities/by-code/:code", async (req, res) => {
  const { code } = req.params;
  if (!code) return res.status(400).json({ error: "缺少活动码" });
  try {
    const activity = await dbGet(
      "SELECT id, name, organizer, activity_code, started_at, ended_at, status FROM activities WHERE activity_code = ?",
      [code.toUpperCase()]
    );
    if (!activity) return res.status(404).json({ error: "活动码无效" });
    if (activity.status !== 'active') return res.status(410).json({ error: "活动尚未开放或已结束" });

    // ?withSessions=1：附带桌次成绩（守望师名+分数），供「查询活动」展示
    let sessions = undefined;
    if (req.query.withSessions) {
      sessions = await dbAll(`
        SELECT as2.table_no, u.guardian_name, gs.final_score, gs.ended_at
        FROM activity_sessions as2
        JOIN game_sessions gs ON gs.id = as2.session_id
        JOIN users u ON u.id = gs.user_id
        WHERE as2.activity_id = ?
        ORDER BY as2.table_no ASC
      `, [activity.id]);
    }
    res.json({ activity, sessions });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 守望者创建活动（登录用户均可创建）
  app.post("/api/activities", authMiddleware, async (req, res) => {
  const { name, location, started_at, category } = req.body || {};
  if (!name) return res.status(400).json({ error: "活动名称不能为空" });
  try {
    const code = await generateActivityCode(category || 'general');
    const result = await dbRun(
      "INSERT INTO activities(name, organizer, activity_code, started_at, created_by) VALUES(?,?,?,?,?)",
      [name, location || null, code, started_at || Date.now(), req.user.uid]
    );
    res.json({ ok: true, id: result.lastID, activity_code: code });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 守望者申请创建活动（非工作人员，状态为 pending_approval）
  app.post("/api/activities/apply", authMiddleware, async (req, res) => {
  const { name, location, reason } = req.body || {};
  if (!name) return res.status(400).json({ error: "活动名称不能为空" });
  try {
    const code = await generateActivityCode('apply');
    const result = await dbRun(
      "INSERT INTO activities(name, organizer, activity_code, started_at, created_by, status) VALUES(?,?,?,?,?,?)",
      [name, location || null, code, Date.now(), req.user.uid, 'pending_approval']
    );
    res.json({ ok: true, id: result.lastID, activity_code: code });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ======== API: Admin 等级申请管理 ========
  app.get("/api/admin/level-applications", authMiddleware, async (req, res) => {
  const { status = 'pending' } = req.query;
  try {
    const rows = await dbAll(`
      SELECT la.*, u.guardian_name, u.phone, u.username
      FROM watcher_level_applications la
      JOIN users u ON u.id = la.user_id
      WHERE la.status = ?
      ORDER BY la.created_at DESC
    `, [status]);
    res.json({ applications: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

  app.put("/api/admin/level-applications/:id", authMiddleware, async (req, res) => {
  const { id } = req.params;
  const { action, note } = req.body || {}; // action: 'approve' | 'reject'
  if (!['approve', 'reject'].includes(action)) return res.status(400).json({ error: "action 必须为 approve 或 reject" });
  try {
    const app_row = await dbGet("SELECT * FROM watcher_level_applications WHERE id = ?", [id]);
    if (!app_row) return res.status(404).json({ error: "申请不存在" });
    if (app_row.status !== 'pending') return res.status(400).json({ error: "申请已处理" });

    const newStatus = action === 'approve' ? 'approved' : 'rejected';
    const now = Date.now();
    await dbRun(
      "UPDATE watcher_level_applications SET status=?, reviewed_by=?, reviewed_at=?, note=? WHERE id=?",
      [newStatus, req.user.uid, now, note || null, id]
    );

    if (action === 'approve') {
      // 更新用户等级
      const oldLevel = app_row.from_level;
      const newLevel = app_row.to_level;
      await dbRun("UPDATE users SET watcher_level=? WHERE id=?", [newLevel, app_row.user_id]);
      await dbRun(
        "INSERT INTO watcher_level_logs(user_id, old_level, new_level, source, changed_by, note) VALUES(?,?,?,?,?,?)",
        [app_row.user_id, oldLevel, newLevel, 'application', req.user.uid, note || null]
      );
    }
    res.json({ ok: true, newStatus });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Admin 手动调整用户等级（boss 专用）
  app.put("/api/admin/users/:id/level", authMiddleware, async (req, res) => {
  const { id } = req.params;
  const { level, note } = req.body || {};
  const validLevels = ['initial', 'advanced', 'mentor'];
  if (!validLevels.includes(level)) return res.status(400).json({ error: "等级值无效" });
  try {
    const user = await dbGet("SELECT watcher_level FROM users WHERE id = ?", [id]);
    if (!user) return res.status(404).json({ error: "用户不存在" });
    await dbRun("UPDATE users SET watcher_level=? WHERE id=?", [level, id]);
    await dbRun(
      "INSERT INTO watcher_level_logs(user_id, old_level, new_level, source, changed_by, note) VALUES(?,?,?,?,?,?)",
      [id, user.watcher_level, level, 'manual', req.user.uid, note || null]
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Admin 获取用户感想/反馈列表
  app.get("/api/admin/feedback", authMiddleware, async (req, res) => {
  const { reviewed } = req.query;
  try {
    let sql = `
      SELECT f.*, u.guardian_name, u.phone
      FROM user_feedback f
      JOIN users u ON u.id = f.user_id
    `;
    const params = [];
    if (reviewed !== undefined) { sql += " WHERE f.reviewed = ?"; params.push(Number(reviewed)); }
    sql += " ORDER BY f.created_at DESC";
    const rows = await dbAll(sql, params);
    res.json({ feedback: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

  app.put("/api/admin/feedback/:id/read", authMiddleware, async (req, res) => {
  try {
    await dbRun("UPDATE user_feedback SET reviewed=1 WHERE id=?", [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ======== API: 卡牌版本和批注 ========
  app.get("/api/admin/cards/:id/versions", authMiddleware, async (req, res) => {
  try {
    const id = req.params.id;
    const card = await cardsDbGet("SELECT * FROM cards WHERE id = ?", [id]);
    if (!card) return res.json({ versions: [] });

    const history = await cardsDbAll("SELECT * FROM card_versions WHERE card_id = ? ORDER BY created_at DESC", [id]);

    // 权限过滤：boss 全量可见，普通用户只看自己的版本
    const filtered = history.filter(c => {
      if (req.user.role === 'boss') return true;
      if (String(c.author_id) === String(req.user.uid)) return true;
      return false;
    });

    const versions = filtered.map(c => ({
      id: c.id,
      version: c.version,
      version_label: c.version_label,
      branch: c.branch || 'main',
      note: c.note || null,
      event: c.event,
      safetyType: c.safety_type,
      phase: c.phase,
      audio_url: c.audio_url || null,
      attribute_reason: c.attribute_reason || null,
      options: JSON.parse(c.options_json),
      author_id: c.author_id || null,
      parent_id: c.parent_id || null,
      promoted_at: c.promoted_at || null,
      is_current: card.current_version_id === c.id,
      created_at: c.created_at
    }));

    res.json({ versions, current_version_id: card.current_version_id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 删除单个历史版本
  app.delete("/api/admin/cards/:id/versions/:verId", authMiddleware, async (req, res) => {
  try {
    const { id, verId } = req.params;
    
    const versionRow = await cardsDbGet("SELECT * FROM card_versions WHERE id = ? AND card_id = ?", [verId, id]);
    if (!versionRow) {
      return res.status(404).json({ error: "指定的历史版本未找到或已删除" });
    }
    
    // 权限校验
    if (req.user.role !== 'boss') {
      if (String(versionRow.author_id) !== String(req.user.uid)) {
        return res.status(403).json({ error: "您没有权限删除他人创建的版本！" });
      }
    }
    
    await cardsDbRun("DELETE FROM card_versions WHERE id = ?", [verId]);
    res.json({ ok: true });
  } catch (e) {
    console.error("Delete Version Error:", e);
    res.status(500).json({ error: e.message });
  }
});

  app.get("/api/admin/cards/:id/notes", authMiddleware, async (req, res) => {
  try {
    const card = await cardsDbGet("SELECT notes FROM cards WHERE id = ?", [req.params.id]);
    if (!card) return res.status(404).json({ error: "卡牌不存在" });
    const notes = card.notes ? JSON.parse(card.notes) : [];
    res.json({ notes });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

  app.post("/api/admin/cards/:id/notes", authMiddleware, async (req, res) => {
  const { content, selected_text } = req.body || {};
  if (!content) return res.status(400).json({ error: "批注内容不能为空" });
  try {
    const card = await cardsDbGet("SELECT notes FROM cards WHERE id = ?", [req.params.id]);
    if (!card) return res.status(404).json({ error: "卡牌不存在" });
    const notes = card.notes ? JSON.parse(card.notes) : [];
    const ts = Date.now();
    notes.push({ id: ts, author: req.user.uid, author_name: req.user.username || null, content, selected_text: selected_text || null, completed: false, created_at: ts });
    await cardsDbRun("UPDATE cards SET notes=? WHERE id=?", [JSON.stringify(notes), req.params.id]);
    res.json({ ok: true, notes });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 编辑批注（修改内容 or 标记完成）
  app.put("/api/admin/cards/:id/notes/:noteId", authMiddleware, async (req, res) => {
  const { content, completed } = req.body || {};
  try {
    const card = await cardsDbGet("SELECT notes FROM cards WHERE id = ?", [req.params.id]);
    if (!card) return res.status(404).json({ error: "卡牌不存在" });
    const notes = card.notes ? JSON.parse(card.notes) : [];
    const nid = parseInt(req.params.noteId);
    const idx = notes.findIndex(n => n.id === nid || n.created_at === nid);
    if (idx === -1) return res.status(404).json({ error: "批注不存在" });
    if (content !== undefined) notes[idx].content = content;
    if (completed !== undefined) notes[idx].completed = completed;
    await cardsDbRun("UPDATE cards SET notes=? WHERE id=?", [JSON.stringify(notes), req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 删除批注
  app.delete("/api/admin/cards/:id/notes/:noteId", authMiddleware, async (req, res) => {
  try {
    const card = await cardsDbGet("SELECT notes FROM cards WHERE id = ?", [req.params.id]);
    if (!card) return res.status(404).json({ error: "卡牌不存在" });
    const notes = card.notes ? JSON.parse(card.notes) : [];
    const nid = parseInt(req.params.noteId);
    const filtered = notes.filter(n => n.id !== nid && n.created_at !== nid);
    if (filtered.length === notes.length) return res.status(404).json({ error: "批注不存在" });
    await cardsDbRun("UPDATE cards SET notes=? WHERE id=?", [JSON.stringify(filtered), req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 创建新版本（存入 card_versions）
  app.post("/api/admin/cards/:id/branch", authMiddleware, async (req, res) => {
  const { version_label, note, branch, parent_id } = req.body || {};
  try {
    const src = await cardsDbGet("SELECT * FROM cards WHERE id = ?", [req.params.id]);
    if (!src) return res.status(404).json({ error: "卡牌不存在" });

    const label = version_label || `v${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-新版本`;
    const branchName = branch || 'main';
    const now = Date.now();

    // 计算下一版本号
    const maxVer = await cardsDbGet("SELECT MAX(version) as v FROM card_versions WHERE card_id = ?", [src.id]);
    const nextVersion = (maxVer?.v || src.version || 0) + 1;

    const result = await cardsDbRun(
      `INSERT INTO card_versions(card_id, key, safety_type, event, phase, options_json, audio_url, attribute_reason, version, version_label, note, branch, parent_id, author_id, created_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [src.id, src.key, src.safety_type, src.event, src.phase, src.options_json, src.audio_url, src.attribute_reason,
        nextVersion, label, note || null, branchName, parent_id || null, req.user.uid, now]
    );
    res.json({ ok: true, version_id: result.lastID, version: nextVersion, version_label: label });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 更新版本内容
  app.put("/api/admin/card-versions/:id", authMiddleware, async (req, res) => {
  try {
    const ver = await cardsDbGet("SELECT * FROM card_versions WHERE id = ?", [req.params.id]);
    if (!ver) return res.status(404).json({ error: "版本不存在" });

    const updates = req.body;
    const safetyType = updates.safetyType || ver.safety_type;
    const event = updates.event || ver.event;
    const phase = updates.phase !== undefined ? updates.phase : ver.phase;
    const optionsJson = updates.options ? JSON.stringify(updates.options) : ver.options_json;
    const audioUrl = updates.audio_url !== undefined ? updates.audio_url : ver.audio_url;
    const attributeReason = updates.attributeReason !== undefined ? (updates.attributeReason || null) : ver.attribute_reason;
    const nowStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const submitter = req.user.username || String(req.user.uid);
    const desc = updates.versionDesc ? ` · ${updates.versionDesc}` : '';
    const versionLabel = updates.version_label || `v${ver.version || 1}.${nowStr}版 — ${submitter}${desc}`;
    const note = updates.note !== undefined ? updates.note : ver.note;

    await cardsDbRun(
      `UPDATE card_versions SET safety_type=?, event=?, phase=?, options_json=?, audio_url=?, attribute_reason=?, version_label=?, note=?, author_id=? WHERE id=?`,
      [safetyType, event, phase, optionsJson, audioUrl, attributeReason, versionLabel, note, req.user.uid, req.params.id]
    );
    res.json({ ok: true, version_id: parseInt(req.params.id), version_label: versionLabel });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Promote: 把某个版本推送到沙盒（card_versions → cards）
  app.post("/api/admin/card-versions/:id/promote", authMiddleware, async (req, res) => {
  try {
    const ver = await cardsDbGet("SELECT * FROM card_versions WHERE id = ?", [req.params.id]);
    if (!ver) return res.status(404).json({ error: "版本不存在" });

    const now = Date.now();
    await cardsDbRun(
      `UPDATE cards SET safety_type=?, event=?, phase=?, options_json=?, audio_url=?, attribute_reason=?,
       current_version_id=?, status='active', updated_at=? WHERE id=?`,
      [ver.safety_type, ver.event, ver.phase, ver.options_json, ver.audio_url, ver.attribute_reason,
        ver.id, now, ver.card_id]
    );

    // 记录推送时间
    await cardsDbRun("UPDATE card_versions SET promoted_at=? WHERE id=?", [now, ver.id]);

    res.json({ ok: true, card_id: ver.card_id, version_id: ver.id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Release: 把沙盒内容发布到游戏（cards → cards_released）
  app.post("/api/admin/cards/:id/release", authMiddleware, async (req, res) => {
  try {
    const card = await cardsDbGet("SELECT * FROM cards WHERE id = ?", [req.params.id]);
    if (!card) return res.status(404).json({ error: "卡牌不存在" });
    if (card.status !== 'active') return res.status(400).json({ error: "只能发布 active 状态的卡牌" });

    const now = Date.now();
    const label = req.body?.version_label || `发布于${new Date().toISOString().slice(0, 10)}`;

    await cardsDbRun(
      `INSERT INTO cards_released (card_id, key, safety_type, event, phase, options_json, audio_url, attribute_reason, card_code, title, guide_text, version_label, from_version_id, released_by, released_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [card.id, card.key, card.safety_type, card.event, card.phase, card.options_json,
        card.audio_url, card.attribute_reason, card.card_code, card.title, card.guide_text,
        label, card.current_version_id, req.user.uid, now]
    );

    res.json({ ok: true, card_id: card.id, key: card.key });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});


// ======== 登录 / 账号资产模块路由（已抽出到 src/routes/）========
  app.use(authRouter);
  app.use(accountAdminRouter);
  app.use(adminDataRouter);

  app.use((req, res) => {
    if (req.path.startsWith("/api/") || req.path.startsWith("/enterprise/api") || req.path.startsWith("/admin/api")) {
      return res.status(404).json({ error: "接口不存在", path: req.path });
    }
    if (req.accepts("json") && !req.accepts("html")) {
      return res.status(404).json({ error: "资源不存在", path: req.path });
    }
    res.status(404).sendFile(path.join(ROOT_DIR, "public", "404.html"));
  });


  return app;
}

