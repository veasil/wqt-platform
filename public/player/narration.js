// One player per page. Disposing invalidates pending responses and revokes audio URLs.
export function createNarrationPlayer({ fetchImpl = fetch, createAudio = url => new Audio(url), urls = URL } = {}) {
  let version = 0, audio = null, controller = null, objectUrl = null, button = null;
  const label = text => { if (button) { button.textContent = text; button.setAttribute('aria-label', text); } };
  function stop() {
    version++;
    controller?.abort(); controller = null;
    if (audio) { audio.onended = null; audio.onerror = null; audio.pause(); audio.removeAttribute('src'); audio.load(); }
    audio = null;
    if (objectUrl) urls.revokeObjectURL(objectUrl);
    objectUrl = null;
    label('▷ 聆听题面'); button = null;
  }
  async function toggle({ sessionId, cardId, target, token, onError }) {
    if (controller) return;
    if (audio) {
      if (!audio.paused) { audio.pause(); label('▷ 继续朗读'); return; }
      const current = version, playing = audio;
      try { await playing.play(); if (current === version) label('Ⅱ 暂停朗读'); }
      catch { if (current === version) { label('▷ 点击播放'); onError(new Error('请再次点击播放，或检查设备音量')); } }
      return;
    }
    stop(); button = target; const current = version;
    const pendingController = new AbortController(); controller = pendingController;
    const signal = pendingController.signal;
    const timeout = setTimeout(() => pendingController.abort(), 35000);
    label('正在准备语音…');
    try {
      const res = await fetchImpl(`/api/player/narration/${encodeURIComponent(sessionId)}/${encodeURIComponent(cardId)}`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}` }, signal, cache: 'no-store',
      });
      if (!res.ok) { const data = await res.json().catch(() => ({})); throw new Error(data.error || '题面语音暂不可用，请重试'); }
      const blob = await res.blob();
      if (current !== version) return;
      if (!blob.size || blob.size > 8 * 1024 * 1024 || !blob.type.startsWith('audio/mpeg')) throw new Error('题面语音无效，请重试');
      objectUrl = urls.createObjectURL(blob); audio = createAudio(objectUrl);
      audio.onended = () => { audio.currentTime = 0; label('▷ 重新朗读'); };
      audio.onerror = () => { stop(); onError(new Error('题面语音播放失败，请重试')); };
      try { await audio.play(); if (current === version) label('Ⅱ 暂停朗读'); }
      catch { if (current === version) { label('▷ 点击播放'); onError(new Error('语音已准备好，请再次点击播放')); } }
    } catch (error) {
      if (current === version) { stop(); onError(new Error(error.name === 'AbortError' ? '语音准备超时，请重试' : error.message)); }
    } finally { clearTimeout(timeout); if (current === version) controller = null; }
  }
  return { toggle, stop };
}
