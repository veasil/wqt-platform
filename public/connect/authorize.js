const params = new URLSearchParams(location.search);
const fields = ['client_id', 'redirect_uri', 'state', 'code_challenge', 'code_challenge_method'];
const input = Object.fromEntries(fields.map(name => [name, params.get(name)]));
const message = document.querySelector('#message'), form = document.querySelector('#account-form');
const loginPanel = document.querySelector('#login-panel'), accountSelect = document.querySelector('#account');
let identityToken = null, valid = false;
try {
  const redirect = new URL(input.redirect_uri);
  valid = fields.every(name => params.getAll(name).length === 1) && input.code_challenge_method === 'S256' &&
    /^[A-Za-z0-9_-]{43}$/.test(input.code_challenge) && /^[A-Za-z0-9_-]{16,200}$/.test(input.state) &&
    ['https:', 'http:'].includes(redirect.protocol) && !redirect.username && !redirect.password && !redirect.hash;
  document.querySelector('#application').textContent = '课件：' + input.client_id + ' · ' + redirect.origin;
} catch { valid = false; }
async function request(path, body) {
  const response = await fetch(path, { method: body ? 'POST' : 'GET', cache: 'no-store', credentials: 'omit',
    headers: { Authorization: 'Bearer ' + identityToken, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || '暂时无法连接，请稍后再试');
  return data;
}
async function checkLogin() {
  form.hidden = true; loginPanel.hidden = true;
  if (!valid) { message.textContent = '课件连接地址不完整，请回到课件重新点击连接。'; return; }
  try {
    identityToken = localStorage.getItem('WQT_AUTH_TOKEN');
    if (!identityToken) throw new Error('请先登录伍仟天。');
    const data = await request('/api/auth/session');
    accountSelect.replaceChildren();
    for (const account of data.accounts || []) {
      const option = document.createElement('option'); option.value = String(account.id);
      option.textContent = (account.organization_name || '') + ' · ' + (account.name || '教学账号');
      accountSelect.append(option);
    }
    if (!accountSelect.options.length) throw new Error('当前身份没有可用教学账号，请联系团队负责人。');
    if (data.user?.accountId) accountSelect.value = String(data.user.accountId);
    if (!accountSelect.value) accountSelect.selectedIndex = 0;
    form.hidden = false; message.textContent = '登录成功。此连接只用于课件场次操作。';
  } catch (error) { message.textContent = error.message; loginPanel.hidden = false; }
}
document.querySelector('#check-login').addEventListener('click', checkLogin);
form.addEventListener('submit', async event => {
  event.preventDefault(); const button = document.querySelector('#connect'); button.disabled = true;
  try {
    if (localStorage.getItem('WQT_AUTH_TOKEN') !== identityToken) throw new Error('登录账号已变化，请重新检查登录。');
    const result = await request('/api/connect/authorize', { ...input, accountId: Number(accountSelect.value) });
    const target = new URL(result.redirectUrl), expected = new URL(input.redirect_uri);
    if (target.searchParams.getAll('code').length !== 1 || !target.searchParams.get('code') ||
        target.searchParams.getAll('state').length !== 1 || target.searchParams.get('state') !== input.state)
      throw new Error('连接响应无效，请从课件重新开始。');
    const clean = new URL(target); clean.searchParams.delete('code'); clean.searchParams.delete('state');
    if (clean.href !== expected.href) throw new Error('课件返回地址不匹配。');
    location.replace(target.href);
  } catch (error) { message.textContent = error.message; button.disabled = false; }
});
checkLogin();
