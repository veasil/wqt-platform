(() => {
  const status = document.getElementById('status'), files = document.getElementById('files'), retry = document.getElementById('retry');
  async function request(path) {
    const token = localStorage.getItem('WQT_AUTH_TOKEN');
    if (!token) throw new Error('请先登录，再打开下载中心。');
    const response = await fetch(path, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error || '请求失败，请重试');
    }
    return response;
  }
  async function load() {
    files.replaceChildren(); retry.hidden = true; status.textContent = '正在校验登录与权益…';
    try {
      const { releases } = await (await request('/api/downloads')).json();
      status.textContent = releases.length ? '当前可下载的最新资料' : '暂时没有发布资料。';
      for (const row of releases) {
        const card = document.createElement('article'), heading = document.createElement('h2'), info = document.createElement('p'), button = document.createElement('button');
        heading.textContent = row.title;
        info.textContent = `版本 ${row.version} · ${(row.size / 1024 / 1024).toFixed(1)} MB · ${new Date(row.created_at).toLocaleDateString('zh-CN')}`;
        button.textContent = '↓ 下载资料';
        button.onclick = async () => {
          button.disabled = true; status.textContent = '正在下载，请稍候…';
          try {
            const response = await request(`/api/downloads/${encodeURIComponent(row.id)}/file`);
            const blob = await response.blob(), url = URL.createObjectURL(blob), link = document.createElement('a');
            link.href = url; link.download = row.filename; document.body.append(link); link.click(); link.remove();
            setTimeout(() => URL.revokeObjectURL(url), 60000);
            status.textContent = '资料已接收，请查看浏览器下载列表。';
          } catch (error) { status.textContent = error.message; }
          finally { button.disabled = false; }
        };
        card.append(heading, info, button); files.append(card);
      }
    } catch (error) { status.textContent = error.message; retry.hidden = false; }
  }
  retry.onclick = load; load();
})();
