let recorder = null;
let stream = null;
let chunks = [];
let audioContext = null;
let analyser = null;
let waveformBuffer = null;

function preferredMimeType() {
  if (typeof MediaRecorder === 'undefined') return '';
  return ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'].find((type) => MediaRecorder.isTypeSupported(type)) || '';
}

export const recordingService = {
  async start() {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      throw new Error('当前浏览器不支持现场录音');
    }
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (AudioContext) {
      audioContext = new AudioContext();
      await audioContext.resume();
      analyser = audioContext.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = .72;
      waveformBuffer = new Uint8Array(analyser.fftSize);
      audioContext.createMediaStreamSource(stream).connect(analyser);
    }
    chunks = [];
    const mimeType = preferredMimeType();
    recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    recorder.addEventListener('dataavailable', (event) => { if (event.data.size) chunks.push(event.data); });
    recorder.start(1000);
    return { mimeType: recorder.mimeType || mimeType || 'audio/webm' };
  },

  async stop() {
    if (!recorder || recorder.state === 'inactive') throw new Error('当前没有正在进行的录音');
    const current = recorder;
    return new Promise((resolve, reject) => {
      current.addEventListener('stop', () => {
        const blob = new Blob(chunks, { type: current.mimeType || 'audio/webm' });
        stream?.getTracks().forEach((track) => track.stop());
        audioContext?.close().catch(() => {});
        recorder = null;
        stream = null;
        audioContext = null;
        analyser = null;
        waveformBuffer = null;
        chunks = [];
        if (blob.size < 128) reject(new Error('录音时间太短，请重新录制'));
        else resolve(blob);
      }, { once: true });
      current.addEventListener('error', () => reject(new Error('录音失败，请检查麦克风权限')), { once: true });
      current.stop();
    });
  },

  cancel() {
    if (recorder && recorder.state !== 'inactive') recorder.stop();
    stream?.getTracks().forEach((track) => track.stop());
    audioContext?.close().catch(() => {});
    recorder = null;
    stream = null;
    audioContext = null;
    analyser = null;
    waveformBuffer = null;
    chunks = [];
  },

  sampleWaveform(sampleCount = 96) {
    if (!analyser || !waveformBuffer) return null;
    analyser.getByteTimeDomainData(waveformBuffer);
    const count = Math.max(16, Math.min(sampleCount, waveformBuffer.length));
    const result = new Array(count);
    for (let index = 0; index < count; index += 1) {
      const sourceIndex = Math.floor(index * (waveformBuffer.length - 1) / Math.max(1, count - 1));
      result[index] = (waveformBuffer[sourceIndex] - 128) / 128;
    }
    return result;
  },
};
