import { dbRun, dbGet, addGameEvent, getGameEvents } from "../../db.js";
import { cardsDbGet } from "../../cards-db.js";
import { authMiddleware } from "../../middleware/auth.js";
export function registerSessionRoutes(app) {
  app.post("/api/game/start", authMiddleware, async (req, res) => {
    const userId = req.user.uid;
    const ts = Number(req.body?.ts || Date.now());
    const { location, players, mode, settings, cardGroupId, activityCode } =
      req.body || {};

    const playersJson = players ? JSON.stringify(players) : null;
    const settingsJson = settings ? JSON.stringify(settings) : null;
    const groupId = cardGroupId ? Number(cardGroupId) : null;

    const r = await dbRun(
      "INSERT INTO game_sessions(user_id, started_at, location, players_json, game_mode, game_settings_json, card_group_id) VALUES(?, ?, ?, ?, ?, ?, ?)",
      [userId, ts, location, playersJson, mode, settingsJson, groupId],
    );
    const sessionId = r.lastID;

    // 如果传入了活动码，自动关联
    let activityInfo = null;
    if (activityCode) {
      const activity = await dbGet(
        "SELECT * FROM activities WHERE activity_code = ? AND status = 'active'",
        [activityCode.toUpperCase()],
      );
      if (activity) {
        const maxTable = await dbGet(
          "SELECT MAX(table_no) as max FROM activity_sessions WHERE activity_id = ?",
          [activity.id],
        );
        const table_no = (maxTable?.max || 0) + 1;
        await dbRun(
          "INSERT OR IGNORE INTO activity_sessions(activity_id, session_id, table_no) VALUES(?,?,?)",
          [activity.id, sessionId, table_no],
        );
        activityInfo = { id: activity.id, name: activity.name, table_no };
      }
    }

    res.json({ ok: true, sessionId, activity: activityInfo });
  });

  app.post("/api/game/finish", authMiddleware, async (req, res) => {
    const userId = req.user.uid;
    const { sessionId, endedAt, finalScore, payload, attributes } =
      req.body || {};
    if (!sessionId) return res.status(400).json({ error: "缺少 sessionId" });

    // 获取该场次的卡牌组信息以计算得分率
    const session = await dbGet(
      "SELECT card_group_id FROM game_sessions WHERE id=? AND user_id=?",
      [sessionId, userId],
    );
    if (!session) return res.status(404).json({ error: "游戏不存在" });

    let scoreRate = Number(finalScore || 0);
    let scoreDetails = null;

    // 如果前端传来了各维度实际得分 (attributes) 且有关联的卡牌组
    const attrs = attributes || (payload && payload.attributes) || null;
    if (attrs && typeof attrs === "object") {
      let maxScores = null;
      const groupId = session.card_group_id;
      if (groupId) {
        const group = await cardsDbGet(
          "SELECT max_scores_json FROM card_groups WHERE id = ?",
          [groupId],
        );
        if (group && group.max_scores_json) {
          try {
            maxScores = JSON.parse(group.max_scores_json);
          } catch (_) {}
        }
      }
      // 如果没有缓存的 max_scores，尝试用默认卡牌组
      if (!maxScores) {
        const defGroup = await cardsDbGet(
          "SELECT max_scores_json FROM card_groups WHERE is_default = 1 LIMIT 1",
        );
        if (defGroup && defGroup.max_scores_json) {
          try {
            maxScores = JSON.parse(defGroup.max_scores_json);
          } catch (_) {}
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
          details[dim] = {
            actual,
            max: maxVal,
            rate: Math.round(rate * 10000) / 10000,
          };
          totalRate += rate;
          dimCount++;
        }
        scoreRate = dimCount > 0 ? Math.round((totalRate / dimCount) * 100) : 0;
        scoreDetails = details;
      }
    }

    await dbRun(
      "UPDATE game_sessions SET ended_at=?, final_score=?, score_details_json=?, payload_json=? WHERE id=? AND user_id=?",
      [
        Number(endedAt || Date.now()),
        scoreRate,
        scoreDetails ? JSON.stringify(scoreDetails) : null,
        JSON.stringify(payload || {}),
        sessionId,
        userId,
      ],
    );

    res.json({ ok: true, finalScore: scoreRate, scoreDetails });
  });

  app.post("/api/game/event", authMiddleware, async (req, res) => {
    const userId = req.user.uid;
    const { sessionId, type, payload } = req.body || {};
    if (!sessionId || !type)
      return res.status(400).json({ error: "缺少 sessionId 或 type" });

    const session = await dbGet(
      "SELECT id FROM game_sessions WHERE id = ? AND user_id = ?",
      [sessionId, userId],
    );
    if (!session) return res.status(404).json({ error: "游戏不存在" });

    await addGameEvent(sessionId, String(type), payload || {});
    res.json({ ok: true });
  });

  app.get("/api/game/last-session", authMiddleware, async (req, res) => {
    const userId = req.user.uid;
    const session = await dbGet(
      "SELECT * FROM game_sessions WHERE user_id = ? ORDER BY started_at DESC LIMIT 1",
      [userId],
    );
    res.json({ session: session || null });
  });

  app.get("/api/game/session/:id", authMiddleware, async (req, res) => {
    const userId = req.user.uid;
    const sessionId = Number(req.params.id);
    if (!sessionId) return res.status(400).json({ error: "sessionId 不正确" });

    const session = await dbGet(
      "SELECT * FROM game_sessions WHERE id = ? AND user_id = ?",
      [sessionId, userId],
    );
    if (!session) return res.status(404).json({ error: "游戏不存在" });

    const events = await getGameEvents(sessionId);
    res.json({ session, events });
  });

  // ======== API: Cards Management ========
}
