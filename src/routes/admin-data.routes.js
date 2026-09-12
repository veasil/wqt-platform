// admin-web 迁移所需的后端接口（替代 Streamlit 直连 SQLite 的部分）。
// 对应 docs/MIGRATION_PLAYBOOK.md 的接口缺口矩阵 G1~G15。
import { Router } from "express";
import bcrypt from "bcryptjs";
import { dbGet, dbAll, dbRun, withTransaction } from "../db.js";
import { authMiddleware } from "../middleware/auth.js";
import { requireRole } from "../middleware/rbac.js";
import { encryptVal, decryptVal } from "../config.js";

const router = Router();
const boss = [authMiddleware, requireRole("boss")];

// 与 admin-panel/db_utils.py 的 SENSITIVE 判定保持一致
const SENSITIVE_KEYS = [
  "JWT_SECRET", "OSS_BUCKET_NAME", "OSS_REGION", "OSS_ENDPOINT",
  "ALIBABA_CLOUD_ACCESS_KEY_ID", "ALIBABA_CLOUD_ACCESS_KEY_SECRET",
  "BMOB_APP_ID", "BMOB_REST_KEY", "DEEPSEEK_API_KEY", "DASHSCOPE_API_KEY",
  "TOAPIS_API_KEY",
];
const isSensitive = (key) =>
  SENSITIVE_KEYS.some((s) => key.includes(s)) || key.includes("KEY") || key.includes("SECRET");

