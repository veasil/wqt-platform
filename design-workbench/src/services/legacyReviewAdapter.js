import { api } from './api';

let legacyReviewPromise;

function loadScript(src, marker) {
  if (marker && window[marker]) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[data-wqt-legacy="${src}"]`);
    if (existing) {
      existing.addEventListener('load', resolve, { once: true });
      existing.addEventListener('error', () => reject(new Error(`原版资源加载失败：${src}`)), { once: true });
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.dataset.wqtLegacy = src;
    script.addEventListener('load', resolve, { once: true });
    script.addEventListener('error', () => reject(new Error(`原版资源加载失败：${src}`)), { once: true });
    document.head.appendChild(script);
  });
}

async function loadLegacyReview() {
  if (window.GameReview) return window.GameReview;
  if (!legacyReviewPromise) {
    legacyReviewPromise = (async () => {
      // 卡面图是增强项；缺失时原版引擎会自动退化成无卡面报告。
      await loadScript('/cards-pdf-map.js', 'getCardImage').catch(() => undefined);
      await loadScript('/game-review.js', 'GameReview');
      if (!window.GameReview?.buildReviewData || !window.GameReview?.generateReport) {
        throw new Error('原版复盘引擎未正确初始化');
      }
      return window.GameReview;
    })().catch((error) => {
      legacyReviewPromise = undefined;
      throw error;
    });
  }
  return legacyReviewPromise;
}

function mirrorLegacySession(sessionId) {
  const token = localStorage.getItem('wqt_token');
  if (token) localStorage.setItem('WQT_AUTH_TOKEN', token);
  if (sessionId) sessionStorage.setItem('WQT_SESSION_ID', String(sessionId));
}

function normalizeEvents(events) {
  return (events || []).map((event) => ({
    ...event,
    type: event.type === 'skill_used' ? 'skill_use' : event.type === 'game_end' ? 'game_finish' : event.type,
  }));
}

function settingValue(settings, key) {
  const row = (settings || []).find((item) => item.key === key);
  return row?.value;
}

async function resolveSessionData(sessionId) {
  if (sessionId) {
    try {
      return await api.gameSession(sessionId);
    } catch (_error) {
      // 与原版一致：标签页里的 sessionId 失效时，回退到当前账号最近一局。
    }
  }
  const last = await api.lastGameSession();
  if (!last.session?.id) throw new Error('暂无可复盘的游戏记录');
  return api.gameSession(last.session.id);
}

function reportScore(reviewData) {
  const details = reviewData.session?.scoreDetails;
  if (details && typeof details === 'object') {
    const rates = Object.values(details)
      .map((item) => item?.rate)
      .filter((value) => typeof value === 'number');
    if (rates.length) return Math.round((rates.reduce((sum, value) => sum + value, 0) / rates.length) * 100);
  }
  return Math.round(Number(reviewData.session?.finalScore) || 0);
}

function adaptReport(structured, reviewData) {
  const overview = structured.overview || {};
  const story = structured.story || {};
  const pact = structured.pact || {};
  return {
    headline: overview.summary || '本轮复盘已生成',
    score: reportScore(reviewData),
    cardsReviewed: reviewData.cards.length,
    summary: overview.experienced || overview.summary || '本轮闯关记录已经完成整理。',
    insight: structured.abilityComment || structured.riskComment || pact.takeaway || '',
    strengths: Array.isArray(story.tips) ? story.tips : [],
    actions: Array.isArray(pact.items) ? pact.items : [],
  };
}

function notifyAiTutor(reviewData, reportUrl) {
  if (!window.parent || window.parent === window) return;
  const params = new URLSearchParams(window.location.search);
  window.parent.postMessage({
    type: 'WQT_LEVEL1_COMPLETED',
    journeyId: params.get('journeyId') || undefined,
    sessionId: reviewData.session?.id,
    wqtSessionId: reviewData.session?.id,
    reviewSnapshot: reviewData,
    reportUrl,
  }, params.get('aitutor_origin') || '*');
}

export async function generateLegacyReview(sessionId, onProgress = () => {}) {
  mirrorLegacySession(sessionId);
  onProgress('正在加载原版复盘引擎…', 3);

  const [legacy, sessionData, settingsData] = await Promise.all([
    loadLegacyReview(),
    resolveSessionData(sessionId),
    api.settings().catch(() => ({ settings: [] })),
  ]);
  if (!sessionData.session) throw new Error('未找到对应的游戏记录');
  mirrorLegacySession(sessionData.session.id);

  onProgress('正在准备本局决策与伍力数据…', 7);
  const reviewData = legacy.buildReviewData(sessionData.session, normalizeEvents(sessionData.events));
  const minCards = Math.max(1, Number.parseInt(settingValue(settingsData.settings, 'REVIEW_MIN_CARDS'), 10) || 7);
  if (reviewData.cards.length < minCards) {
    throw new Error(`数据不足：至少需要完成 ${minCards} 张卡牌才能生成复盘报告，当前只有 ${reviewData.cards.length} 张。`);
  }

  const { structured, reportHtml } = await legacy.generateReport(reviewData, onProgress);
  onProgress('正在上传复盘海报…', 94);

  let reportUrl;
  let stored = true;
  try {
    const upload = await api.uploadReviewReport(reportHtml);
    if (!upload.ok || !upload.htmlUrl) throw new Error('报告上传失败');
    reportUrl = upload.htmlUrl;
  } catch (_error) {
    stored = false;
    reportUrl = URL.createObjectURL(new Blob([reportHtml], { type: 'text/html;charset=utf-8' }));
  }

  onProgress('复盘报告已生成', 100);
  notifyAiTutor(reviewData, reportUrl);
  return {
    provider: '原版复盘引擎',
    report: adaptReport(structured, reviewData),
    reportUrl,
    downloadUrl: reportUrl,
    stored,
  };
}
