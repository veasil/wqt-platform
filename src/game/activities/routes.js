import { dbRun, dbGet, dbAll } from "../../db.js";
import { authMiddleware } from "../../middleware/auth.js";
import { generateActivityCode } from "./codes.js";

export function registerActivityRoutes(app) {
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
      const code = await generateActivityCode(category || "general");
      const result = await dbRun(
        "INSERT INTO activities(name, organizer, activity_code, started_at, ended_at, created_by) VALUES(?,?,?,?,?,?)",
        [
          name,
          organizer || null,
          code,
          started_at || null,
          ended_at || null,
          req.user.uid,
        ],
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
      const existing = await dbGet("SELECT * FROM activities WHERE id = ?", [
        id,
      ]);
      if (!existing) return res.status(404).json({ error: "活动不存在" });
      await dbRun(
        "UPDATE activities SET name=?, organizer=?, started_at=?, ended_at=?, status=? WHERE id=?",
        [
          name || existing.name,
          organizer ?? existing.organizer,
          started_at ?? existing.started_at,
          ended_at ?? existing.ended_at,
          status || existing.status,
          id,
        ],
      );
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get(
    "/api/admin/activities/:id/sessions",
    authMiddleware,
    async (req, res) => {
      try {
        const rows = await dbAll(
          `
      SELECT gs.id, gs.started_at, gs.ended_at, gs.final_score, gs.game_mode,
             u.guardian_name, u.phone, as2.table_no
      FROM activity_sessions as2
      JOIN game_sessions gs ON gs.id = as2.session_id
      JOIN users u ON u.id = gs.user_id
      WHERE as2.activity_id = ?
      ORDER BY as2.table_no ASC
    `,
          [req.params.id],
        );
        res.json({ sessions: rows });
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    },
  );

  // 游戏开始时关联活动（通过活动码）
  app.post("/api/game/join-activity", authMiddleware, async (req, res) => {
    const { activity_code, session_id } = req.body || {};
    if (!activity_code || !session_id)
      return res.status(400).json({ error: "缺少参数" });
    try {
      const activity = await dbGet(
        "SELECT * FROM activities WHERE activity_code = ? AND status = 'active'",
        [activity_code.toUpperCase()],
      );
      if (!activity)
        return res.status(404).json({ error: "活动码无效或活动已结束" });

      // 获取该活动当前最大桌号
      const maxTable = await dbGet(
        "SELECT MAX(table_no) as max FROM activity_sessions WHERE activity_id = ?",
        [activity.id],
      );
      const table_no = (maxTable?.max || 0) + 1;

      await dbRun(
        "INSERT OR IGNORE INTO activity_sessions(activity_id, session_id, table_no) VALUES(?,?,?)",
        [activity.id, session_id, table_no],
      );
      res.json({
        ok: true,
        activity_id: activity.id,
        activity_name: activity.name,
        table_no,
      });
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
        [code.toUpperCase()],
      );
      if (!activity) return res.status(404).json({ error: "活动码无效" });
      if (activity.status !== "active")
        return res.status(410).json({ error: "活动尚未开放或已结束" });

      // ?withSessions=1：附带桌次成绩（守望师名+分数），供「查询活动」展示
      let sessions = undefined;
      if (req.query.withSessions) {
        sessions = await dbAll(
          `
        SELECT as2.table_no, u.guardian_name, gs.final_score, gs.ended_at
        FROM activity_sessions as2
        JOIN game_sessions gs ON gs.id = as2.session_id
        JOIN users u ON u.id = gs.user_id
        WHERE as2.activity_id = ?
        ORDER BY as2.table_no ASC
      `,
          [activity.id],
        );
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
      const code = await generateActivityCode(category || "general");
      const result = await dbRun(
        "INSERT INTO activities(name, organizer, activity_code, started_at, created_by) VALUES(?,?,?,?,?)",
        [name, location || null, code, started_at || Date.now(), req.user.uid],
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
      const code = await generateActivityCode("apply");
      const result = await dbRun(
        "INSERT INTO activities(name, organizer, activity_code, started_at, created_by, status) VALUES(?,?,?,?,?,?)",
        [
          name,
          location || null,
          code,
          Date.now(),
          req.user.uid,
          "pending_approval",
        ],
      );
      res.json({ ok: true, id: result.lastID, activity_code: code });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ======== API: Admin 等级申请管理 ========
  app.get("/api/admin/level-applications", authMiddleware, async (req, res) => {
    const { status = "pending" } = req.query;
    try {
      const rows = await dbAll(
        `
      SELECT la.*, u.guardian_name, u.phone, u.username
      FROM watcher_level_applications la
      JOIN users u ON u.id = la.user_id
      WHERE la.status = ?
      ORDER BY la.created_at DESC
    `,
        [status],
      );
      res.json({ applications: rows });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.put(
    "/api/admin/level-applications/:id",
    authMiddleware,
    async (req, res) => {
      const { id } = req.params;
      const { action, note } = req.body || {}; // action: 'approve' | 'reject'
      if (!["approve", "reject"].includes(action))
        return res
          .status(400)
          .json({ error: "action 必须为 approve 或 reject" });
      try {
        const app_row = await dbGet(
          "SELECT * FROM watcher_level_applications WHERE id = ?",
          [id],
        );
        if (!app_row) return res.status(404).json({ error: "申请不存在" });
        if (app_row.status !== "pending")
          return res.status(400).json({ error: "申请已处理" });

        const newStatus = action === "approve" ? "approved" : "rejected";
        const now = Date.now();
        await dbRun(
          "UPDATE watcher_level_applications SET status=?, reviewed_by=?, reviewed_at=?, note=? WHERE id=?",
          [newStatus, req.user.uid, now, note || null, id],
        );

        if (action === "approve") {
          // 更新用户等级
          const oldLevel = app_row.from_level;
          const newLevel = app_row.to_level;
          await dbRun("UPDATE users SET watcher_level=? WHERE id=?", [
            newLevel,
            app_row.user_id,
          ]);
          await dbRun(
            "INSERT INTO watcher_level_logs(user_id, old_level, new_level, source, changed_by, note) VALUES(?,?,?,?,?,?)",
            [
              app_row.user_id,
              oldLevel,
              newLevel,
              "application",
              req.user.uid,
              note || null,
            ],
          );
        }
        res.json({ ok: true, newStatus });
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    },
  );

  // Admin 手动调整用户等级（boss 专用）
  app.put("/api/admin/users/:id/level", authMiddleware, async (req, res) => {
    const { id } = req.params;
    const { level, note } = req.body || {};
    const validLevels = ["initial", "advanced", "mentor"];
    if (!validLevels.includes(level))
      return res.status(400).json({ error: "等级值无效" });
    try {
      const user = await dbGet("SELECT watcher_level FROM users WHERE id = ?", [
        id,
      ]);
      if (!user) return res.status(404).json({ error: "用户不存在" });
      await dbRun("UPDATE users SET watcher_level=? WHERE id=?", [level, id]);
      await dbRun(
        "INSERT INTO watcher_level_logs(user_id, old_level, new_level, source, changed_by, note) VALUES(?,?,?,?,?,?)",
        [id, user.watcher_level, level, "manual", req.user.uid, note || null],
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
      if (reviewed !== undefined) {
        sql += " WHERE f.reviewed = ?";
        params.push(Number(reviewed));
      }
      sql += " ORDER BY f.created_at DESC";
      const rows = await dbAll(sql, params);
      res.json({ feedback: rows });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.put("/api/admin/feedback/:id/read", authMiddleware, async (req, res) => {
    try {
      await dbRun("UPDATE user_feedback SET reviewed=1 WHERE id=?", [
        req.params.id,
      ]);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
}
