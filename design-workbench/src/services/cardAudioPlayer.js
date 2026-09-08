let player;
let unlocked = false;
let silentUrl;

function audioElement() {
  if (!player) player = new Audio();
  return player;
}

function createSilentWave() {
  if (silentUrl) return silentUrl;
  const sampleRate = 8000;
  const samples = 160;
  const buffer = new ArrayBuffer(44 + samples * 2);
  const view = new DataView(buffer);
  const write = (offset, value) => [...value].forEach((character, index) => view.setUint8(offset + index, character.charCodeAt(0)));
  write(0, 'RIFF'); view.setUint32(4, 36 + samples * 2, true); write(8, 'WAVE'); write(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  write(36, 'data'); view.setUint32(40, samples * 2, true);
  silentUrl = URL.createObjectURL(new Blob([buffer], { type: 'audio/wav' }));
  return silentUrl;
}

export function unlockCardAudio() {
  if (unlocked) return;
  const audio = audioElement();
  const source = createSilentWave();
  audio.muted = true;
  audio.src = source;
  const attempt = audio.play();
  if (!attempt) return;
  void attempt.then(() => {
    if (audio.src === source) { audio.pause(); audio.currentTime = 0; }
    audio.muted = false;
    unlocked = true;
  }).catch(() => { audio.muted = false; });
}

export function getCardAudioElement() {
  return audioElement();
}

export function speakLocally(text, handlers = {}) {
  if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') return null;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(String(text || ''));
  const chineseVoices = window.speechSynthesis.getVoices().filter((voice) => /^zh/i.test(voice.lang));
  utterance.voice = chineseVoices.find((voice) => /child|xiaoyi|yunxi|xiaoxiao|童|晓/i.test(voice.name)) || chineseVoices[0] || null;
  utterance.lang = 'zh-CN';
  utterance.rate = 1.02;
  utterance.pitch = 1.06;
  utterance.volume = 1;
  utterance.onstart = handlers.onStart || null;
  utterance.onend = handlers.onEnd || null;
  utterance.onerror = handlers.onError || null;
  window.speechSynthesis.speak(utterance);
  return utterance;
}

export function stopLocalSpeech() {
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
}
