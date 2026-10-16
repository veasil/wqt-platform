import crypto from "node:crypto";
import fetch from "node-fetch";
import { dbGet, withTransaction } from "../../db.js";
import { decryptVal } from "../../config.js";
import { authMiddleware } from "../../middleware/auth.js";
import { sessionEndpoint } from "../sessions/routes.js";
import { accessibleSession } from "../../platform/access/session-scope.js";
import { accountActor } from "../../platform/accounts/context.js";
import { domainError } from "../activities/link.js";
import { releasedCard } from "./routes.js";
import {selectLlmDefaults} from '../../services/llm-selection.js';
import {
  allowedInput,
  feedbackPrompt,
  parseSafeFeedback,
  safeGuidance,
} from "./feedback-policy.js";
let active = 0;
export async function generateFeedback(messages) {
  const setting = async (key) => {
    const row = await dbGet("SELECT value FROM system_settings WHERE key=?", [
      key,
    ]);
    return decryptVal(row?.value) || process.env[key];
  };
  const {provider,model}=selectLlmDefaults({}, {
    DEFAULT_LLM_PROVIDER:await setting('DEFAULT_LLM_PROVIDER'),
    DEFAULT_LLM_MODEL:await setting('DEFAULT_LLM_MODEL'),
  });
  const prefix = {
    OpenAI: "OPENAI",
    "Google Gemini": "GEMINI",
    "阿里云 DashScope": "DASHSCOPE",
    DeepSeek: "DEEPSEEK",
  }[provider];
  if (!prefix) throw domainError(503, "反馈AI供应商尚未配置");
  const key = await setting(prefix + "_API_KEY");
  if (!key) throw domainError(503, "反馈AI尚未配置");
  const url =
    (await setting(prefix + "_BASE_URL")) ||
    {
      OPENAI: "https://api.openai.com/v1/chat/completions",
      GEMINI:
        "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
      DASHSCOPE:
        "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
      DEEPSEEK: "https://api.deepseek.com/chat/completions",
    }[prefix];
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: 700,
      temperature: 0.4,
    }),
    signal: globalThis.AbortSignal.timeout(20000),
  });
  if (!response.ok) {
    const error=domainError(response.status===429?429:502,'反馈服务繁忙或暂不可用，请稍后重试');
    error.upstreamStatus=response.status;
    throw error;
  }
  const body = await response.json();
  return {
    ...parseSafeFeedback(body?.choices?.[0]?.message?.content),
    provider,
    model,
  };
}
export function registerFeedbackRoutes(
  app,
  { generate = generateFeedback } = {},
) {
  app.post(
    "/api/player/ai-feedback",
    authMiddleware,
    sessionEndpoint(async (req, res) => {
      if (active >= 4) throw domainError(429, "反馈服务忙，请稍后重试");
      active++;
      try {
        const { sessionId, cardId, purpose = "creative" } = req.body || {};
        if (!["creative", "communication"].includes(purpose))
          throw domainError(400, "反馈类型无效");
        const started = Date.now();
        const result = await withTransaction(async (tx) => {
          let session = await accessibleSession(req.actor, sessionId, {
            get: tx.get,
            write: true,
          });
          if (!session?.player_state_json) throw domainError(404, "场次不存在");
          const actor = await accountActor(req.actor, tx.get);
          if (!actor) throw domainError(403, "账号已失效");
          const state = JSON.parse(session.player_state_json);
          const card = await releasedCard(session, cardId);
          if (!card) throw domainError(404, "卡牌不存在");
          const text =
            purpose === "creative"
              ? state.d[cardId]
              : "分析当前卡牌的选择与沟通建议";
          if (purpose === "creative" && !text)
            throw domainError(400, "请先保存创新方案");
          if (purpose === "communication" && (!state.used.includes("沟通力") || state.skillCards?.["沟通力"] !== Number(cardId)))
            throw domainError(400, "请先使用沟通力技能");
          const hash = crypto
            .createHash("sha256")
            .update(JSON.stringify([purpose, text, card]))
            .digest("hex");
          const previous = await tx.get(
            "SELECT * FROM player_ai_feedback WHERE session_id=? AND card_code=? AND input_hash=?",
            [session.id, card.card_code, hash],
          );
          if (previous) return { feedback: previous.feedback, cached: true };
          if (!actor.paid_valid)
            throw domainError(403, "新增AI反馈需要有效付费权益");
          if (state.ended || state.paused)
            throw domainError(409, "已结束或暂停，不能新增技能反馈");
          const lock = await tx.get(
            "SELECT pg_try_advisory_xact_lock(hashtextextended(?,0)) AS locked",
            [`player-ai:${session.id}:${card.card_code}:${hash}`],
          );
          if (!lock.locked) throw domainError(429, "正在生成反馈，请稍后查看");
          const cached = await tx.get(
            "SELECT * FROM player_ai_feedback WHERE session_id=? AND card_code=? AND input_hash=?",
            [session.id, card.card_code, hash],
          );
          if (cached) return { feedback: cached.feedback, cached: true };
          const data = allowedInput(text)
            ? await generate(feedbackPrompt(card, text, purpose))
            : {
                feedback: safeGuidance,
                safe: false,
                provider: "safety",
                model: "local-policy-v1",
              };
          session = await accessibleSession(req.actor, sessionId, {
            get: tx.get,
            write: true,
            lock: true,
          });
          const fresh =
            session?.player_state_json && JSON.parse(session.player_state_json);
          const freshActor = await accountActor(req.actor, tx.get, {
            lock: true,
          });
          if (
            !freshActor?.paid_valid ||
            !fresh ||
            fresh.ended ||
            fresh.paused ||
            (purpose === "creative" && fresh.d[cardId] !== text)
          )
            throw domainError(409, "场次或账号状态已变化，请刷新");
          await tx.run(
            "INSERT INTO player_ai_feedback(session_id,card_code,input_hash,feedback,provider,model,created_at) VALUES(?,?,?,?,?,?,?) RETURNING session_id",
            [
              session.id,
              card.card_code,
              hash,
              data.feedback,
              data.provider,
              data.model,
              Date.now(),
            ],
          );
          if (purpose === "creative") {
            const rows = await tx.all(
              "SELECT id,payload FROM game_events WHERE session_id=? AND type='card_choice'",
              [session.id],
            );
            for (const row of rows) {
              const payload = JSON.parse(row.payload);
              if (payload.cardId === Number(cardId) && payload.choice === "D") {
                payload.consequence = data.feedback;
                await tx.run("UPDATE game_events SET payload=? WHERE id=?", [
                  JSON.stringify(payload),
                  row.id,
                ]);
              }
            }
          }
          return { ...data, cached: false };
        });
        res.json({ ...result, elapsedMs: Date.now() - started });
      } finally {
        active--;
      }
    }),
  );
}
