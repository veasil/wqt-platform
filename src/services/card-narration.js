import { createHash, randomUUID } from 'node:crypto';

export const narrationError = (status, message) => Object.assign(new Error(message), { status });
const MAX_AUDIO = 8 * 1024 * 1024;
export function narrationConfig(env = process.env) {
  const speechRate = Number(env.VOLC_TTS_SPEECH_RATE ?? -5);
  if (!Number.isInteger(speechRate) || speechRate < -50 || speechRate > 100)
    throw narrationError(503, '朗读语速配置无效');
  return {
    apiKey: env.VOLC_TTS_API_KEY,
    appId: env.VOLC_TTS_APP_ID,
    accessKey: env.VOLC_TTS_ACCESS_KEY,
    speaker: env.VOLC_TTS_SPEAKER || 'zh_male_shaonianzixin_moon_bigtts',
    resource: env.VOLC_TTS_RESOURCE_ID || 'seed-tts-1.0',
    speechRate,
  };
}
export function narrationInput(card, config) {
  const text = [card.title, card.event].filter(v => typeof v === 'string' && v.trim()).map(v => v.trim()).join('。\n');
  if (!text || Buffer.byteLength(text, 'utf8') > 12000) throw narrationError(422, '题面为空或过长，暂不能朗读');
  const hash = createHash('sha256').update(JSON.stringify(['v1', text, config.speaker, config.resource, config.speechRate, 'mp3', 24000])).digest('hex');
  return { text, hash, key: `cards-narration/v1/${hash}.mp3` };
}

// HTTP Chunked V3: newline-delimited JSON, including an explicit successful end event.
export async function synthesizeNarration(text, config, { fetchImpl = fetch, timeoutMs = 12000 } = {}) {
  if (!config.apiKey && !(config.appId && config.accessKey)) throw narrationError(503, '朗读服务尚未配置，请联系管理员');
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl('https://openspeech.bytedance.com/api/v3/tts/unidirectional', {
      method: 'POST', redirect: 'error', signal: controller.signal,
      headers: {
        'Content-Type': 'application/json', 'X-Api-Request-Id': randomUUID(),
        'X-Api-Resource-Id': config.resource,
        ...(config.apiKey ? { 'X-Api-Key': config.apiKey } : { 'X-Api-App-Id': config.appId, 'X-Api-Access-Key': config.accessKey }),
      },
      body: JSON.stringify({ user: { uid: 'wqt-card-reader' }, req_params: {
        text, speaker: config.speaker, audio_params: { format: 'mp3', sample_rate: 24000, speech_rate: config.speechRate },
      } }),
    });
    if (!response.ok || !response.body) throw narrationError(response.status === 429 ? 429 : 502, '朗读服务暂不可用，请稍后重试');
    let pending = '', total = 0, received = 0, complete = false;
    const audio = [];
    function parse(line) {
      if (!line.trim()) return;
      const event = JSON.parse(line);
      if (complete || ![0, 20000000].includes(event.code)) throw narrationError(502, '朗读生成失败，请稍后重试');
      if (event.data) {
        if (typeof event.data !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(event.data)) throw narrationError(502, '朗读音频格式无效');
        const chunk = Buffer.from(event.data, 'base64');
        total += chunk.length;
        if (total > MAX_AUDIO) throw narrationError(502, '朗读音频过大');
        audio.push(chunk);
      }
      if (event.code === 20000000) complete = true;
    }
    for await (const chunk of response.body) {
      received += chunk.length;
      if (received > MAX_AUDIO * 2) throw narrationError(502, '朗读响应过大');
      pending += Buffer.from(chunk).toString('utf8');
      let newline;
      while ((newline = pending.indexOf('\n')) !== -1) { parse(pending.slice(0, newline)); pending = pending.slice(newline + 1); }
    }
    parse(pending);
    if (!complete || !total) throw narrationError(502, '朗读音频不完整，请重试');
    const result = Buffer.concat(audio);
    if (!(result.subarray(0, 3).toString() === 'ID3' || (result[0] === 255 && (result[1] & 224) === 224)))
      throw narrationError(502, '朗读音频格式无效');
    return result;
  } catch (error) {
    controller.abort();
    if (error.status) throw error;
    throw narrationError(502, error.name === 'AbortError' ? '朗读生成超时，请重试' : '朗读服务暂不可用，请稍后重试');
  } finally { clearTimeout(timer); }
}

export function createNarrationService({ ossClient, withLock, config = () => narrationConfig(), synthesize = synthesizeNarration }) {
  const pending = new Map();
  async function read(key) {
    try {
      const result = await ossClient.get(key, { timeout: 5000 });
      if (!Buffer.isBuffer(result.content) || !result.content.length || result.content.length > MAX_AUDIO) throw narrationError(502, '朗读缓存无效');
      return result.content;
    } catch (error) {
      if (error.code === 'NoSuchKey' || error.status === 404) return null;
      throw narrationError(502, '朗读音频暂不可用，请重试');
    }
  }
  return async card => {
    if (!ossClient) throw narrationError(503, '朗读音频存储尚未配置');
    const settings = config(), input = narrationInput(card, settings);
    if (pending.has(input.hash)) return pending.get(input.hash);
    if (pending.size >= 4) throw narrationError(429, '朗读服务繁忙，请稍后重试');
    const work = (async () => {
      const cached = await read(input.key);
      if (cached) return cached;
      return withLock(input.hash, async () => {
        const cached = await read(input.key);
        if (cached) return cached;
        const audio = await synthesize(input.text, settings);
        try { await ossClient.put(input.key, audio, { timeout: 5000, headers: { 'x-oss-object-acl': 'private', 'Content-Type': 'audio/mpeg' } }); }
        catch { throw narrationError(502, '朗读音频保存失败，请重试'); }
        return audio;
      });
    })();
    pending.set(input.hash, work);
    try { return await work; } finally { pending.delete(input.hash); }
  };
}
