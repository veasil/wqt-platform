import { test } from 'node:test';
import assert from 'node:assert/strict';
import { narrationConfig, narrationInput, synthesizeNarration, createNarrationService } from '../../src/services/card-narration.js';
import { narrationHandler } from '../../src/game/player/narration.js';

const config = narrationConfig({ VOLC_TTS_API_KEY: 'synthetic-test-key' });
const card = { title: '小伍的选择', event: '小伍收到了一条陌生消息。' };
const mp3 = Buffer.from([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 0]);
const events = (...items) => items.map(item => JSON.stringify(item)).join('\n');
const success = events({ code: 0, data: mp3.toString('base64') }, { code: 20000000 });
function response(body, status = 200) { return new Response(body, { status }); }

test('voice configuration and immutable content cache include text, voice, model and speed', () => {
  assert.equal(config.speaker, 'zh_male_shaonianzixin_moon_bigtts');
  const a = narrationInput(card, config);
  assert.equal(a.text, '小伍的选择。\n小伍收到了一条陌生消息。');
  assert.equal(narrationInput({ ...card, audio_url: 'ignored', id: 100 }, config).key, a.key);
  for (const other of [{ ...config, speaker: 'another' }, { ...config, resource: 'seed-tts-2.0' }, { ...config, speechRate: 0 }])
    assert.notEqual(narrationInput(card, other).key, a.key);
  assert.notEqual(narrationInput({ ...card, event: '新题面' }, config).key, a.key);
  assert.throws(() => narrationConfig({ VOLC_TTS_SPEECH_RATE: 'bad' }), { status: 503 });
  assert.throws(() => narrationInput({ event: '字'.repeat(5000) }, config), { status: 422 });
});

test('official request contract and HTTP chunk boundaries produce complete MP3', async () => {
  let request;
  const result = await synthesizeNarration(card.event, config, { fetchImpl: async (url, options) => {
    request = { url, ...options };
    const bytes = Buffer.from(success);
    return response(new ReadableStream({ start(c) { c.enqueue(bytes.subarray(0, 13)); c.enqueue(bytes.subarray(13, 31)); c.enqueue(bytes.subarray(31)); c.close(); } }));
  } });
  assert.deepEqual(result, mp3);
  assert.equal(request.url, 'https://openspeech.bytedance.com/api/v3/tts/unidirectional');
  assert.equal(request.headers['X-Api-Key'], 'synthetic-test-key');
  assert.equal(request.headers['X-Api-Resource-Id'], 'seed-tts-1.0');
  const body = JSON.parse(request.body);
  assert.equal(body.req_params.speaker, config.speaker);
  assert.equal(body.req_params.audio_params.speech_rate, -5);
  assert.equal(body.user.uid, 'wqt-card-reader');
});

test('missing credentials, HTTP errors, invalid/empty/truncated audio and timeouts never succeed', async () => {
  await assert.rejects(synthesizeNarration('测试', {}), { status: 503 });
  for (const body of ['oops', events({ code: 45000000, message: 'private upstream error' }), events({ code: 20000000 }), events({ code: 0, data: mp3.toString('base64') }), events({ code: 0, data: 'not-base64!' }), events({ code: 0, data: Buffer.from('oops').toString('base64') }, { code: 20000000 })]) {
    await assert.rejects(synthesizeNarration('测试', config, { fetchImpl: async () => response(body) }), { status: 502 });
  }
  await assert.rejects(synthesizeNarration('测试', config, { fetchImpl: async () => response('', 429) }), { status: 429 });
  await assert.rejects(synthesizeNarration('测试', config, { timeoutMs: 5, fetchImpl: async (_u, { signal }) => new Promise((_r, reject) => signal.addEventListener('abort', () => reject(Object.assign(new Error(), { name: 'AbortError' })))) }), /超时/);
});

