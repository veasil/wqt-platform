// Small browser client for the WQT team-app protocol. No platform identity token is used here.
export class WqtClientError extends Error {
  constructor(message, { status = 0, code = 'CLIENT_ERROR', outcomeUnknown = false } = {}) {
    super(message); this.name = 'WqtClientError'; this.status = status;
    this.code = code; this.outcomeUnknown = outcomeUnknown;
  }
}

export function createWqtClient({ platformOrigin, clientId, redirectUri }) {
  const platform = new URL(platformOrigin), redirect = new URL(redirectUri);
  const local = url => ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  const allowed = url => url.protocol === 'https:' || (url.protocol === 'http:' && local(url));
  if (!allowed(platform) || platform.origin !== platformOrigin || platform.username || platform.password ||
      !allowed(redirect) || redirect.username || redirect.password || redirect.hash ||
      redirect.searchParams.has('code') || redirect.searchParams.has('state') ||
      !/^[a-zA-Z0-9_-]{1,80}$/.test(clientId)) throw new WqtClientError('接入配置无效');
  const namespace = `wqt-team:${platform.origin}:${clientId}:${redirect.href}:`;
  let writing = false;
  function read(key) {
    try { const value = sessionStorage.getItem(namespace + key); return value ? JSON.parse(value) : null; }
    catch { throw new WqtClientError('浏览器暂存不可用，请允许本网站使用会话存储', { code: 'STORAGE_UNAVAILABLE' }); }
  }
  function save(key, value) {
    try {
      if (value === null) sessionStorage.removeItem(namespace + key);
      else sessionStorage.setItem(namespace + key, JSON.stringify(value));
    } catch { throw new WqtClientError('浏览器暂存不可用，本次操作未继续', { code: 'STORAGE_UNAVAILABLE' }); }
  }
  function token() {
    const auth = read('auth');
    if (!auth || auth.expiresAt <= Date.now()) throw new WqtClientError('请连接伍仟天后继续', { status: 401, code: 'LOGIN_REQUIRED' });
    return auth.accessToken;
  }
  const base64url = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const random = () => base64url(crypto.getRandomValues(new Uint8Array(32)));
  async function send(path, { body, authenticated = true, write = false } = {}) {
    const auth = authenticated ? token() : null;
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 15000);
    let status = null;
    try {
      const response = await fetch(platform.origin + path, {
        method: body ? 'POST' : 'GET', credentials: 'omit', cache: 'no-store', signal: controller.signal,
        headers: { ...(auth ? { Authorization: `Bearer ${auth}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      status = response.status;
      let data;
      try { data = await response.json(); } catch {
        if (response.ok) throw new WqtClientError('服务响应不完整，请恢复状态后重试', { status, code: 'INVALID_RESPONSE', outcomeUnknown: write });
        data = {};
      }
      if (!response.ok) throw new WqtClientError(data?.error || `请求失败（${status}）`, {
        status, code: data?.code || 'HTTP_ERROR', outcomeUnknown: write && (status >= 500 || status === 408),
      });
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new WqtClientError('服务响应格式无效', { status, code: 'INVALID_RESPONSE', outcomeUnknown: write });
      return data;
    } catch (error) {
      if (error instanceof WqtClientError) throw error;
      throw new WqtClientError('连接暂未完成，请检查网络', { code: 'NETWORK_ERROR', outcomeUnknown: write && (status === null || status >= 500) });
    } finally { clearTimeout(timeout); }
  }
  async function login() {
    if (location.origin !== redirect.origin) throw new WqtClientError('请从登记的课件网站登录');
    const verifier = random(), state = random();
    const challenge = base64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
    save('login', { verifier, state, createdAt: Date.now(), platform: platform.origin, redirect: redirect.href });
    const url = new URL('/connect/authorize.html', platform.origin);
    url.search = new URLSearchParams({ client_id: clientId, redirect_uri: redirect.href, state, code_challenge: challenge, code_challenge_method: 'S256' });
    location.assign(url.href);
  }
  async function handleCallback() {
    const current = new URL(location.href);
    if (!current.searchParams.has('code') && !current.searchParams.has('state') && !current.searchParams.has('error')) return false;
    const codes = current.searchParams.getAll('code'), states = current.searchParams.getAll('state'), remoteError = current.searchParams.has('error');
    for (const name of ['code', 'state', 'error', 'error_description']) current.searchParams.delete(name);
    history.replaceState(null, '', current.href); // Remove authorization material even when validation fails.
    const pending = read('login'); save('login', null);
    if (remoteError || codes.length !== 1 || states.length !== 1 || !codes[0] || !pending ||
        states[0] !== pending.state || pending.platform !== platform.origin || pending.redirect !== redirect.href ||
        current.href !== redirect.href || Date.now() - pending.createdAt > 10 * 60 * 1000 || pending.createdAt > Date.now())
      throw new WqtClientError('登录回调无效或已过期，请重新连接', { code: 'INVALID_CALLBACK' });
    const result = await send('/api/connect/token', { authenticated: false, body: {
      grant_type: 'authorization_code', client_id: clientId, redirect_uri: redirect.href, code: codes[0], code_verifier: pending.verifier,
    } });
    if (typeof result.access_token !== 'string' || result.token_type !== 'Bearer' || !Number.isFinite(result.expires_in) || result.expires_in <= 0 || result.expires_in > 900)
      throw new WqtClientError('登录响应无效，请重新连接', { code: 'INVALID_TOKEN_RESPONSE' });
    save('auth', { accessToken: result.access_token, expiresAt: Date.now() + result.expires_in * 1000 });
    return true;
  }
  async function getConnection() {
    const connection = await send('/api/connect/session');
    if (!Number.isSafeInteger(connection.account?.id)) throw new WqtClientError('账号响应无效');
    save('connection', connection); return connection;
  }
  async function dispatchPending(pending) {
    if (writing) throw new WqtClientError('上一项操作仍在处理中', { code: 'WRITE_IN_PROGRESS' });
    writing = true;
    try {
      const connection = await getConnection();
      if (connection.account.id !== pending.accountId) throw new WqtClientError('请重新连接原账号后重试未完成的操作', { code: 'ACCOUNT_CHANGED' });
      const result = await send(pending.path, { body: pending.body, write: true });
      save('pending', null); return result;
    } catch (error) {
      // Authentication/preflight errors leave the saved request available after reconnection.
      if (error instanceof WqtClientError && error.status >= 400 && error.status < 500 &&
          ![401, 403, 408].includes(error.status) && !error.outcomeUnknown) save('pending', null);
      throw error;
    } finally { writing = false; }
  }
  async function write(path, input) {
    if (writing || read('pending')) throw new WqtClientError('请先重试上一项未确认的操作', { code: 'PENDING_OPERATION' });
    token();
    // Reserve synchronously before any await, including the account preflight.
    const connection = read('connection');
    if (!connection?.account?.id) throw new WqtClientError('请先读取连接账号', { code: 'CONNECTION_REQUIRED' });
    const body = JSON.parse(JSON.stringify({ ...input, requestId: crypto.randomUUID() }));
    const pending = { path, body, accountId: connection.account.id };
    save('pending', pending); return dispatchPending(pending);
  }
  const sessionPath = (kind, id) => {
    if (!Number.isSafeInteger(Number(id)) || Number(id) <= 0) throw new WqtClientError('场次编号无效');
    return `/api/player/${kind}/${Number(id)}`;
  };
  return {
    login, handleCallback, getConnection,
    startSession: input => write('/api/player/start', input),
    performAction: input => write('/api/player/action', input),
    getSession: id => send(sessionPath('session', id)),
    getCards: id => send(sessionPath('cards', id)),
    getPending: () => read('pending'),
    retryPending() { const pending = read('pending'); if (!pending) throw new WqtClientError('没有待重试的操作'); return dispatchPending(pending); },
    logout() { save('auth', null); save('login', null); save('connection', null); },
  };
}
