const API_BASE = import.meta.env.VITE_API_BASE_URL || '';
export const DEMO_MODE = import.meta.env.VITE_DEMO_MODE !== 'false';

function clientInstanceId() {
  let value = sessionStorage.getItem('wqt_client_instance');
  if (!value) {
    value = crypto.randomUUID();
    sessionStorage.setItem('wqt_client_instance', value);
  }
  return value;
}

async function request(path, options = {}) {
  const token = localStorage.getItem('wqt_token');
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', 'X-WQT-Client': clientInstanceId(), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options.headers },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || payload.message || '请求失败');
  return payload;
}

async function binaryRequest(path, options = {}) {
  const token = localStorage.getItem('wqt_token');
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { 'X-WQT-Client': clientInstanceId(), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options.headers },
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || payload.message || '请求失败');
  }
  return response;
}

export const api = {
  startHumanCheck: () => request('/api/test-auth/human/start', { method: 'POST', body: '{}' }),
  verifyHumanCheck: (challengeId) => request('/api/test-auth/human/verify', { method: 'POST', body: JSON.stringify({ challengeId }) }),
  sendTestSms: (phone, humanProof) => request('/api/test-auth/sms/send', { method: 'POST', body: JSON.stringify({ phone, humanProof }) }),
  testLogin: (credentials) => request('/api/test-auth/login', { method: 'POST', body: JSON.stringify(credentials) }),
  login: (credentials) => request('/api/auth/login', { method: 'POST', body: JSON.stringify(credentials) }),
  me: () => request('/api/me'),
  updateProfile: (profile) => request('/api/me/profile', { method: 'PUT', body: JSON.stringify(profile) }),
  changePassword: (payload) => request('/api/me/password', { method: 'PUT', body: JSON.stringify(payload) }),
  devices: () => request('/api/me/devices'),
  files: () => request('/api/me/files'),
  submitFeedback: (payload) => request('/api/me/feedback', { method: 'POST', body: JSON.stringify(payload) }),
  submitSupportTicket: (payload) => request('/api/support/tickets', { method: 'POST', body: JSON.stringify(payload) }),
  supportTickets: () => request('/api/support/tickets'),
  supportTicket: (id) => request(`/api/support/tickets/${encodeURIComponent(id)}`),
  replySupportTicket: (id, content) => request(`/api/support/tickets/${encodeURIComponent(id)}/messages`, { method: 'POST', body: JSON.stringify({ content }) }),
  availableActivities: () => request('/api/activities/available'),
  resolveActivity: (code) => request(`/api/activities/resolve?code=${encodeURIComponent(code)}`),
  startGame: (config) => request('/api/game/start', { method: 'POST', body: JSON.stringify(config) }),
  suggestCards: (sessionId, query) => request(`/api/game/card/suggest?sessionId=${encodeURIComponent(sessionId)}&q=${encodeURIComponent(query)}`),
  cardOptions: (sessionId, phase, safetyType = '') => request(`/api/game/card/options?sessionId=${encodeURIComponent(sessionId)}&phase=${encodeURIComponent(phase)}&safetyType=${encodeURIComponent(safetyType)}`),
  resolveCard: (payload) => request('/api/game/card/resolve', { method: 'POST', body: JSON.stringify(payload) }),
  prepareCardAudio: (payload) => request('/api/game/card/tts', { method: 'POST', body: JSON.stringify(payload) }),
  prepareFeedbackAudio: (payload) => request('/api/game/feedback/tts', { method: 'POST', body: JSON.stringify(payload) }),
  answerCard: (payload) => request('/api/game/card/answer', { method: 'POST', body: JSON.stringify(payload) }),
  recordEvent: (event) => request('/api/game/event', { method: 'POST', body: JSON.stringify(event) }),
  finishGame: (payload) => request('/api/game/finish', { method: 'POST', body: JSON.stringify(payload) }),
  generateReview: (sessionId) => request('/api/game/review', { method: 'POST', body: JSON.stringify({ sessionId }) }),
  gameSession: (sessionId) => request(`/api/game/session/${encodeURIComponent(sessionId)}`),
  lastGameSession: () => request('/api/game/last-session'),
  settings: () => request('/api/settings'),
  uploadReviewReport: (html) => request('/api/upload/report', { method: 'POST', body: JSON.stringify({ html, markdown: null }) }),
  uploadRecording: async (sessionId, blob) => {
    const response = await binaryRequest(`/api/game/recording?sessionId=${encodeURIComponent(sessionId)}`, { method: 'POST', headers: { 'Content-Type': blob.type || 'audio/webm' }, body: blob });
    return response.json();
  },
  downloadFile: async (url) => (await binaryRequest(url)).blob(),
};