function storage() {
  const objects = new Map(); let writes = 0;
  return { objects, get writes() { return writes; },
    async get(key) { if (!objects.has(key)) throw Object.assign(new Error(), { code: 'NoSuchKey' }); return { content: objects.get(key) }; },
    async put(key, content, options) { assert.equal(options.headers['x-oss-object-acl'], 'private'); writes++; objects.set(key, content); },
  };
}
test('concurrent requests coalesce, persistent cache survives a new service, edits invalidate it', async () => {
  const ossClient = storage(); let calls = 0, locks = 0;
  const deps = { ossClient, config: () => config, withLock: async (_hash, work) => { locks++; return work(); }, synthesize: async () => { calls++; return mp3; } };
  const narrate = createNarrationService(deps);
  await Promise.all(Array.from({ length: 8 }, () => narrate(card)));
  assert.equal(calls, 1); assert.equal(locks, 1); assert.equal(ossClient.writes, 1);
  await createNarrationService(deps)(card);
  assert.equal(calls, 1);
  await narrate({ ...card, event: '修改后的题面' });
  assert.equal(calls, 2);
});
test('failed generation/storage never becomes a success cache; missing OSS fails closed', async () => {
  const ossClient = storage(); let calls = 0;
  const deps = { ossClient, config: () => config, withLock: async (_hash, work) => work(), synthesize: async () => { calls++; throw new Error('synthetic provider failure'); } };
  const narrate = createNarrationService(deps);
  await assert.rejects(narrate(card)); await assert.rejects(narrate(card));
  assert.equal(calls, 2); assert.equal(ossClient.writes, 0);
  await assert.rejects(createNarrationService({ ...deps, ossClient: null })(card), { status: 503 });
  await assert.rejects(createNarrationService({ ...deps, ossClient: { ...ossClient, put: async () => { throw new Error(); } }, synthesize: async () => mp3 })(card), /保存失败/);
});
test('distributed lock loser cannot call provider, cache read is rechecked inside lock', async () => {
  const ossClient = storage(); let calls = 0;
  const deps = { ossClient, config: () => config, synthesize: async () => { calls++; return mp3; } };
  await assert.rejects(createNarrationService({ ...deps, withLock: async () => { throw Object.assign(new Error('busy'), { status: 429 }); } })(card), { status: 429 });
  await createNarrationService({ ...deps, withLock: async (_hash, work) => { ossClient.objects.set(narrationInput(card, config).key, mp3); return work(); } })(card);
  assert.equal(calls, 0);
});
test('route checks session and released snapshot on every call; ignores client text and URLs', async () => {
  let session = null, released = null, calls = 0;
  const handler = narrationHandler({ accessibleSession: async (actor, id) => { assert.equal(actor.identityId, 'synthetic'); assert.equal(id, '1'); return session; }, releasedCard: async () => released, narrate: async input => { assert.deepEqual(input, card); calls++; return mp3; } });
  function res() { return { statusCode: 200, status(n) { this.statusCode = n; return this; }, json(v) { this.data = v; return this; }, set() { return this; }, type() { return this; }, send(v) { this.data = v; return this; } }; }
  const req = { actor: { identityId: 'synthetic' }, params: { sessionId: '1', cardId: '2' }, body: { text: '恶意任意文本', url: 'http://internal/' } };
  let out = res(); await handler(req, out); assert.equal(out.statusCode, 404);
  session = { player_state_json: '{}', game_settings_json: '{}' };
  out = res(); await handler(req, out); assert.equal(out.statusCode, 409);
  session.game_settings_json = JSON.stringify({ cardSnapshot: { releasedIds: [2] } });
  out = res(); await handler(req, out); assert.equal(out.statusCode, 404);
  released = card; out = res(); await handler(req, out); assert.deepEqual(out.data, mp3); assert.equal(calls, 1);
  session = null; out = res(); await handler(req, out); assert.equal(out.statusCode, 404); assert.equal(calls, 1);
});
