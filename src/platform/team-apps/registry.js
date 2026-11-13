import { domainError } from '../../game/activities/link.js';

const clientPattern = /^[a-zA-Z0-9_-]{1,80}$/;
export function readTeamApps(env = process.env) {
  if (!env.WQT_TEAM_APPS) return [];
  let entries;
  try { entries = JSON.parse(env.WQT_TEAM_APPS); } catch { throw domainError(503, '团队应用配置无效'); }
  if (!Array.isArray(entries) || entries.length > 100) throw domainError(503, '团队应用配置无效');
  const ids = new Set();
  return entries.map(entry => {
    if (!entry || !clientPattern.test(entry.clientId) || ids.has(entry.clientId) ||
        typeof entry.name !== 'string' || !entry.name.trim() || entry.name.length > 100 ||
        !Array.isArray(entry.redirectUris) || !entry.redirectUris.length || entry.redirectUris.length > 10 ||
        !Array.isArray(entry.identityIds) || !entry.identityIds.length ||
        !entry.identityIds.every(id => Number.isSafeInteger(id) && id > 0)) throw domainError(503, '团队应用配置无效');
    ids.add(entry.clientId);
    for (const uri of entry.redirectUris) {
      let url;
      try { url = new URL(uri); } catch { throw domainError(503, '团队应用回跳地址无效'); }
      const local = ['development', 'test'].includes(env.NODE_ENV) &&
        ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) && url.protocol === 'http:';
      if (typeof uri !== 'string' || url.href !== uri || url.username || url.password || url.hash || url.search ||
          (!local && url.protocol !== 'https:')) throw domainError(503, '团队应用回跳地址无效');
    }
    return { clientId: entry.clientId, name: entry.name, redirectUris: [...entry.redirectUris], identityIds: [...entry.identityIds] };
  });
}

export function registeredApp(clientId, env = process.env) {
  if (typeof clientId !== 'string' || !clientPattern.test(clientId)) throw domainError(400, '应用标识无效');
  const app = readTeamApps(env).find(entry => entry.clientId === clientId);
  if (!app) throw domainError(403, '团队应用未启用');
  return app;
}
export function registeredRedirect(app, uri) {
  if (typeof uri !== 'string' || !app.redirectUris.includes(uri)) throw domainError(400, '回跳地址未登记');
  return new URL(uri);
}
export function requireMember(app, identityId) {
  if (!app.identityIds.includes(identityId)) throw domainError(403, '当前身份未获此团队应用授权');
}
export function allowedTeamRequest(method, path) {
  return method === 'POST' && ['/api/player/start', '/api/player/action'].includes(path) ||
    method === 'GET' && (path === '/api/connect/session' || /^\/api\/player\/(session|cards)\/[1-9][0-9]*$/.test(path));
}
