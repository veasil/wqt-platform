(function () {
  async function request(path, token, body) {
    const base = localStorage.getItem('wqt_api_base') || (location.pathname.startsWith('/staging/') ? '/staging/api' : '/api');
    path = base + path.slice(4);
    const response = await fetch(path, { method: body ? 'POST' : 'GET', headers: {
      Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'
    }, body: body ? JSON.stringify(body) : undefined });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `请求失败(${response.status})`);
    return data;
  }

  function choose(accounts) {
    if (!accounts.length) return Promise.reject(new Error('当前身份没有可用账号，请联系管理员'));
    return new Promise((resolve, reject) => {
      const dialog = document.createElement('dialog');
      dialog.className = 'account-choice';
      dialog.style.cssText = 'width:min(420px,calc(100vw - 48px));box-sizing:border-box;padding:28px;border:1px solid #9dbad8;border-radius:16px;background:linear-gradient(135deg,#f6fbff,#eaf4fc);color:#163151;box-shadow:0 20px 80px #16315155';
      const title = document.createElement('h2'); title.textContent = '选择使用账号';
      const form = document.createElement('form');
      const label = document.createElement('label'); label.textContent = '组织与账号';
      const select = document.createElement('select'); select.required = true;
      select.setAttribute('aria-label', '组织与账号');
      select.style.cssText = 'width:100%;padding:12px;margin:10px 0 20px;font-size:16px;border:1px solid #9dbad8;border-radius:8px;background:#f6fbff;color:#163151';
      const placeholder = document.createElement('option'); placeholder.value = ''; placeholder.textContent = '请选择账号';
      select.append(placeholder);
      for (const account of accounts) {
        const option = document.createElement('option'); option.value = String(account.id);
        option.textContent = `${account.organization_name} · ${account.name}`;
        select.append(option);
      }
      const confirm = document.createElement('button'); confirm.type = 'submit'; confirm.textContent = '确认账号'; confirm.className = 'auth-btn btn-premium gradient-primary';
      const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = '取消'; cancel.className = 'auth-btn secondary'; cancel.style.marginLeft = '12px';
      function close() { dialog.close(); dialog.remove(); }
      form.onsubmit = event => { event.preventDefault(); const id = Number(select.value); close(); resolve(id); };
      cancel.onclick = () => { close(); reject(new Error('已取消账号选择')); };
      dialog.oncancel = () => { dialog.remove(); reject(new Error('已取消账号选择')); };
      label.append(select); form.append(label, confirm, cancel); dialog.append(title, form); document.body.append(dialog);
      dialog.showModal(); select.focus();
    });
  }

  async function select(token, accounts = null) {
    const available = accounts || (await request('/api/auth/accounts', token)).accounts;
    return request('/api/auth/select-account', token, { accountId: await choose(available) });
  }
  window.WqtAccounts = { select };
})();
