import { narrationError } from '../../services/card-narration.js';

// Authorization is checked on every request, including cache hits. Never accept text or URLs.
export function narrationHandler({ accessibleSession, releasedCard, narrate }) {
  return async (req, res) => {
    try {
      const session = await accessibleSession(req.actor, req.params.sessionId);
      if (!session?.player_state_json) throw narrationError(404, '场次不可访问');
      const ids = JSON.parse(session.game_settings_json || '{}').cardSnapshot?.releasedIds;
      if (!Array.isArray(ids) || !ids.length) throw narrationError(409, '场次缺少发布快照，请创建新局');
      const card = await releasedCard(session, req.params.cardId);
      if (!card) throw narrationError(404, '卡牌不在本场次发布快照中');
      const audio = await narrate(card);
      res.set('Cache-Control', 'no-store').type('audio/mpeg').send(audio);
    } catch (error) {
      const status = error.status || 500;
      res.status(status).json({ error: status >= 500 && !error.status ? '朗读暂不可用，请稍后重试' : error.message });
    }
  };
}
