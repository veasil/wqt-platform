import { withTransaction } from "../../db.js";
import { cardsDbGet } from "../../cards-db.js";
import {
  accessibleSession,
  currentActor,
} from "../../platform/access/session-scope.js";
import { domainError, linkActivity } from "../activities/link.js";

export async function startSession(userId, input) {
  return withTransaction(async (tx) => {
    // This row lock serializes the snapshot with membership changes.
    const actor = await currentActor(userId, tx.get, { lock: true });
    if (!actor) throw domainError(401, "账号不存在");
    if (
      !actor.enterprise_id &&
      !["boss", "operator"].includes(actor.role) &&
      (actor.valid_until == null || actor.valid_until < Date.now())
    )
      throw domainError(403, "账号未开通或已到期");
    if (actor.enterprise_id) {
      const org = await tx.get(
        "SELECT status, valid_until FROM organizations WHERE id = ? FOR SHARE",
        [actor.enterprise_id],
      );
      if (
        !org ||
        org.status !== "active" ||
        org.valid_until == null ||
        org.valid_until < Date.now()
      )
        throw domainError(403, "组织不存在、已停用或已到期");
    }
    const result = await tx.run(
      "INSERT INTO game_sessions(user_id, started_at, location, players_json, game_mode, game_settings_json, card_group_id, organization_id, ownership_kind) VALUES(?,?,?,?,?,?,?,?,?)",
      [
        userId,
        Number(input.ts || Date.now()),
        input.location,
        input.players ? JSON.stringify(input.players) : null,
        input.mode,
        input.settings ? JSON.stringify(input.settings) : null,
        input.cardGroupId ? Number(input.cardGroupId) : null,
        actor.enterprise_id || null,
        actor.enterprise_id ? "organization" : "personal",
      ],
    );
    const session = {
      id: result.lastID,
      organization_id: actor.enterprise_id || null,
      ownership_kind: actor.enterprise_id ? "organization" : "personal",
    };
    const activity = input.activityCode
      ? await linkActivity(tx, session, input.activityCode)
      : null;
    return { ok: true, sessionId: session.id, activity };
  });
}

export async function writeEvent(userId, { sessionId, type, payload }) {
  if (!sessionId || !type) throw domainError(400, "缺少 sessionId 或 type");
  return withTransaction(async (tx) => {
    const session = await accessibleSession(userId, sessionId, {
      write: true,
      get: tx.get,
      lock: true,
    });
    if (!session) throw domainError(404, "游戏不存在");
    await tx.run(
      "INSERT INTO game_events(session_id, ts, type, payload) VALUES(?,?,?,?)",
      [session.id, Date.now(), String(type), JSON.stringify(payload || {})],
    );
    return { ok: true };
  });
}

export async function finishSession(userId, input) {
  return withTransaction(async (tx) => {
    const { sessionId, endedAt, finalScore, payload, attributes } = input;
    if (!sessionId) throw domainError(400, "缺少 sessionId");

    // 获取该场次的卡牌组信息以计算得分率
    const session = await accessibleSession(userId, sessionId, {
      write: true,
      get: tx.get,
      lock: true,
    });
    if (!session) throw domainError(404, "游戏不存在");

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

    await tx.run(
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

    return { ok: true, finalScore: scoreRate, scoreDetails };
  });
}

export async function joinActivity(userId, { session_id, activity_code }) {
  if (!session_id || !activity_code) throw domainError(400, "缺少参数");
  return withTransaction(async (tx) => {
    const session = await accessibleSession(userId, session_id, {
      write: true,
      get: tx.get,
      lock: true,
    });
    if (!session) throw domainError(404, "游戏不存在");
    const activity = await linkActivity(tx, session, activity_code);
    return { ok: true, activity };
  });
}
