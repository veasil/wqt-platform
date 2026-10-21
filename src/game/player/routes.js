import { dbGet, dbAll } from "../../db.js";
import { cardsDbGet, cardsDbAll } from "../../cards-db.js";
import { authMiddleware } from "../../middleware/auth.js";
import { sessionEndpoint } from "../sessions/routes.js";
import { startSession } from "../sessions/service.js";
import { gameTransaction } from "../sessions/operation.js";
import {
  accessibleSession,
  sessionScope,
} from "../../platform/access/session-scope.js";
import { domainError } from "../activities/link.js";
import {playerScore} from './settlement.js';
import { initialState, applyAction } from "./state.js";
import { registerFeedbackRoutes } from "./feedback.js";
import { defaultQuestions, validatePlayerSetting } from "./config.js";
import {validateAgeRange} from '../../../shared/browser/game-configuration.js';
export async function questionnaire() {
  const row = await dbGet(
    "SELECT value FROM system_settings WHERE key='PLAYER_QUESTIONNAIRE'",
  );
  return row
    ? validatePlayerSetting("PLAYER_QUESTIONNAIRE", row.value)
    : defaultQuestions;
}
export async function releasedCard(session, id) {
  let ids = JSON.parse(session.game_settings_json || "{}").cardSnapshot?.releasedIds || null;
  if (!ids && session.card_group_id) {
    const group = await cardsDbGet(
      "SELECT released_ids_json FROM card_groups WHERE id=?",
      [session.card_group_id],
    );
    if (!group) return null;
    ids = JSON.parse(group.released_ids_json || "[]");
    if (!ids.length) return null;
  }
  const card = await cardsDbGet(
    `SELECT * FROM cards_released WHERE card_id=?${ids ? " AND id IN (" + ids.map(() => "?").join(",") + ")" : ""} ORDER BY released_at DESC,id DESC LIMIT 1`,
    [id, ...(ids || [])],
  );
  if (!card) return null;
  return playerCard(card);
}
function playerCard(card){
  return {
    id: card.card_id,
    card_code: card.card_code || String(card.key),
    phase: card.phase,
    event: card.event,
    title: card.title,
    safetyType: card.safety_type,
    audio_url:card.audio_url,
    guide_text:card.guide_text,
    options: JSON.parse(card.options_json),
  };
}
export function registerPlayerRoutes(app) {
  app.get(
    "/api/public/brand-resource",
    sessionEndpoint(async (_req, res) => {
      const row = await dbGet(
        "SELECT value FROM system_settings WHERE key='PLAYER_BRAND_RESOURCE'",
      );
      const data = row
        ? JSON.parse(row.value)
        : {
            revision: "default",
            image: "/player/brand-references/product-logo.png",
            title: "一起探索 · 一起守护",
            alt: "伍力全开",
          };
      if (
        typeof data.image !== "string" ||
        !data.image.startsWith("/") ||
        data.image.startsWith("//") ||
        typeof data.title !== "string" ||
        typeof data.alt !== "string"
      )
        throw domainError(503, "品牌资源配置无效");
      res.set("Cache-Control", "no-store").json(data);
    }),
  );
  app.post(
    "/api/player/start",
    authMiddleware,
    sessionEndpoint(async (req, res) => {
      const state = initialState(req.body?.settings);
      const survey = await questionnaire();
      const body=req.body || {};
      if(typeof body.location!=='string'||body.location.length>200||!body.location.trim())throw domainError(400,'请输入活动地点');
      if(body.players && (!Array.isArray(body.players)||body.players.length>30||!body.players.every(p=>typeof p==='string'&&p.length<=40)))throw domainError(400,'参与者信息无效');
      const group=await cardsDbGet('SELECT id,name,released_ids_json FROM card_groups WHERE id=?',[Number(body.cardGroupId)]);
      if(!group)throw domainError(400,'请选择有效卡牌组');
      const input = {requestId:body.requestId,activityCode:body.activityCode,location:body.location.trim(),players:body.players||[],cardGroupId:group.id,mode:String(body.mode||'standard').slice(0,50),settings:{duration:state.duration,counts:state.counts,ageRange:validateAgeRange(body.settings?.ageRange),player:true,cardSnapshot:{groupId:group.id,name:group.name,releasedIds:JSON.parse(group.released_ids_json||"[]")},questionnaire:survey}};
      const result = await startSession(req.actor, input,{playerEntry:true});
      res.json({ ...result, initialState: state });
    }),
  );
  app.get(
    "/api/player/session/:id",
    authMiddleware,
    sessionEndpoint(async (req, res) => {
      const session = await accessibleSession(req.actor, req.params.id);
      if (!session) throw domainError(404, "场次不存在");
      if (!session.player_state_json)
        throw domainError(409, "该场次使用旧版，请从历史入口查看");
      res.json({
        session,
        state: JSON.parse(session.player_state_json),
        scoreOverview:await playerScore(session,JSON.parse(session.player_state_json).values),
        events: await dbAll(
          "SELECT * FROM game_events WHERE session_id=? ORDER BY id",
          [session.id],
        ),
      });
    }),
  );
  app.get('/api/player/cards/:id',authMiddleware,sessionEndpoint(async(req,res)=>{
    const session=await accessibleSession(req.actor,req.params.id);if(!session?.player_state_json)throw domainError(404,'新版场次不存在');
    const settings=JSON.parse(session.game_settings_json),ids=settings.cardSnapshot?.releasedIds;
    if(!ids)throw domainError(409,'该验收场次缺少卡牌快照，请创建新局');
    if(!ids.length){res.json({cards:[]});return}
    const rows=await cardsDbAll('SELECT * FROM cards_released WHERE id IN ('+ids.map(()=>'?').join(',')+')',ids),byId=new Map(rows.map(row=>[row.id,row]));
    res.json({cards:ids.map(id=>byId.get(id)).filter(Boolean).map(playerCard)});
  }));
  app.post(
    "/api/player/action",
    authMiddleware,
    sessionEndpoint(async (req, res) => {
      const input = req.body || {};
      res.json(
        await gameTransaction(req.actor, input, "player-action", async (tx) => {
          const session = await accessibleSession(req.actor, input.sessionId, {
            write: true,
            get: tx.get,
            lock: true,
          });
          if (!session || !session.player_state_json)
            throw domainError(404, "新版场次不存在");
          const state = JSON.parse(session.player_state_json);
          const card = input.cardId
            ? await releasedCard(session, input.cardId)
            : null;
          const result = applyAction(state, input, card);
          await tx.run(
            "UPDATE game_sessions SET player_state_json=? WHERE id=?",
            [JSON.stringify(result.state), session.id],
          );
          if (result.state.ended) {
            const {finalScore:score,scoreDetails:details}=await playerScore(session,result.state.values);
            await tx.run(
              "UPDATE game_sessions SET ended_at=?,final_score=?,score_details_json=?,payload_json=? WHERE id=?",
              [
                result.state.endedAt,
                score,
                JSON.stringify(details),
                JSON.stringify({ attributes: result.payload.attributes }),
                session.id,
              ],
            );
            result.finalScore = score;
            result.scoreDetails = details;
            result.payload.finalScore = score;
            result.payload.scoreDetails = details;
          }
          await tx.run(
            "INSERT INTO game_events(session_id,ts,type,payload) VALUES(?,?,?,?)",
            [
              session.id,
              Date.now(),
              result.type,
              JSON.stringify(result.payload),
            ],
          );
          return result;
        }),
      );
    }),
  );
  app.get(
    "/api/player/feedback",
    authMiddleware,
    sessionEndpoint(async (req, res) => {
      const scope = sessionScope(req.account);
      const rows = await dbAll(
        `SELECT s.id,s.location,s.ended_at,s.game_settings_json FROM game_sessions s LEFT JOIN player_feedback f ON f.session_id=s.id WHERE ${scope.sql} AND s.ended_at IS NOT NULL AND s.player_state_json IS NOT NULL AND f.session_id IS NULL ORDER BY s.ended_at DESC`,
        scope.params,
      );
      res.json({
        pending: rows.map((row) => ({
          ...row,
          questionnaire: JSON.parse(row.game_settings_json).questionnaire,
        })),
      });
    }),
  );
  app.post(
    "/api/player/feedback",
    authMiddleware,
    sessionEndpoint(async (req, res) => {
      res.json(
        await gameTransaction(
          req.actor,
          req.body || {},
          "player-survey",
          async (tx) => {
            const session = await accessibleSession(
              req.actor,
              req.body.sessionId,
              { write: true, get: tx.get, lock: true },
            );
            if (!session?.ended_at || !session.player_state_json)
              throw domainError(404, "已结束场次不存在");
            const survey = JSON.parse(session.game_settings_json).questionnaire,
              answers = req.body.answers || {};
            if (
              !survey ||
              !survey.questions.every(
                (q) =>
                  typeof answers[q.id] === "string" &&
                  answers[q.id].trim() &&
                  answers[q.id].length <= 1000 &&
                  (q.type !== "select" || q.options.includes(answers[q.id])),
              ) ||
              Object.keys(answers).some(
                (k) => !survey.questions.some((q) => q.id === k),
              )
            )
              throw domainError(400, "请完整填写问卷");
            const previous = await tx.get(
              "SELECT answers_json FROM player_feedback WHERE session_id=?",
              [session.id],
            );
            if (previous) {
              if (previous.answers_json !== JSON.stringify(answers))
                throw domainError(409, "本场反馈已提交");
              return { ok: true };
            }
            await tx.run(
              "INSERT INTO player_feedback(session_id,account_id,identity_id,questionnaire_json,answers_json,created_at) VALUES(?,?,?,?,?,?) RETURNING session_id",
              [
                session.id,
                req.actor.accountId,
                req.actor.identityId,
                JSON.stringify(survey),
                JSON.stringify(answers),
                Date.now(),
              ],
            );
            await tx.run('INSERT INTO user_feedback(identity_id,account_id,type,content,session_id) VALUES(?,?,?,?,?)',[
              req.actor.identityId,req.actor.accountId,'reflection',
              survey.questions.map(q=>q.label+'：'+answers[q.id]).join('\n'),session.id
            ]);
            return { ok: true };
          },
        ),
      );
    }),
  );
  registerFeedbackRoutes(app);
}
