import { DEFAULT_ACTIVITY, PHASES } from '../data/gameData';
import { api, DEMO_MODE } from './api';

export const gameService = {
  startHumanCheck: () => api.startHumanCheck(),
  verifyHumanCheck: (challengeId) => api.verifyHumanCheck(challengeId),
  sendSmsCode: (phone, humanProof) => api.sendTestSms(phone, humanProof),
  async login(credentials) {
    if (DEMO_MODE) {
      const result = await api.testLogin(credentials);
      localStorage.setItem('wqt_token', result.token);
      return {
        token: result.token,
        user: {
          name: result.user.name,
          phone: result.user.phone,
          role: result.user.role === 'boss' ? '内部测试员' : '守望师',
          organization: result.user.organization_name,
          watcherLevel: result.user.watcher_level,
          validUntil: result.user.valid_until,
        },
      };
    }
    const result = await api.login(credentials);
    const token = result.token || result.accessToken;
    if (token) localStorage.setItem('wqt_token', token);
    const profile = result.user || await api.me();
    return {
      token,
      user: {
        name: profile.guardian_name || profile.username || '守望师',
        role: profile.role === 'watcher' ? '守望师' : profile.role,
        organization: profile.organization_name || '独立守望师',
      },
    };
  },

  async resolveActivity(code) {
    const result = await api.resolveActivity(code.trim().toUpperCase() || DEFAULT_ACTIVITY.code);
    return result.activity;
  },

  async listActivities() {
    const result = await api.availableActivities();
    return result.activities || [];
  },

  async startGame(config) {
    const result = await api.startGame({
      activityCode: config.code,
      mode: config.mode,
      cardGroupIds: config.cardGroupIds || (config.cardGroupId ? [config.cardGroupId] : []),
      settings: {
        deckVersion: config.deckVersion,
        duration: config.duration,
        cardsPerPhase: Object.fromEntries(PHASES.map((phase, index) => [phase, config.phaseTargets[index]])),
      },
    });
    return {
      sessionId: result.sessionId || result.session_id || result.id,
      cardGroups: result.cardGroups || result.card_groups || (result.cardGroup ? [result.cardGroup] : [{ id: config.cardGroupId, name: config.deckVersion, count: 0 }]),
      maxScores: result.maxScores || result.max_scores || result.cardGroup?.maxScores || {},
      totalCardCount: result.totalCardCount || result.total_card_count || 0,
    };
  },

  async suggestCards(sessionId, query) {
    const result = await api.suggestCards(sessionId, query);
    return result.suggestions || [];
  },

  async listCardOptions(sessionId, phase, safetyType = '') {
    return api.cardOptions(sessionId, phase, safetyType);
  },

  async resolveCard(sessionId, cardReference) {
    const result = await api.resolveCard({ sessionId, cardCode: cardReference.code || cardReference.shortCode, cardRef: cardReference.cardRef });
    return result.card;
  },

  async prepareCardAudio(sessionId, grantId) {
    return api.prepareCardAudio({ sessionId, grantId });
  },

  async prepareFeedbackAudio(sessionId, feedbackGrantId) {
    return api.prepareFeedbackAudio({ sessionId, feedbackGrantId });
  },

  async answerCard(sessionId, grantId, choice, customText = '') {
    return api.answerCard({ sessionId, grantId, choice, customText });
  },

  async recordEvent(sessionId, type, payload) {
    if (!sessionId) return;
    await api.recordEvent({ sessionId, type, payload });
  },

  async finishGame(sessionId, payload) {
    return api.finishGame({ sessionId, endedAt: Date.now(), ...payload });
  },

  async generateReview(sessionId, onProgress) {
    onProgress('正在整理本局决策与伍力数据…', 15);
    onProgress('小伍正在生成成长复盘…', 45);
    const result = await api.generateReview(sessionId);
    onProgress('复盘报告已生成', 100);
    return {
      ...result,
      reportUrl: result.downloadUrl,
      stored: true,
    };
  },

  async uploadRecording(sessionId, blob) {
    return api.uploadRecording(sessionId, blob);
  },

  async downloadFile(url, fileName) {
    const blob = await api.downloadFile(url);
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = fileName || '伍力全开文件';
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  },

  async profile() {
    const result = await api.me();
    return result.user;
  },
  async updateProfile(profile) { return (await api.updateProfile(profile)).user; },
  changePassword: (payload) => api.changePassword(payload),
  async devices() { return (await api.devices()).devices || []; },
  async files() { return (await api.files()).files || []; },
  submitFeedback: (payload) => api.submitFeedback(payload),
  submitSupportTicket: (payload) => api.submitSupportTicket(payload),
  async supportTickets() { return (await api.supportTickets()).tickets || []; },
  async supportTicket(id) { return (await api.supportTicket(id)).ticket; },
  replySupportTicket: (id, content) => api.replySupportTicket(id, content),
};
