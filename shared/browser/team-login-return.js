// Same-tab continuation is only allowed back to the platform authorization page.
const key = 'WQT_TEAM_LOGIN_RETURN';
function destination() {
  try {
    const record = JSON.parse(sessionStorage.getItem(key) || 'null');
    if (!record) return null;
    const url = new URL(record.url, location.origin);
    if (url.origin !== location.origin || url.pathname !== '/connect/authorize.html' || url.username || url.password || url.hash ||
        !Number.isFinite(record.createdAt) || Date.now() - record.createdAt > 600000 || record.createdAt > Date.now()) {
      sessionStorage.removeItem(key); return null;
    }
    return url;
  } catch { return null; }
}
export function beginTeamLogin() {
  if (location.pathname !== '/connect/authorize.html') throw new Error('请从课件连接页登录');
  sessionStorage.setItem(key, JSON.stringify({url:location.href,createdAt:Date.now()}));
  location.assign('/player/?team_connect=1');
}
export function hasTeamLoginReturn() {
  return new URL(location.href).searchParams.get('team_connect') === '1' && !!destination();
}
export function returnToTeamAuthorization() {
  if (!hasTeamLoginReturn()) return false;
  const target=destination();sessionStorage.removeItem(key);
  location.replace(target.href);return true;
}