// ───────────────────────────── G1 概览统计 ─────────────────────────────
router.get("/api/admin/stats/overview", boss, async (req, res) => {
  try {
    const totalUsers = (await dbGet("SELECT COUNT(*) c FROM users")).c;
    const usersByRole = await dbAll("SELECT role, COUNT(*) c FROM users GROUP BY role");
    const totalSessions = (await dbGet("SELECT COUNT(*) c FROM game_sessions")).c;
    const sessionsByStatus = await dbAll("SELECT status, COUNT(*) c FROM game_sessions GROUP BY status");
    const totalOrgs = (await dbGet("SELECT COUNT(*) c FROM organizations")).c;
    // 近 14 天每日新增用户 / 场次（created_at / started_at 为毫秒时间戳）
    const since = Date.now() - 14 * 86400_000;
    const dailySignups = await dbAll(
      "SELECT to_char(to_timestamp(created_at/1000) AT TIME ZONE 'Asia/Shanghai','YYYY-MM-DD') d, COUNT(*) c FROM users WHERE created_at >= ? GROUP BY d ORDER BY d",
      [since]
    );
    const dailySessions = await dbAll(
      "SELECT to_char(to_timestamp(started_at/1000) AT TIME ZONE 'Asia/Shanghai','YYYY-MM-DD') d, COUNT(*) c FROM game_sessions WHERE started_at >= ? GROUP BY d ORDER BY d",
      [since]
    );
    res.json({ totalUsers, usersByRole, totalSessions, sessionsByStatus, totalOrgs, dailySignups, dailySessions });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ───────────────────────────── G2 用户列表 ─────────────────────────────
router.get("/api/admin/users", boss, async (req, res) => {
  try {
    const { role, enterprise_id, q } = req.query;
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const offset = Number(req.query.offset) || 0;
    const where = [], params = [];
    if (role) { where.push("u.role = ?"); params.push(role); }
    if (enterprise_id) { where.push("u.enterprise_id = ?"); params.push(enterprise_id); }
    if (q) { where.push("(u.phone LIKE ? OR u.username LIKE ? OR u.guardian_name LIKE ?)"); params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
    const whereSql = where.length ? "WHERE " + where.join(" AND ") : "";
    const total = (await dbGet(`SELECT COUNT(*) c FROM users u ${whereSql}`, params)).c;
    const rows = await dbAll(
      `SELECT u.id, u.username, u.phone, u.guardian_name, u.real_name, u.role,
              u.enterprise_id, o.name AS enterprise_name, u.valid_until, u.created_at,
              u.is_profile_complete
       FROM users u LEFT JOIN organizations o ON u.enterprise_id = o.id
       ${whereSql} ORDER BY u.id DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    res.json({ total, limit, offset, users: rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ───────────────────────────── G3 建号 ─────────────────────────────
router.post("/api/admin/users", boss, async (req, res) => {
  try {
    const { phone, username, guardianName, realName, role = "watcher", enterpriseId, password } = req.body || {};
    if (!phone && !username) return res.status(400).json({ error: "手机号或用户名至少填一个" });
    if (phone) {
      const dup = await dbGet("SELECT id FROM users WHERE phone = ?", [phone]);
      if (dup) return res.status(409).json({ error: "该手机号已存在" });
    }
    if (username) {
      const dup = await dbGet("SELECT id FROM users WHERE username = ?", [username]);
      if (dup) return res.status(409).json({ error: "该用户名已存在" });
    }
    const pwd = password || (phone ? String(phone).slice(-6) : "123456");
    const hash = bcrypt.hashSync(pwd, 10);
    const r = await dbRun(
      `INSERT INTO users(phone, username, guardian_name, real_name, password_hash, role, enterprise_id, is_profile_complete, created_at)
       VALUES(?,?,?,?,?,?,?,?,?)`,
      [phone || null, username || null, guardianName || null, realName || null, hash, role, enterpriseId || null, guardianName ? 1 : 0, Date.now()]
    );
    res.json({ ok: true, id: r.lastID });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ───────────────────────────── G4 改用户 ─────────────────────────────
router.put("/api/admin/users/:id", boss, async (req, res) => {
  try {
    const user = await dbGet("SELECT id FROM users WHERE id = ?", [req.params.id]);
    if (!user) return res.status(404).json({ error: "用户不存在" });
    const { role, enterpriseId, guardianName, realName, username, password } = req.body || {};
    const sets = [], params = [];
    if (role !== undefined) { sets.push("role = ?"); params.push(role); }
    if (enterpriseId !== undefined) { sets.push("enterprise_id = ?"); params.push(enterpriseId || null); }
    if (guardianName !== undefined) { sets.push("guardian_name = ?"); params.push(guardianName); }
    if (realName !== undefined) { sets.push("real_name = ?"); params.push(realName); }
    if (username !== undefined) { sets.push("username = ?"); params.push(username); }
    if (password) { sets.push("password_hash = ?"); params.push(bcrypt.hashSync(password, 10)); }
    if (!sets.length) return res.status(400).json({ error: "没有要更新的字段" });
    params.push(req.params.id);
    await dbRun(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`, params);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ───────────────────────────── G5 删用户（级联）─────────────────────────────
router.delete("/api/admin/users/:id", boss, async (req, res) => {
  try {
    const result = await withTransaction(async tx => {
      const user = await tx.get("SELECT id FROM users WHERE id = ? FOR UPDATE", [req.params.id]);
      if (!user) return 404;
      if (await tx.get("SELECT id FROM game_sessions WHERE user_id = ? LIMIT 1", [user.id])) return 409;
      if (await tx.get("SELECT id FROM organizations WHERE owner_user_id = ? LIMIT 1", [user.id])) return 409;
      for (const table of ["user_feedback", "watcher_level_applications", "watcher_level_logs", "user_sessions"]) {
        const exists = await tx.get("SELECT to_regclass(?) AS name", [table]);
        if (exists.name) await tx.run(`DELETE FROM ${table} WHERE user_id = ?`, [user.id]);
      }
      await tx.run("DELETE FROM users WHERE id = ?", [user.id]);
      return 200;
    });
    if (result === 404) return res.status(404).json({ error: "用户不存在" });
    if (result === 409) return res.status(409).json({ error: "账号关联历史场次或组织，不能通过删除账号级联删除历史数据" });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ───────────────────────────── G6 组织成员列表 ─────────────────────────────
router.get("/api/admin/organizations/:id/members", boss, async (req, res) => {
  try {
    const org = await dbGet("SELECT id, name, max_members FROM organizations WHERE id = ?", [req.params.id]);
    if (!org) return res.status(404).json({ error: "组织不存在" });
    const members = await dbAll(
      `SELECT id, username, phone, guardian_name, real_name, role, is_profile_complete, created_at
       FROM users WHERE enterprise_id = ? ORDER BY id DESC`,
      [req.params.id]
    );
    res.json({ organization: org, count: members.length, members });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ───────────────────────────── G7 批量建号 ─────────────────────────────
router.post("/api/admin/organizations/:id/members/batch", boss, async (req, res) => {
  try {
    const org = await dbGet("SELECT id, max_members FROM organizations WHERE id = ?", [req.params.id]);
    if (!org) return res.status(404).json({ error: "组织不存在" });
    const members = Array.isArray(req.body?.members) ? req.body.members : [];
    if (!members.length) return res.status(400).json({ error: "members 不能为空" });
    const created = [], skipped = [];
    for (const m of members) {
      const phone = (m.phone || "").trim();
      if (!phone) { skipped.push({ phone, reason: "无手机号" }); continue; }
      const dup = await dbGet("SELECT id FROM users WHERE phone = ?", [phone]);
      if (dup) { skipped.push({ phone, reason: "已存在" }); continue; }
      const hash = bcrypt.hashSync(m.password || phone.slice(-6), 10);
      const r = await dbRun(
        `INSERT INTO users(phone, guardian_name, real_name, password_hash, role, enterprise_id, is_profile_complete, created_at)
         VALUES(?,?,?,?,'watcher',?,1,?)`,
        [phone, m.guardianName || null, m.realName || null, hash, org.id, Date.now()]
      );
      created.push({ id: r.lastID, phone });
    }
    res.json({ ok: true, createdCount: created.length, created, skipped });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ───────────────────────────── G8 场次/卡牌统计 ─────────────────────────────
router.get("/api/admin/stats/sessions", boss, async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 200, 1000);
    const rows = await dbAll(
      `SELECT s.id, s.user_id, u.guardian_name, u.phone, s.started_at, s.ended_at,
              s.final_score, s.game_mode, s.status, s.location,
              (SELECT COUNT(*) FROM game_events e WHERE e.session_id = s.id AND e.type = 'card_choice') AS card_count
       FROM game_sessions s LEFT JOIN users u ON s.user_id = u.id
       ORDER BY s.id DESC LIMIT ?`,
      [limit]
    );
    res.json({ count: rows.length, sessions: rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/api/admin/stats/cards", boss, async (req, res) => {
  try {
    // 每张卡（按 payload 中的 key）被选次数 —— payload 是 JSON 文本，这里按 type 汇总，明细交前端解析
    const totalChoices = (await dbGet("SELECT COUNT(*) c FROM game_events WHERE type = 'card_choice'")).c;
    const events = await dbAll(
      "SELECT session_id, ts, payload FROM game_events WHERE type = 'card_choice' ORDER BY ts DESC LIMIT 5000"
    );
    res.json({ totalChoices, events });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ───────────────────────────── G9 单场次事件明细 ─────────────────────────────
router.get("/api/admin/sessions/:id/events", boss, async (req, res) => {
  try {
    const session = await dbGet(
      `SELECT s.*, u.guardian_name, u.phone FROM game_sessions s
       LEFT JOIN users u ON s.user_id = u.id WHERE s.id = ?`,
      [req.params.id]
    );
    if (!session) return res.status(404).json({ error: "场次不存在" });
    const events = await dbAll("SELECT * FROM game_events WHERE session_id = ? ORDER BY ts ASC", [req.params.id]);
    res.json({ session, events });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ───────────────────────────── G11 / G12 系统设置 ─────────────────────────────
router.get("/api/admin/settings", boss, async (req, res) => {
  try {
    const rows = await dbAll("SELECT key, value, description, updated_at FROM system_settings ORDER BY key ASC");
    const settings = rows.map((r) => ({
      key: r.key,
      value: decryptVal(r.value),
      sensitive: isSensitive(r.key),
      description: r.description,
      updated_at: r.updated_at,
    }));
    res.json({ settings });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put("/api/admin/settings", boss, async (req, res) => {
  try {
    const { key, value, description } = req.body || {};
    if (!key) return res.status(400).json({ error: "缺少 key" });
    const stored = isSensitive(key) ? encryptVal(String(value ?? "")) : String(value ?? "");
    await dbRun(
      `INSERT INTO system_settings(key, value, description, updated_at)
       VALUES(?,?,?,CURRENT_TIMESTAMP)
       ON CONFLICT(key) DO UPDATE SET value=excluded.value,
         description=COALESCE(excluded.description, system_settings.description),
         updated_at=excluded.updated_at`,
      [key, stored, description ?? null]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ───────────────────────────── G13 运营账号 ─────────────────────────────
router.get("/api/admin/operators", boss, async (req, res) => {
  try {
    const operators = await dbAll(
      "SELECT id, guardian_name, phone, username, created_at FROM users WHERE role = 'operator' ORDER BY id DESC"
    );
    res.json({ operators });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ───────────────────────────── G14 场次审计列表 ─────────────────────────────
router.get("/api/admin/audit/sessions", boss, async (req, res) => {
  try {
    const { status } = req.query;
    const counts = await dbAll("SELECT status, COUNT(*) c FROM game_sessions GROUP BY status");
    const params = [];
    let where = "";
    if (status) { where = "WHERE s.status = ?"; params.push(status); }
    const limit = Math.min(Number(req.query.limit) || 300, 1000);
    const sessions = await dbAll(
      `SELECT s.id, s.user_id, u.guardian_name, u.phone, s.started_at, s.ended_at,
              s.final_score, s.status, s.game_mode,
              (SELECT COUNT(*) FROM game_events e WHERE e.session_id = s.id AND e.type = 'card_choice') AS card_count
       FROM game_sessions s LEFT JOIN users u ON s.user_id = u.id
       ${where} ORDER BY s.id DESC LIMIT ?`,
      [...params, limit]
    );
    res.json({ counts, sessions });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ───────────────────────────── G15 改场次状态 / 删场次 ─────────────────────────────
router.put("/api/admin/sessions/:id/status", boss, async (req, res) => {
  try {
    const session = await dbGet("SELECT id FROM game_sessions WHERE id = ?", [req.params.id]);
    if (!session) return res.status(404).json({ error: "场次不存在" });
    const { status } = req.body || {};
    if (!status) return res.status(400).json({ error: "缺少 status" });
    await dbRun("UPDATE game_sessions SET status = ? WHERE id = ?", [status, req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete("/api/admin/sessions/:id", boss, async (req, res) => {
  try {
    const outcome = await withTransaction(async tx => {
      const session = await tx.get("SELECT id FROM game_sessions WHERE id = ? FOR UPDATE", [req.params.id]);
      if (!session) return 404;
      if (await tx.get("SELECT id FROM session_files WHERE session_id = ? LIMIT 1", [session.id])) return 409;
      await tx.run("DELETE FROM activity_sessions WHERE session_id = ?", [session.id]);
      await tx.run("DELETE FROM game_events WHERE session_id = ?", [session.id]);
      await tx.run("DELETE FROM game_sessions WHERE id = ?", [session.id]);
      return 200;
    });
    if (outcome === 404) return res.status(404).json({ error: "场次不存在" });
    if (outcome === 409) return res.status(409).json({ error: "场次关联私有文件，需按独立数据保留流程处理" });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;
