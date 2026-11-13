import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNarrationPlayer } from '../../public/player/narration.js';

function setup(fetchImpl) {
  let calls = 0, revoked = 0;
  const errors = [], target = { textContent: '', setAttribute() {} };
  const audio = { paused: true, currentTime: 0, async play() { this.paused = false; }, pause() { this.paused = true; }, removeAttribute() {}, load() {} };
  const player = createNarrationPlayer({ fetchImpl: (...args) => { calls++; return fetchImpl(...args); }, createAudio: () => audio, urls: { createObjectURL: () => 'blob:synthetic', revokeObjectURL: () => revoked++ } });
  const input = { sessionId: 1, cardId: 2, target, token: 'synthetic', onError: e => errors.push(e.message) };
  return { player, input, audio, target, errors, get calls() { return calls; }, get revoked() { return revoked; } };
}
const ok = () => new Response(new Blob(['ID3-synthetic'], { type: 'audio/mpeg' }));

test('play, pause, resume, replay and dispose reuse one audio and release object URL', async () => {
  const s = setup(async (url, options) => { assert.equal(url, '/api/player/narration/1/2'); assert.equal(options.headers.Authorization, 'Bearer synthetic'); return ok(); });
  await s.player.toggle(s.input); assert.equal(s.audio.paused, false);
  await s.player.toggle(s.input); assert.equal(s.audio.paused, true);
  await s.player.toggle(s.input); assert.equal(s.audio.paused, false); assert.equal(s.calls, 1);
  s.audio.onended(); assert.match(s.target.textContent, /重新/);
  s.player.stop(); assert.equal(s.audio.paused, true); assert.equal(s.revoked, 1);
});
test('switching card/page while preparing prevents late audio playback; duplicate click coalesces', async () => {
  let finish;
  const s = setup(() => new Promise(resolve => { finish = resolve; }));
  const pending = s.player.toggle(s.input);
  await s.player.toggle(s.input); assert.equal(s.calls, 1);
  s.player.stop(); finish(ok()); await pending;
  assert.equal(s.audio.paused, true); assert.equal(s.errors.length, 0);
});
test('service errors allow retry and do not start device speech', async () => {
  let fail = true;
  const s = setup(async () => fail ? new Response(JSON.stringify({ error: '朗读服务尚未配置' }), { status: 503 }) : ok());
  await s.player.toggle(s.input); assert.deepEqual(s.errors, ['朗读服务尚未配置']);
  fail = false; await s.player.toggle(s.input); assert.equal(s.audio.paused, false); s.player.stop();
});
test('mobile autoplay rejection retains prepared audio for next user gesture', async () => {
  const s = setup(async () => ok()); let attempt = 0;
  s.audio.play = async () => { if (!attempt++) throw new Error('NotAllowedError'); s.audio.paused = false; };
  await s.player.toggle(s.input); assert.match(s.target.textContent, /点击播放/);
  await s.player.toggle(s.input); assert.equal(s.audio.paused, false); assert.equal(s.calls, 1); s.player.stop();
});
