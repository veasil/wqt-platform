import bcrypt from "bcryptjs";
import { dbRun, dbGet, dbAll } from "../../db.js";
import { authMiddleware } from "../../middleware/auth.js";
import { resolveValidity } from "../../account.js";

export function registerProfileRoutes(app, { ossClient = null } = {}) {
  app.get("/api/me", authMiddleware, async (req, res) => {
    try {
      const user = await dbGet(
        "SELECT id, username, phone, real_name, guardian_name, role, watcher_level, enterprise_id FROM users WHERE id = ?",
        [req.user.uid],
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
          role: user.role || "watcher",
          watcherLevel: user.watcher_level || "initial",
          enterpriseId: user.enterprise_id || null,
          validUntil: validity.until ?? null,
          validityValid: validity.valid,
          validitySource: user.enterprise_id ? "org" : "user",
        },
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // 我的活动列表
  app.get("/api/me/activities", authMiddleware, async (req, res) => {
    const uid = req.user.uid;
    try {
      const rows = await dbAll(
        `
      SELECT a.id, a.name, a.activity_code, a.started_at, a.ended_at,
             as2.table_no, gs.final_score, gs.started_at as session_started,
             gs.ended_at as session_ended, gs.id as session_id
      FROM activity_sessions as2
      JOIN activities a ON a.id = as2.activity_id
      JOIN game_sessions gs ON gs.id = as2.session_id
      WHERE gs.user_id = ?
      ORDER BY gs.started_at DESC
    `,
        [uid],
      );
      res.json({ activities: rows });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // 我发起/申请的活动（含审核状态）。status: pending_approval | active | ...
  app.get("/api/me/activities/created", authMiddleware, async (req, res) => {
    const uid = req.user.uid;
    try {
      const rows = await dbAll(
        `
      SELECT a.id, a.name, a.organizer, a.activity_code, a.started_at, a.ended_at, a.status, a.created_at,
             COUNT(DISTINCT as2.session_id) as table_count
      FROM activities a
      LEFT JOIN activity_sessions as2 ON as2.activity_id = a.id
      WHERE a.created_by = ?
      GROUP BY a.id
      ORDER BY a.created_at DESC
    `,
        [uid],
      );
      res.json({ activities: rows });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // 提交感想/反馈
  app.post("/api/me/feedback", authMiddleware, async (req, res) => {
    const uid = req.user.uid;
    const {
      type = "reflection",
      content,
      activity_id,
      session_id,
    } = req.body || {};
    if (!content || !String(content).trim())
      return res.status(400).json({ error: "内容不能为空" });
    try {
      const result = await dbRun(
        "INSERT INTO user_feedback(user_id, type, content, activity_id, session_id) VALUES(?,?,?,?,?)",
        [uid, type, content.trim(), activity_id || null, session_id || null],
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
      const user = await dbGet("SELECT watcher_level FROM users WHERE id = ?", [
        uid,
      ]);
      if (!user) return res.status(404).json({ error: "用户不存在" });

      // 检查是否已有 pending 申请
      const existing = await dbGet(
        "SELECT id FROM watcher_level_applications WHERE user_id = ? AND status = 'pending'",
        [uid],
      );
      if (existing)
        return res.status(400).json({ error: "已有待审核的申请，请等待" });

      const levelMap = { initial: "advanced", advanced: "mentor" };
      const toLevel = levelMap[user.watcher_level];
      if (!toLevel)
        return res.status(400).json({ error: "已是最高等级，无需申请" });

      const result = await dbRun(
        "INSERT INTO watcher_level_applications(user_id, from_level, to_level, reason) VALUES(?,?,?,?)",
        [uid, user.watcher_level, toLevel, reason || null],
      );
      res.json({
        ok: true,
        id: result.lastID,
        fromLevel: user.watcher_level,
        toLevel,
      });
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
        [uid],
      );
      res.json({ application: row || null });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // 修改密码
  app.put("/api/me/password", authMiddleware, async (req, res) => {
    const { oldPassword, newPassword } = req.body || {};
    if (!newPassword || String(newPassword).length < 6)
      return res.status(400).json({ error: "新密码至少 6 位" });
    try {
      const user = await dbGet("SELECT password_hash FROM users WHERE id = ?", [
        req.user.uid,
      ]);
      if (!user) return res.status(404).json({ error: "用户不存在" });
      // 如果用户已有密码，必须验证旧密码
      if (user.password_hash) {
        if (!oldPassword)
          return res.status(400).json({ error: "请输入旧密码" });
        if (!bcrypt.compareSync(oldPassword, user.password_hash))
          return res.status(401).json({ error: "旧密码错误" });
      }
      const hash = bcrypt.hashSync(newPassword, 10);
      await dbRun("UPDATE users SET password_hash = ? WHERE id = ?", [
        hash,
        req.user.uid,
      ]);
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
      await dbRun(
        `UPDATE users SET ${updateFields.join(", ")} WHERE id = ?`,
        updateValues,
      );

      const user = await dbGet(
        "SELECT id, username, phone, guardian_name, real_name, role, enterprise_id FROM users WHERE id = ?",
        [userId],
      );
      res.json({
        user: {
          id: user.id,
          username: user.username || user.phone,
          phone: user.phone,
          realName: user.real_name || null,
          guardianName: user.guardian_name,
          role: user.role,
          enterpriseId: user.enterprise_id || null,
        },
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
        [uid, limit, offset],
      );
      const total = await dbGet(
        "SELECT COUNT(*) as cnt FROM game_sessions WHERE user_id = ? AND status != 'abandoned'",
        [uid],
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
      const audioResult = await ossClient.list({
        prefix: `game-audio/user_${uid}_`,
        "max-keys": 100,
      });
      if (audioResult.objects) {
        for (const obj of audioResult.objects) {
          files.push({
            name: obj.name.split("/").pop(),
            key: obj.name,
            type: "audio",
            size: obj.size,
            lastModified: obj.lastModified,
            url: customDomain ? `${customDomain}/${obj.name}` : obj.url,
          });
        }
      }

      // 列出复盘报告
      const reportResult = await ossClient.list({
        prefix: `game-review/report_${uid}_`,
        "max-keys": 100,
      });
      if (reportResult.objects) {
        for (const obj of reportResult.objects) {
          files.push({
            name: obj.name.split("/").pop(),
            key: obj.name,
            type: obj.name.endsWith(".html") ? "report_html" : "report_md",
            size: obj.size,
            lastModified: obj.lastModified,
            url: customDomain ? `${customDomain}/${obj.name}` : obj.url,
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
}
