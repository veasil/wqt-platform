import { createServer } from 'node:http';
import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { copyFileSync, createReadStream, existsSync, mkdirSync } from 'node:fs';
import { rename, stat, unlink, writeFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const isVercel = Boolean(process.env.VERCEL);
const envPath = path.resolve(scriptDir, '../.env');
if (!isVercel && existsSync(envPath)) loadEnvFile(envPath);
const serviceEnvPath = process.env.WQT_SERVICE_ENV || path.resolve(scriptDir, '../../../wqt-auth-backend/.env');
if (!isVercel && existsSync(serviceEnvPath)) loadEnvFile(serviceEnvPath);
const deploymentDataDir = path.resolve(scriptDir, '../deployment-data');
const bundledCardsDbPath = path.join(deploymentDataDir, 'cards.db');
const developmentCardsDbPath = path.resolve(scriptDir, '../../data/cards.db');
const dbPath = process.env.WQT_CARDS_DB || (!isVercel && existsSync(developmentCardsDbPath)
  ? developmentCardsDbPath
  : bundledCardsDbPath);
const testDbSeedPath = path.join(deploymentDataDir, 'test-wqt.seed.db');
const testDbPath = process.env.WQT_TEST_DB || (isVercel
  ? path.join(tmpdir(), 'wqt-test-runtime.db')
  : path.resolve(scriptDir, '../data/test-wqt.db'));
const port = Number(process.env.WQT_CARDS_PORT || 8080);
const db = new DatabaseSync(dbPath, { readOnly: true });
mkdirSync(path.dirname(testDbPath), { recursive: true });
if (!existsSync(testDbPath) && existsSync(testDbSeedPath)) copyFileSync(testDbSeedPath, testDbPath);
const testDb = new DatabaseSync(testDbPath);
testDb.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
const sessions = new Map();
const testAuthTokens = new Map();
const humanChallenges = new Map();
const humanProofs = new Map();
const localSmsCodes = new Map();
const smsPhoneQuota = new Map();
const smsIpQuota = new Map();
const ttsJobs = new Map();
const audioTokens = new Map();
const reviewJobs = new Map();
const ttsCacheDir = process.env.WQT_TTS_CACHE_DIR || (isVercel ? path.join(tmpdir(), 'wqt-tts') : path.resolve(scriptDir, '../.cache/tts'));
const recordingDir = process.env.WQT_RECORDING_DIR || (isVercel ? path.join(tmpdir(), 'wqt-recordings') : path.resolve(scriptDir, '../.cache/recordings'));
const ttsEndpoint = process.env.VOLCENGINE_TTS_ENDPOINT || 'https://openspeech.bytedance.com/api/v3/tts/unidirectional';
const ttsApiKey = process.env.VOLCENGINE_TTS_API_KEY || '';
const ttsResourceId = process.env.VOLCENGINE_TTS_RESOURCE_ID || 'seed-tts-2.0';
const ttsVoiceType = process.env.VOLCENGINE_TTS_VOICE_TYPE || 'zh_female_xueayi_saturn_bigtts';
const ttsVoiceName = process.env.VOLCENGINE_TTS_VOICE_NAME || '小伍·儿童绘本';
const ratio = (value, fallback) => Number.isFinite(Number(value)) ? Math.min(2, Math.max(0.5, Number(value))) : fallback;
const ttsSpeedRatio = ratio(process.env.VOLCENGINE_TTS_SPEED_RATIO, 1);
const ttsLoudnessRatio = ratio(process.env.VOLCENGINE_TTS_LOUDNESS_RATIO, 1);
const ttsSpeechRate = Math.round((ttsSpeedRatio - 1) * 100);
const ttsLoudnessRate = Math.round((ttsLoudnessRatio - 1) * 100);
mkdirSync(ttsCacheDir, { recursive: true });
mkdirSync(recordingDir, { recursive: true });

function initializeTestDatabase() {
  testDb.exec(`
    CREATE TABLE IF NOT EXISTS organizations (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL, owner_user_id INTEGER NOT NULL,
      max_members INTEGER NOT NULL DEFAULT 50, description TEXT, status TEXT DEFAULT 'active',
      valid_until INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY, username TEXT UNIQUE, phone TEXT UNIQUE, wechat_openid TEXT UNIQUE,
      unionid TEXT, password_hash TEXT, guardian_name TEXT, real_name TEXT,
      is_profile_complete INTEGER DEFAULT 0, role TEXT DEFAULT 'watcher', enterprise_id INTEGER,
      watcher_level TEXT DEFAULT 'initial', valid_until INTEGER, created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS activities (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL, organizer TEXT, activity_code TEXT UNIQUE,
      started_at INTEGER, ended_at INTEGER, created_by INTEGER, enterprise_id INTEGER,
      status TEXT DEFAULT 'active', location TEXT, latitude REAL, longitude REAL, created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS activity_game_presets (
      activity_id INTEGER PRIMARY KEY, deck_version TEXT NOT NULL, game_mode TEXT NOT NULL,
      duration INTEGER NOT NULL, phase_targets_json TEXT NOT NULL, card_group_ids_json TEXT NOT NULL,
      FOREIGN KEY(activity_id) REFERENCES activities(id)
    );
    CREATE TABLE IF NOT EXISTS card_runtime_overrides (
      card_code TEXT PRIMARY KEY, phase TEXT, safety_type TEXT, updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS game_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, started_at INTEGER, ended_at INTEGER,
      final_score INTEGER, payload_json TEXT, location TEXT, players_json TEXT, game_mode TEXT,
      game_settings_json TEXT, status TEXT DEFAULT 'active', score_details_json TEXT, card_group_id INTEGER
    );
    CREATE TABLE IF NOT EXISTS game_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT, session_id INTEGER NOT NULL, ts INTEGER NOT NULL,
      type TEXT NOT NULL, payload TEXT
    );
    CREATE TABLE IF NOT EXISTS user_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, jti TEXT NOT NULL UNIQUE,
      device_info TEXT, ip TEXT, created_at INTEGER NOT NULL, last_seen_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS recordings (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, session_id INTEGER,
      file_name TEXT NOT NULL, mime_type TEXT NOT NULL, size_bytes INTEGER NOT NULL,
      file_path TEXT NOT NULL, created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS review_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT, session_id INTEGER NOT NULL, user_id INTEGER NOT NULL,
      created_at INTEGER NOT NULL, provider TEXT, report_json TEXT NOT NULL, report_html TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS user_feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, type TEXT DEFAULT 'reflection',
      content TEXT NOT NULL, activity_id INTEGER, session_id INTEGER, created_at INTEGER NOT NULL,
      reviewed INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS support_tickets (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, session_id INTEGER,
      category TEXT NOT NULL, subject TEXT, priority TEXT DEFAULT 'normal', content TEXT NOT NULL,
      context_json TEXT, status TEXT DEFAULT 'open', created_at INTEGER NOT NULL,
      updated_at INTEGER, last_reply_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS support_ticket_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT, ticket_id INTEGER NOT NULL, author_type TEXT NOT NULL,
      author_user_id INTEGER, content TEXT NOT NULL, created_at INTEGER NOT NULL,
      FOREIGN KEY(ticket_id) REFERENCES support_tickets(id) ON DELETE CASCADE
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_review_reports_session ON review_reports(session_id);
  `);
  const ticketColumns = new Set(testDb.prepare('PRAGMA table_info(support_tickets)').all().map((column) => column.name));
  for (const [name, definition] of [
    ['subject', 'TEXT'], ['priority', "TEXT DEFAULT 'normal'"], ['updated_at', 'INTEGER'], ['last_reply_at', 'INTEGER'],
  ]) {
    if (!ticketColumns.has(name)) testDb.exec(`ALTER TABLE support_tickets ADD COLUMN ${name} ${definition}`);
  }
  testDb.exec('UPDATE support_tickets SET updated_at = COALESCE(updated_at, created_at), last_reply_at = COALESCE(last_reply_at, created_at)');
  const activityColumns = new Set(testDb.prepare('PRAGMA table_info(activities)').all().map((column) => column.name));
  for (const [name, definition] of [['location', 'TEXT'], ['latitude', 'REAL'], ['longitude', 'REAL']]) {
    if (!activityColumns.has(name)) testDb.exec(`ALTER TABLE activities ADD COLUMN ${name} ${definition}`);
  }
  const now = Date.now();
  const activity = testDb.prepare('SELECT id FROM activities WHERE activity_code = ?').get('WQT-0820');
  if (!activity) {
    const inserted = testDb.prepare(`INSERT INTO activities
      (name, organizer, activity_code, started_at, ended_at, created_by, enterprise_id, status, location, latitude, longitude, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)`).run('未来守望者 · 城市站', 'AI 5000天', 'WQT-0820', now - 3_600_000, now + 14_400_000, null, null, '上海 · 城市站', 31.2304, 121.4737, now);
    testDb.prepare(`INSERT INTO activity_game_presets
      (activity_id, deck_version, game_mode, duration, phase_targets_json, card_group_ids_json)
      VALUES (?, ?, ?, ?, ?, ?)`).run(Number(inserted.lastInsertRowid), '2026 版', '标准成长模式', 5000, JSON.stringify([5, 3, 4]), JSON.stringify([6]));
  } else {
    testDb.prepare(`UPDATE activities SET
      started_at = COALESCE(started_at, ?), ended_at = COALESCE(ended_at, ?),
      location = COALESCE(location, ?), latitude = COALESCE(latitude, ?), longitude = COALESCE(longitude, ?)
      WHERE id = ?`).run(now - 3_600_000, now + 14_400_000, '上海 · 城市站', 31.2304, 121.4737, activity.id);
  }
  testDb.prepare('DELETE FROM card_runtime_overrides WHERE upper(card_code) = ?').run('2026D08');
}

initializeTestDatabase();

function json(response, status, payload) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-WQT-Client',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
    'Cache-Control': 'no-store',
  });
  response.end(JSON.stringify(payload));
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function readBinaryBody(request, maxBytes = 50 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) throw Object.assign(new Error('上传文件不能超过 50MB'), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function truncateUtf8(value, maxBytes = 960) {
  let result = '';
  let bytes = 0;
  for (const character of value) {
    const size = Buffer.byteLength(character);
    if (bytes + size > maxBytes) break;
    result += character;
    bytes += size;
  }
  return result;
}

function normalizedTtsText(value) {
  return truncateUtf8(String(value || '').replace(/\s+/g, ' ').trim());
}

function ttsText(card) {
  return normalizedTtsText(card.event);
}

function ttsCacheKey(text, kind = 'card') {
  return createHash('sha256')
    .update(JSON.stringify({
      version: 3,
      kind,
      provider: 'volcengine',
      voiceType: ttsVoiceType,
      resourceId: ttsResourceId,
      speechRate: ttsSpeechRate,
      loudnessRate: ttsLoudnessRate,
      text,
    }))
    .digest('hex');
}

async function validAudioFile(filePath) {
  if (!existsSync(filePath)) return false;
  try { return (await stat(filePath)).size > 1024; } catch { return false; }
}

function requireVolcengineTtsConfig() {
  if (ttsApiKey) return;
  throw Object.assign(new Error('火山引擎语音服务尚未配置，请设置 VOLCENGINE_TTS_API_KEY'), { status: 503 });
}

function parseChunkedJson(payload) {
  const objects = [];
  let start = -1;
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = 0; index < payload.length; index += 1) {
    const character = payload[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') quoted = false;
      continue;
    }
    if (character === '"') { quoted = true; continue; }
    if (character === '{') {
      if (depth === 0) start = index;
      depth += 1;
    } else if (character === '}') {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        objects.push(JSON.parse(payload.slice(start, index + 1)));
        start = -1;
      }
    }
  }
  if (depth !== 0 || !objects.length) throw new Error('火山引擎返回了无法解析的流式响应');
  return objects;
}

async function synthesizeWithVolcengine(text) {
  requireVolcengineTtsConfig();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);
  try {
    const response = await fetch(ttsEndpoint, {
      method: 'POST',
      headers: {
        'X-Api-Key': ttsApiKey,
        'X-Api-Resource-Id': ttsResourceId,
        'X-Api-Request-Id': randomUUID(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        req_params: {
          text,
          speaker: ttsVoiceType,
          audio_params: {
            format: 'mp3',
            sample_rate: 24000,
            bit_rate: 64000,
            speech_rate: ttsSpeechRate,
            loudness_rate: ttsLoudnessRate,
          },
          additions: JSON.stringify({
            disable_markdown_filter: true,
            disable_emoji_filter: true,
            explicit_language: 'zh-cn',
          }),
        },
      }),
      signal: controller.signal,
    });
    const rawPayload = await response.text();
    const chunks = parseChunkedJson(rawPayload);
    const successCodes = new Set([0, 20000000]);
    const failed = chunks.find((chunk) => {
      const code = chunk.code ?? chunk.header?.code;
      return code !== undefined && code !== null && !successCodes.has(Number(code));
    });
    if (!response.ok || failed) {
      const detail = failed?.message || failed?.header?.message || `HTTP ${response.status}`;
      throw new Error(`火山引擎返回异常：${detail}`);
    }
    const audio = Buffer.concat(chunks.filter((chunk) => chunk.data).map((chunk) => Buffer.from(chunk.data, 'base64')));
    if (audio.length <= 1024) throw new Error('火山引擎未返回有效音频');
    return audio;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('火山引擎语音生成超时');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function ensureCardAudio(card) {
  if (card.audio_url) return { source: 'published', audioUrl: card.audio_url, cache: 'published' };
  const text = ttsText(card);
  if (!text) throw Object.assign(new Error('卡牌没有可朗读正文'), { status: 422 });
  return ensureGeneratedAudio(text, 'card');
}

async function ensureGeneratedAudio(rawText, kind = 'feedback') {
  const text = normalizedTtsText(rawText);
  if (!text) throw Object.assign(new Error('没有可朗读的文字'), { status: 422 });
  const cacheKey = ttsCacheKey(text, kind);
  const audioPath = path.join(ttsCacheDir, `${cacheKey}.mp3`);
  if (await validAudioFile(audioPath)) return { source: 'volcengine', cacheKey, audioPath, cache: 'hit', voiceType: ttsVoiceType };
  if (ttsJobs.has(cacheKey)) return ttsJobs.get(cacheKey);

  const job = (async () => {
    const pendingPath = path.join(ttsCacheDir, `${cacheKey}.${randomUUID()}.part`);
    try {
      const audio = await synthesizeWithVolcengine(text);
      await writeFile(pendingPath, audio);
      await rename(pendingPath, audioPath);
      if (!await validAudioFile(audioPath)) throw new Error('TTS 未生成有效音频');
      return { source: 'volcengine', cacheKey, audioPath, cache: 'generated', voiceType: ttsVoiceType };
    } catch (error) {
      await unlink(pendingPath).catch(() => {});
      await unlink(audioPath).catch(() => {});
      throw Object.assign(new Error(`语音生成失败：${error.message}`), { status: error.status || 502 });
    } finally {
      ttsJobs.delete(cacheKey);
    }
  })();
  ttsJobs.set(cacheKey, job);
  return job;
}

function issueAudioToken(session, audioPath) {
  const now = Date.now();
  for (const [token, grant] of audioTokens) if (grant.expiresAt <= now) audioTokens.delete(token);
  const token = randomUUID();
  audioTokens.set(token, { sessionId: session.id, audioPath, expiresAt: now + 15 * 60 * 1000 });
  return token;
}

async function streamAudio(request, response, grant) {
  const info = await stat(grant.audioPath);
  const range = request.headers.range;
  const common = {
    'Content-Type': 'audio/mpeg',
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, max-age=900, immutable',
    'Access-Control-Allow-Origin': 'http://127.0.0.1:4173',
  };
  if (!range) {
    response.writeHead(200, { ...common, 'Content-Length': info.size });
    createReadStream(grant.audioPath).pipe(response);
    return;
  }
  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!match) return json(response, 416, { error: 'Invalid range' });
  const start = match[1] ? Number(match[1]) : 0;
  const end = match[2] ? Math.min(Number(match[2]), info.size - 1) : info.size - 1;
  if (start > end || start >= info.size) return json(response, 416, { error: 'Range not satisfiable' });
  response.writeHead(206, {
    ...common,
    'Content-Range': `bytes ${start}-${end}/${info.size}`,
    'Content-Length': end - start + 1,
  });
  createReadStream(grant.audioPath, { start, end }).pipe(response);
}

function parseOptions(card) {
  try { return JSON.parse(card.options_json || '{}'); } catch { return {}; }
}

const POWER_NAMES = ['安全力', '脑波力', '实感力', '创心力', '沟通力'];

function calculateMaxScores(cards) {
  const totals = Object.fromEntries(POWER_NAMES.map((name) => [name, 0]));
  for (const card of cards) {
    const cardMaximums = Object.fromEntries(POWER_NAMES.map((name) => [name, 0]));
    for (const option of Object.values(parseOptions(card))) {
      for (const name of POWER_NAMES) cardMaximums[name] = Math.max(cardMaximums[name], Number(option?.attributeEffects?.[name]) || 0);
    }
    for (const name of POWER_NAMES) totals[name] += cardMaximums[name];
  }
  return totals;
}

function calculatePowerScore(attributes = {}, maxScores = {}) {
  const scoreDetails = {};
  let rateTotal = 0;
  let dimensionCount = 0;
  for (const name of POWER_NAMES) {
    const actual = Number(attributes[name]) || 0;
    const max = Number(maxScores[name]) || 0;
    const rate = max > 0 ? Math.max(0, Math.min(actual / max, 1)) : 0;
    scoreDetails[name] = { actual, max, rate: Math.round(rate * 10000) / 10000 };
    if (max > 0) { rateTotal += rate; dimensionCount += 1; }
  }
  return { finalScore: dimensionCount ? Math.round(rateTotal / dimensionCount * 100) : 0, scoreDetails };
}

function shortCode(card) {
  return String(card.card_code || card.card_id).replace(/^2026/i, '');
}

function rowsForGroup(group) {
  let ids = [];
  try { ids = JSON.parse(group.released_ids_json || '[]'); } catch { ids = []; }
  if (!ids.length) return [];
  const rows = db.prepare(`SELECT * FROM cards_released WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids);
  const byId = new Map(rows.map((row) => [row.id, row]));
  return ids.map((id) => byId.get(id)).filter(Boolean);
}

function selectGroups(deckVersion, requestedGroupIds = []) {
  const groups = db.prepare('SELECT * FROM card_groups ORDER BY is_default DESC, id ASC').all();
  const requestedIds = new Set(requestedGroupIds.map(Number).filter(Number.isFinite));
  if (requestedIds.size) return groups.filter((group) => requestedIds.has(Number(group.id)));
  const wants2026 = String(deckVersion || '').includes('2026');
  const fallback = (wants2026
    ? groups.find((group) => String(group.name).includes('2026'))
    : groups.find((group) => group.name === '初版卡牌' || String(group.name).includes('2025')))
    || groups.find((group) => group.is_default)
    || groups[0];
  return fallback ? [fallback] : [];
}

function cardsForGroups(groups) {
  const cardsByReleasedId = new Map();
  for (const group of groups) {
    for (const row of rowsForGroup(group)) {
      const existing = cardsByReleasedId.get(row.id);
      if (existing) {
        existing.group_ids.push(group.id);
        existing.group_names.push(group.name);
      } else {
        cardsByReleasedId.set(row.id, { ...row, group_ids: [group.id], group_names: [group.name] });
      }
    }
  }
  const phaseOverrides = new Map(testDb.prepare('SELECT * FROM card_runtime_overrides').all().map((row) => [String(row.card_code).toUpperCase(), row]));
  return [...cardsByReleasedId.values()].map((card) => {
    const override = phaseOverrides.get(cardCode(card));
    return override ? { ...card, phase: override.phase || card.phase, safety_type: override.safety_type || card.safety_type } : card;
  });
}

function restoreGameSession(sessionId) {
  const id = String(sessionId || '');
  if (!id) return null;
  const row = testDb.prepare('SELECT * FROM game_sessions WHERE id = ?').get(id);
  if (!row) return null;

  const storedPayload = parseJson(row.payload_json, {});
  const settings = parseJson(row.game_settings_json, {});
  const eventRows = testDb.prepare('SELECT type, payload FROM game_events WHERE session_id = ? ORDER BY id ASC').all(id);
  const events = eventRows.map((event) => ({ type: event.type, payload: parseJson(event.payload, {}) }));
  const startEvent = events.find((event) => event.type === 'game_start')?.payload || {};
  const groupIds = storedPayload.cardGroupIds || startEvent.groupIds || (row.card_group_id ? [row.card_group_id] : []);
  const groups = selectGroups(settings.deckVersion, groupIds);
  if (!groups.length) return null;

  const cards = cardsForGroups(groups);
  const answeredCardIds = new Set();
  const phaseProgress = { 启蒙期: 0, 成长期: 0, 青春期: 0 };
  for (const event of events) {
    if (event.type !== 'card_choice') continue;
    if (event.payload.cardId) answeredCardIds.add(event.payload.cardId);
    if (event.payload.phase) phaseProgress[event.payload.phase] = (phaseProgress[event.payload.phase] || 0) + 1;
  }

  const restored = {
    id,
    userId: row.user_id,
    activityId: storedPayload.activityId || null,
    activityCode: storedPayload.activityCode || startEvent.activityCode || null,
    groupIds: groups.map((group) => group.id),
    cards,
    maxScores: calculateMaxScores(cards),
    answeredCardIds,
    pendingGrant: null,
    cardGrants: new Map(),
    feedbackGrants: new Map(),
    phaseProgress,
    cardsPerPhase: settings.cardsPerPhase || {},
    startedAt: row.started_at,
    endedAt: row.ended_at || null,
    clientInstance: startEvent.clientInstance || null,
    audit: [],
  };
  sessions.set(id, restored);
  return restored;
}

function requireOwnedSession(sessionId, request) {
  const auth = requireTestAuth(request);
  const id = String(sessionId || '');
  const session = sessions.get(id) || restoreGameSession(id);
  if (!session) throw Object.assign(new Error('游戏会话不存在'), { status: 404 });
  if (Number(session.userId) !== Number(auth.userId)) throw Object.assign(new Error('无权访问这局游戏'), { status: 403 });
  if (session.clientInstance && session.clientInstance !== request.headers['x-wqt-client']) {
    throw Object.assign(new Error('当前设备与开局设备不一致'), { status: 403 });
  }
  return session;
}

function requireSession(sessionId, request) {
  const session = requireOwnedSession(sessionId, request);
  if (session.endedAt) throw Object.assign(new Error('游戏会话已结束'), { status: 409 });
  return session;
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ''));
  const rightBuffer = Buffer.from(String(right || ''));
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function verifyTestPassword(password, storedHash) {
  const [scheme, salt, digest] = String(storedHash || '').split('$');
  if (scheme !== 'scrypt' || !salt || !digest) return false;
  const candidate = scryptSync(String(password || ''), salt, 32).toString('hex');
  return safeEqual(candidate, digest);
}

function hashTestPassword(password) {
  const salt = randomBytes(16).toString('hex');
  return `scrypt$${salt}$${scryptSync(String(password), salt, 32).toString('hex')}`;
}

function requestIp(request) {
  return String(request.headers['x-forwarded-for'] || request.socket?.remoteAddress || '').split(',')[0].trim();
}

function pruneTransientAuth() {
  const now = Date.now();
  for (const [id, challenge] of humanChallenges) if (challenge.expiresAt <= now) humanChallenges.delete(id);
  for (const [proof, grant] of humanProofs) if (grant.expiresAt <= now) humanProofs.delete(proof);
  for (const [phone, grant] of localSmsCodes) if (grant.expiresAt <= now) localSmsCodes.delete(phone);
}

function issueHumanChallenge(request) {
  pruneTransientAuth();
  const id = randomUUID();
  humanChallenges.set(id, {
    clientInstance: request.headers['x-wqt-client'] || null,
    ip: requestIp(request),
    startedAt: Date.now(),
    expiresAt: Date.now() + 2 * 60 * 1000,
  });
  return id;
}

function verifyHumanChallenge(request, challengeId) {
  pruneTransientAuth();
  const challenge = humanChallenges.get(String(challengeId || ''));
  if (!challenge) throw Object.assign(new Error('人机验证已失效，请重试'), { status: 400 });
  const heldMs = Date.now() - challenge.startedAt;
  if (challenge.clientInstance !== (request.headers['x-wqt-client'] || null) || challenge.ip !== requestIp(request)) {
    throw Object.assign(new Error('人机验证设备不一致'), { status: 403 });
  }
  if (heldMs < 850) throw Object.assign(new Error('请按住验证区域直至完成'), { status: 400 });
  humanChallenges.delete(challengeId);
  const proof = randomUUID();
  humanProofs.set(proof, { clientInstance: challenge.clientInstance, ip: challenge.ip, expiresAt: Date.now() + 10 * 60 * 1000 });
  return proof;
}

function requireHumanProof(request, proof, { consume = false } = {}) {
  pruneTransientAuth();
  const grant = humanProofs.get(String(proof || ''));
  if (!grant) throw Object.assign(new Error('请先完成人机验证'), { status: 400 });
  if (grant.clientInstance !== (request.headers['x-wqt-client'] || null) || grant.ip !== requestIp(request)) {
    throw Object.assign(new Error('人机验证设备不一致'), { status: 403 });
  }
  if (consume) humanProofs.delete(String(proof));
  return grant;
}

function checkSmsQuota(phone, ip) {
  const now = Date.now();
  const phoneGrant = smsPhoneQuota.get(phone);
  if (phoneGrant && now - phoneGrant.lastSent < 60 * 1000) {
    const wait = Math.ceil((60 * 1000 - (now - phoneGrant.lastSent)) / 1000);
    throw Object.assign(new Error(`请等待 ${wait} 秒后重试`), { status: 429 });
  }
  if (phoneGrant && now - phoneGrant.windowStart < 24 * 60 * 60 * 1000 && phoneGrant.count >= 10) {
    throw Object.assign(new Error('今日验证码发送次数已达上限'), { status: 429 });
  }
  const ipGrant = smsIpQuota.get(ip);
  if (ipGrant && now - ipGrant.windowStart < 60 * 60 * 1000 && ipGrant.count >= 20) {
    throw Object.assign(new Error('操作过于频繁，请稍后再试'), { status: 429 });
  }
}

function recordSmsSend(phone, ip) {
  const now = Date.now();
  const phoneGrant = smsPhoneQuota.get(phone);
  smsPhoneQuota.set(phone, !phoneGrant || now - phoneGrant.windowStart >= 24 * 60 * 60 * 1000
    ? { lastSent: now, windowStart: now, count: 1 }
    : { ...phoneGrant, lastSent: now, count: phoneGrant.count + 1 });
  const ipGrant = smsIpQuota.get(ip);
  smsIpQuota.set(ip, !ipGrant || now - ipGrant.windowStart >= 60 * 60 * 1000
    ? { windowStart: now, count: 1 }
    : { ...ipGrant, count: ipGrant.count + 1 });
}

async function sendSmsCode(phone, request) {
  const ip = requestIp(request);
  checkSmsQuota(phone, ip);
  const appId = process.env.BMOB_APP_ID;
  const restKey = process.env.BMOB_REST_KEY;
  if (!appId || !restKey) {
    const code = String(Math.floor(100000 + Math.random() * 900000));
    localSmsCodes.set(phone, { code, expiresAt: Date.now() + 5 * 60 * 1000 });
    recordSmsSend(phone, ip);
    return { ok: true, mockCode: code, expiresInSeconds: 300 };
  }
  const response = await fetch('https://api.bmobcloud.com/1/requestSmsCode', {
    method: 'POST',
    headers: { 'X-Bmob-Application-Id': appId, 'X-Bmob-REST-API-Key': restKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ mobilePhoneNumber: phone }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(payload.error || '发送短信失败'), { status: 400 });
  recordSmsSend(phone, ip);
  return { ok: true, smsId: payload.smsId, expiresInSeconds: 300 };
}

async function verifySmsCode(phone, code) {
  const appId = process.env.BMOB_APP_ID;
  const restKey = process.env.BMOB_REST_KEY;
  if (!appId || !restKey) {
    const stored = localSmsCodes.get(phone);
    if (!stored || stored.expiresAt <= Date.now() || !safeEqual(stored.code, code)) return false;
    localSmsCodes.delete(phone);
    return true;
  }
  const response = await fetch(`https://api.bmobcloud.com/1/verifySmsCode/${encodeURIComponent(String(code))}`, {
    method: 'POST',
    headers: { 'X-Bmob-Application-Id': appId, 'X-Bmob-REST-API-Key': restKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ mobilePhoneNumber: phone }),
  });
  return response.ok;
}

function organizationFor(user) {
  if (!user.enterprise_id) return null;
  return testDb.prepare('SELECT id, name, status, valid_until FROM organizations WHERE id = ?').get(user.enterprise_id) || null;
}

function publicUser(user) {
  const organization = organizationFor(user);
  return {
    id: user.id,
    phone: user.phone,
    username: user.username,
    name: user.guardian_name || user.real_name || user.username || '守望师',
    guardian_name: user.guardian_name,
    real_name: user.real_name,
    role: user.role,
    watcher_level: user.watcher_level,
    enterprise_id: user.enterprise_id,
    organization_name: organization?.name || 'AI 5000天',
    valid_until: user.valid_until,
  };
}

function restoreAuthGrant(token) {
  const row = testDb.prepare(`
    SELECT us.user_id, us.created_at, u.role, u.enterprise_id
    FROM user_sessions us
    JOIN users u ON u.id = us.user_id
    WHERE us.jti = ?
  `).get(token);
  const expiresAt = Number(row?.created_at || 0) + 12 * 60 * 60 * 1000;
  if (!row || expiresAt <= Date.now()) {
    if (row) testDb.prepare('DELETE FROM user_sessions WHERE jti = ?').run(token);
    return null;
  }
  const grant = {
    userId: row.user_id,
    role: row.role,
    enterpriseId: row.enterprise_id,
    clientInstance: null,
    expiresAt,
  };
  testAuthTokens.set(token, grant);
  return grant;
}

function revokeUserTokens(userId) {
  for (const [token, grant] of testAuthTokens) {
    if (Number(grant.userId) === Number(userId)) testAuthTokens.delete(token);
  }
  testDb.prepare('DELETE FROM user_sessions WHERE user_id = ?').run(userId);
}

function ownedFile(request, table, id) {
  const auth = requireTestAuth(request);
  const row = testDb.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(Number(id));
  if (!row) throw Object.assign(new Error('文件不存在'), { status: 404 });
  if (Number(row.user_id) !== Number(auth.userId)) throw Object.assign(new Error('无权访问该文件'), { status: 403 });
  return row;
}

function ownedTicket(request, id) {
  const auth = requireTestAuth(request);
  const ticket = testDb.prepare(`
    SELECT t.*, COUNT(m.id) AS message_count,
      (SELECT content FROM support_ticket_messages WHERE ticket_id = t.id ORDER BY created_at DESC, id DESC LIMIT 1) AS last_message
    FROM support_tickets t LEFT JOIN support_ticket_messages m ON m.ticket_id = t.id
    WHERE t.id = ? AND t.user_id = ? GROUP BY t.id
  `).get(Number(id), auth.userId);
  if (!ticket) throw Object.assign(new Error('工单不存在或无权查看'), { status: 404 });
  return { auth, ticket };
}

function publicTicket(ticket, messages = undefined) {
  return {
    id: Number(ticket.id),
    sessionId: ticket.session_id == null ? null : Number(ticket.session_id),
    category: ticket.category,
    subject: ticket.subject || String(ticket.content || '').slice(0, 36),
    priority: ticket.priority || 'normal',
    status: ticket.status || 'open',
    content: ticket.content,
    context: parseJson(ticket.context_json, {}),
    messageCount: Number(ticket.message_count) || (messages?.length || 0),
    lastMessage: ticket.last_message || messages?.at(-1)?.content || ticket.content,
    createdAt: ticket.created_at,
    updatedAt: ticket.updated_at || ticket.created_at,
    lastReplyAt: ticket.last_reply_at || ticket.created_at,
    ...(messages ? { messages } : {}),
  };
}

function requireTestAuth(request) {
  const authorization = String(request.headers.authorization || '');
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  const grant = testAuthTokens.get(token) || (token ? restoreAuthGrant(token) : null);
  if (!grant || grant.expiresAt <= Date.now()) {
    if (token) testAuthTokens.delete(token);
    throw Object.assign(new Error('测试登录已失效，请重新登录'), { status: 401 });
  }
  if (grant.clientInstance && grant.clientInstance !== request.headers['x-wqt-client']) {
    throw Object.assign(new Error('测试账号登录设备不一致'), { status: 403 });
  }
  return grant;
}

function canAccessActivity(user, activity) {
  if (['boss', 'operator'].includes(user.role)) return true;
  if (user.enterprise_id) return Number(activity.enterprise_id) === Number(user.enterprise_id);
  return activity.enterprise_id == null;
}

function activityConfig(activity) {
  const preset = testDb.prepare('SELECT * FROM activity_game_presets WHERE activity_id = ?').get(activity.id);
  let phaseTargets = [5, 3, 4];
  let cardGroupIds = [];
  try { phaseTargets = JSON.parse(preset?.phase_targets_json || '[5,3,4]'); } catch { /* use default */ }
  try { cardGroupIds = JSON.parse(preset?.card_group_ids_json || '[]'); } catch { /* use default */ }
  return {
    id: activity.id,
    code: activity.activity_code,
    name: activity.name,
    organizer: activity.organizer,
    status: activity.status,
    startsAt: activity.started_at,
    endsAt: activity.ended_at,
    location: activity.location,
    coordinates: activity.latitude != null && activity.longitude != null ? { latitude: activity.latitude, longitude: activity.longitude } : null,
    deckVersion: preset?.deck_version || '2026 版',
    mode: preset?.game_mode || '标准成长模式',
    duration: Number(preset?.duration) || 5000,
    phaseTargets,
    cardGroupIds,
  };
}

function availableActivities(user) {
  return testDb.prepare(`SELECT * FROM activities WHERE status = 'active' ORDER BY created_at DESC`)
    .all()
    .filter((activity) => canAccessActivity(user, activity))
    .map(activityConfig);
}

function resolveAvailableActivity(user, code) {
  const activity = testDb.prepare(`SELECT * FROM activities WHERE status = 'active' AND upper(activity_code) = upper(?)`).get(String(code || '').trim());
  if (!activity || !canAccessActivity(user, activity)) throw Object.assign(new Error('没有找到可用的活动码'), { status: 404 });
  return activityConfig(activity);
}

function persistGameEvent(session, type, payload = {}) {
  if (!['card_choice', 'skill_used', 'game_start', 'game_end'].includes(type)) return;
  testDb.prepare('INSERT INTO game_events(session_id, ts, type, payload) VALUES (?, ?, ?, ?)')
    .run(session.id, Date.now(), type, JSON.stringify(payload));
}

function parseJson(value, fallback = {}) {
  try { return JSON.parse(value || ''); } catch { return fallback; }
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function fallbackReview(sessionRow, cardEvents) {
  const safetyTypes = [...new Set(cardEvents.map((event) => event.safetyType).filter(Boolean))];
  const choices = cardEvents.map((event) => event.choice).filter(Boolean);
  const activeChoices = choices.filter((choice) => ['A', 'C', 'D'].includes(choice)).length;
  return {
    headline: '小伍的本轮数智成长报告',
    summary: `本轮完成 ${cardEvents.length} 张卡牌，在真实情境中练习了暂停、核实和表达。`,
    insight: activeChoices >= Math.ceil(cardEvents.length / 2)
      ? '面对不确定信息时，你已经多次表现出主动核实和保护边界的意识。'
      : '面对复杂情境时，你愿意继续尝试；下一轮可以先暂停，再向可信的人核实。',
    strengths: ['愿意完成情境判断', '能够比较不同选项的后果', choices.includes('D') ? '能创造自己的行动方案' : '能在已有方案中作出选择'],
    risks: safetyTypes.length ? safetyTypes.map((item) => `继续留意${item}场景中的异常信号`).slice(0, 3) : ['继续练习识别异常信号'],
    actions: ['遇到催促时先停十秒', '通过熟悉的渠道再次核实', '把不确定的情况告诉可信的大人'],
    score: Number(sessionRow.final_score) || 0,
    cardsReviewed: cardEvents.length,
  };
}

function normalizeReview(raw, fallback) {
  return {
    headline: String(raw?.headline || fallback.headline).slice(0, 60),
    summary: String(raw?.summary || fallback.summary).slice(0, 500),
    insight: String(raw?.insight || fallback.insight).slice(0, 800),
    strengths: Array.isArray(raw?.strengths) ? raw.strengths.map(String).slice(0, 4) : fallback.strengths,
    risks: Array.isArray(raw?.risks) ? raw.risks.map(String).slice(0, 4) : fallback.risks,
    actions: Array.isArray(raw?.actions) ? raw.actions.map(String).slice(0, 4) : fallback.actions,
    score: fallback.score,
    cardsReviewed: fallback.cardsReviewed,
  };
}

function fallbackCreativeFeedback(card, customText) {
  const action = String(customText || '').trim();
  return {
    consequence: `小伍把你的新办法“${action}”放回这个真实情境里检查了一遍。它没有照搬 A、B、C，而是提出了一条新路径；接下来还要确认这个办法是否安全、具体，以及能否获得可信任大人的支持。`,
    reason: [
      '安全力0：自定义办法需要结合当前场景继续核对风险，不额外自动加分。',
      '脑波力0：已经提出新思路，但还需要检查其中的判断依据。',
      '实感力0：这条方案是否照顾当事人的身体和情绪信号，需在行动中继续验证。',
      '创心力0：发动技能时的创心力 +1 已单独记录，选项 D 不重复加分。',
      '沟通力0：是否形成清楚、负责任的表达，要结合实际执行判断。',
    ].join('\n'),
    provider: 'local-structured-fallback',
  };
}

function creativeExamples(session, currentCard) {
  return session.cards
    .filter((card) => card.card_id !== currentCard.card_id && (card.phase === currentCard.phase || card.safety_type === currentCard.safety_type))
    .slice(0, 4)
    .map((card) => ({
      cardCode: cardCode(card),
      phase: card.phase,
      safetyType: card.safety_type,
      event: card.event,
      options: parseOptions(card),
    }));
}

async function generateCreativeFeedback(session, card, customText) {
  const fallback = fallbackCreativeFeedback(card, customText);
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) return fallback;
  const current = {
    cardCode: cardCode(card), phase: card.phase, safetyType: card.safety_type,
    event: card.event, guideText: card.guide_text || null, options: parseOptions(card), optionD: String(customText).trim(),
  };
  const prompt = [
    '你是儿童数智安全桌游《AI在5000天·伍力全开》的选项反馈审校员。',
    '玩家在当前卡牌提出了自定义选项 D。只依据结构化卡牌数据和选项 D 生成精确、温和、可执行的反馈，不得虚构新人物或脱离情境。',
    '仿照样例中 consequence 的叙事密度和 reason 的五维度拆解方式。技能的创心力 +1 已单独记录，D 本身不再计分，所以 reason 的每行分值必须写 0，但要真实评价五力表现。',
    '输出严格 JSON：{"consequence":"80-180字情境反馈","reason":"安全力0：...\\n脑波力0：...\\n实感力0：...\\n创心力0：...\\n沟通力0：..."}',
    `当前卡牌：${JSON.stringify(current)}`,
    `同时期/同安全类型结构化样例：${JSON.stringify(creativeExamples(session, card))}`,
  ].join('\n');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: process.env.DEEPSEEK_MODEL || 'deepseek-chat', messages: [{ role: 'user', content: prompt }], max_tokens: 1100, temperature: .25, response_format: { type: 'json_object' } }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`LLM ${response.status}`);
    const payload = await response.json();
    const content = payload?.choices?.[0]?.message?.content || '';
    const parsed = JSON.parse(content.slice(content.indexOf('{'), content.lastIndexOf('}') + 1));
    const consequence = String(parsed.consequence || '').trim().slice(0, 500);
    const reason = String(parsed.reason || '').trim().slice(0, 1200);
    if (!consequence || !reason || !POWER_NAMES.every((name) => reason.includes(name))) throw new Error('创心力反馈结构不完整');
    return { consequence, reason, provider: `DeepSeek · ${process.env.DEEPSEEK_MODEL || 'deepseek-chat'}` };
  } catch {
    return fallback;
  } finally {
    clearTimeout(timeout);
  }
}

async function generateReviewWithLlm(sessionRow, cardEvents) {
  const fallback = fallbackReview(sessionRow, cardEvents);
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) return { report: fallback, provider: 'local-fallback' };
  const prompt = [
    '你是儿童数智安全教育桌游《AI 5000天·伍力全开》的复盘分析师。只依据给出的真实游戏数据，不能虚构人物、情节或选择。',
    '请输出严格 JSON：{"headline":"标题","summary":"本轮概述","insight":"核心洞察","strengths":["优势"],"risks":["需要留意"],"actions":["下一步行动"]}。',
    '语气温暖、具体，适合家长和 6-12 岁孩子共同阅读。strengths、risks、actions 各 3 条。',
    `游戏数据：${JSON.stringify({ finalScore: sessionRow.final_score, attributes: parseJson(sessionRow.score_details_json, {}), cards: cardEvents })}`,
  ].join('\n');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45000);
  try {
    const response = await fetch(process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: process.env.DEEPSEEK_MODEL || 'deepseek-chat', messages: [{ role: 'user', content: prompt }], max_tokens: 1800, temperature: 0.4, response_format: { type: 'json_object' } }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`LLM ${response.status}`);
    const payload = await response.json();
    const content = payload?.choices?.[0]?.message?.content || '';
    const start = content.indexOf('{');
    const end = content.lastIndexOf('}');
    const parsed = start >= 0 && end > start ? JSON.parse(content.slice(start, end + 1)) : {};
    return { report: normalizeReview(parsed, fallback), provider: `DeepSeek · ${process.env.DEEPSEEK_MODEL || 'deepseek-chat'}` };
  } catch {
    return { report: fallback, provider: 'local-fallback' };
  } finally {
    clearTimeout(timeout);
  }
}

function reviewHtml(report, activityName, createdAt) {
  const list = (items) => items.map((item) => `<li>${escapeHtml(item)}</li>`).join('');
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${escapeHtml(report.headline)}</title><style>body{max-width:860px;margin:48px auto;padding:0 28px;background:#071326;color:#eaf4ff;font:16px/1.8 system-ui}h1{color:#61e5df}section{margin:22px 0;padding:20px;border:1px solid #24466d;background:#0c203e}small{color:#7e96b8}.score{font-size:52px;font-weight:900;color:#6ee8c2}</style></head><body><small>${escapeHtml(activityName)} · ${new Date(createdAt).toLocaleString('zh-CN')}</small><h1>${escapeHtml(report.headline)}</h1><p>${escapeHtml(report.summary)}</p><section><small>综合伍力得分率</small><div class="score">${escapeHtml(report.score)}%</div><p>${escapeHtml(report.insight)}</p></section><section><h2>本轮优势</h2><ul>${list(report.strengths)}</ul></section><section><h2>需要留意</h2><ul>${list(report.risks)}</ul></section><section><h2>下一步行动</h2><ul>${list(report.actions)}</ul></section></body></html>`;
}

async function createOrGetReview(session) {
  const existing = testDb.prepare('SELECT * FROM review_reports WHERE session_id = ? ORDER BY id DESC LIMIT 1').get(session.id);
  if (existing) return { id: existing.id, report: parseJson(existing.report_json, {}), provider: existing.provider, createdAt: existing.created_at, cached: true };
  const sessionRow = testDb.prepare('SELECT * FROM game_sessions WHERE id = ?').get(session.id);
  const events = testDb.prepare(`SELECT payload FROM game_events WHERE session_id = ? AND type = 'card_choice' ORDER BY ts`).all(session.id);
  const cardEvents = events.map((event) => parseJson(event.payload, {}));
  if (!cardEvents.length) throw Object.assign(new Error('至少完成 1 张卡牌后才能生成复盘报告'), { status: 422 });
  const { report, provider } = await generateReviewWithLlm(sessionRow, cardEvents);
  const createdAt = Date.now();
  const activity = testDb.prepare('SELECT name FROM activities WHERE id = ?').get(session.activityId);
  const html = reviewHtml(report, activity?.name || session.activityCode, createdAt);
  const inserted = testDb.prepare('INSERT INTO review_reports(session_id, user_id, created_at, provider, report_json, report_html) VALUES (?, ?, ?, ?, ?, ?)')
    .run(session.id, session.userId, createdAt, provider, JSON.stringify(report), html);
  return { id: Number(inserted.lastInsertRowid), report, provider, createdAt, cached: false };
}

function queueReview(session) {
  if (reviewJobs.has(session.id)) return reviewJobs.get(session.id);
  const job = createOrGetReview(session).finally(() => reviewJobs.delete(session.id));
  reviewJobs.set(session.id, job);
  return job;
}

function audit(session, request, type, payload = {}) {
  session.audit.push({
    ts: Date.now(),
    type,
    clientInstance: request.headers['x-wqt-client'] || null,
    ip: requestIp(request),
    userAgent: request.headers['user-agent'] || null,
    ...payload,
  });
  if (session.audit.length > 500) session.audit.shift();
}

function cardCode(card) {
  return String(card.card_code || card.card_id).toUpperCase();
}

function findCard(session, query, cardRef) {
  if (cardRef) {
    const releasedId = Number(String(cardRef).replace(/^released:/, ''));
    const referenced = session.cards.find((card) => Number(card.id) === releasedId);
    if (referenced) return referenced;
  }
  const term = String(query || '').trim().toUpperCase();
  const exactMatches = session.cards.filter((card) => cardCode(card) === term);
  if (exactMatches.length > 1) throw Object.assign(new Error('编号在多套卡组中重复，请使用带卡牌组前缀的编号'), { status: 409 });
  if (exactMatches[0]) return exactMatches[0];
  const shortMatches = session.cards.filter((card) => shortCode(card).toUpperCase() === term);
  if (shortMatches.length > 1) throw Object.assign(new Error('短编号对应多套卡组，请输入带卡牌组前缀的完整编号'), { status: 409 });
  return shortMatches[0];
}

function publicSuggestion(card) {
  return {
    cardRef: `released:${card.id}`,
    code: cardCode(card),
    shortCode: shortCode(card),
    title: card.title || `${card.safety_type}情境卡`,
    phase: card.phase,
    type: card.safety_type,
    groupIds: card.group_ids,
    groupNames: card.group_names,
  };
}

function phaseRemaining(session, phase) {
  const target = Math.max(0, Number(session.cardsPerPhase[phase]) || 0);
  const completed = Math.max(0, Number(session.phaseProgress[phase]) || 0);
  return Math.max(0, target - completed);
}

function cardIsAvailable(session, card) {
  return !session.answeredCardIds.has(card.card_id) && phaseRemaining(session, card.phase) > 0;
}

function playableCard(card, grantId) {
  const options = parseOptions(card);
  return {
    id: card.card_id,
    grantId,
    code: cardCode(card),
    shortCode: shortCode(card),
    phase: card.phase,
    type: card.safety_type,
    title: card.title || `${card.safety_type}情境卡`,
    text: card.event,
    audioUrl: card.audio_url || null,
    guideText: card.guide_text || null,
    groupIds: card.group_ids,
    groupNames: card.group_names,
    options: Object.fromEntries(Object.entries(options).map(([key, option]) => [key, { text: option.text }])),
  };
}

export async function requestHandler(request, response) {
  try {
    if (request.method === 'OPTIONS') return json(response, 204, {});
    const url = new URL(request.url, `http://${request.headers.host}`);
    if (request.method === 'GET' && url.pathname === '/health') return json(response, 200, {
      ok: true,
      source: dbPath,
      sessions: sessions.size,
      tts: {
        provider: 'volcengine',
        configured: Boolean(ttsApiKey),
        voiceName: ttsVoiceName,
        voiceType: ttsVoiceType,
        resourceId: ttsResourceId,
      },
    });
    if (request.method === 'POST' && url.pathname === '/api/test-auth/human/start') {
      return json(response, 200, { challengeId: issueHumanChallenge(request), holdForMs: 900 });
    }
    if (request.method === 'POST' && url.pathname === '/api/test-auth/human/verify') {
      const body = await readBody(request);
      return json(response, 200, { proof: verifyHumanChallenge(request, body.challengeId), expiresInSeconds: 600 });
    }
    if (request.method === 'POST' && url.pathname === '/api/test-auth/sms/send') {
      const body = await readBody(request);
      const phone = String(body.phone || '').trim();
      requireHumanProof(request, body.humanProof);
      if (!/^1\d{10}$/.test(phone)) return json(response, 400, { error: '请输入正确的手机号' });
      const user = testDb.prepare('SELECT id FROM users WHERE phone = ?').get(phone);
      if (!user) return json(response, 404, { error: '该手机号不在测试账号名单中' });
      return json(response, 200, await sendSmsCode(phone, request));
    }
    if (request.method === 'POST' && url.pathname === '/api/test-auth/login') {
      const body = await readBody(request);
      const phone = String(body.phone || '').trim();
      const user = testDb.prepare('SELECT * FROM users WHERE phone = ?').get(phone);
      if (!user) return json(response, 401, { error: '测试账号不存在' });
      requireHumanProof(request, body.humanProof, { consume: true });
      const loginMethod = body.loginMethod === 'code' ? 'code' : 'password';
      const authenticated = loginMethod === 'code'
        ? await verifySmsCode(phone, String(body.code || '').trim())
        : verifyTestPassword(body.password, user.password_hash);
      if (!authenticated) return json(response, 401, { error: loginMethod === 'code' ? '验证码错误或已过期' : '测试账号或密码错误' });
      revokeUserTokens(user.id);
      const token = randomUUID();
      const now = Date.now();
      testAuthTokens.set(token, {
        userId: user.id,
        role: user.role,
        enterpriseId: user.enterprise_id,
        clientInstance: request.headers['x-wqt-client'] || null,
        expiresAt: now + 12 * 60 * 60 * 1000,
      });
      testDb.prepare('INSERT INTO user_sessions(user_id, jti, device_info, ip, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(user.id, token, request.headers['user-agent'] || null, requestIp(request), now, now);
      return json(response, 200, { token, user: publicUser(user) });
    }
    if (request.method === 'GET' && url.pathname === '/api/me') {
      const auth = requireTestAuth(request);
      const user = testDb.prepare('SELECT * FROM users WHERE id = ?').get(auth.userId);
      return json(response, 200, { user: publicUser(user) });
    }
    if (request.method === 'PUT' && url.pathname === '/api/me/profile') {
      const auth = requireTestAuth(request);
      const body = await readBody(request);
      const guardianName = String(body.guardianName || '').trim().slice(0, 30);
      const realName = String(body.realName || '').trim().slice(0, 30);
      if (!guardianName) return json(response, 400, { error: '守望师名不能为空' });
      testDb.prepare('UPDATE users SET guardian_name = ?, real_name = ?, is_profile_complete = 1 WHERE id = ?')
        .run(guardianName, realName || null, auth.userId);
      const user = testDb.prepare('SELECT * FROM users WHERE id = ?').get(auth.userId);
      return json(response, 200, { user: publicUser(user) });
    }
    if (request.method === 'PUT' && url.pathname === '/api/me/password') {
      const auth = requireTestAuth(request);
      const body = await readBody(request);
      const user = testDb.prepare('SELECT * FROM users WHERE id = ?').get(auth.userId);
      if (!verifyTestPassword(body.currentPassword, user.password_hash)) return json(response, 401, { error: '当前密码错误' });
      if (String(body.newPassword || '').length < 6) return json(response, 400, { error: '新密码至少 6 位' });
      testDb.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashTestPassword(body.newPassword), user.id);
      return json(response, 200, { ok: true });
    }
    if (request.method === 'GET' && url.pathname === '/api/me/devices') {
      const auth = requireTestAuth(request);
      const devices = testDb.prepare('SELECT id, device_info, ip, created_at, last_seen_at FROM user_sessions WHERE user_id = ? ORDER BY last_seen_at DESC').all(auth.userId);
      return json(response, 200, { devices });
    }
    if (request.method === 'GET' && url.pathname === '/api/me/files') {
      const auth = requireTestAuth(request);
      const recordings = testDb.prepare('SELECT id, session_id, file_name, mime_type, size_bytes, created_at FROM recordings WHERE user_id = ? ORDER BY created_at DESC').all(auth.userId)
        .map((item) => ({ ...item, kind: 'recording', downloadUrl: `/api/files/recording/${item.id}` }));
      const reviews = testDb.prepare('SELECT id, session_id, provider, created_at FROM review_reports WHERE user_id = ? ORDER BY created_at DESC').all(auth.userId)
        .map((item) => ({ ...item, kind: 'review', file_name: `伍力全开复盘-${item.session_id}.html`, downloadUrl: `/api/files/review/${item.id}` }));
      return json(response, 200, { files: [...reviews, ...recordings].sort((a, b) => b.created_at - a.created_at) });
    }
    if (request.method === 'POST' && url.pathname === '/api/me/feedback') {
      const auth = requireTestAuth(request);
      const body = await readBody(request);
      const content = String(body.content || '').trim().slice(0, 2000);
      if (!content) return json(response, 400, { error: '请填写反馈内容' });
      const result = testDb.prepare('INSERT INTO user_feedback(user_id, type, content, activity_id, session_id, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(auth.userId, String(body.type || 'reflection').slice(0, 30), content, body.activityId || null, body.sessionId || null, Date.now());
      return json(response, 200, { ok: true, id: Number(result.lastInsertRowid) });
    }
    if (request.method === 'GET' && url.pathname === '/api/support/tickets') {
      const auth = requireTestAuth(request);
      const tickets = testDb.prepare(`
        SELECT t.*, COUNT(m.id) AS message_count,
          (SELECT content FROM support_ticket_messages WHERE ticket_id = t.id ORDER BY created_at DESC, id DESC LIMIT 1) AS last_message
        FROM support_tickets t LEFT JOIN support_ticket_messages m ON m.ticket_id = t.id
        WHERE t.user_id = ? GROUP BY t.id ORDER BY COALESCE(t.updated_at, t.created_at) DESC, t.id DESC
      `).all(auth.userId).map((ticket) => publicTicket(ticket));
      return json(response, 200, { tickets });
    }
    if (request.method === 'POST' && url.pathname === '/api/support/tickets') {
      const auth = requireTestAuth(request);
      const body = await readBody(request);
      const content = String(body.content || '').trim().slice(0, 2000);
      const subject = String(body.subject || content).trim().slice(0, 60);
      const priority = ['low', 'normal', 'high'].includes(body.priority) ? body.priority : 'normal';
      if (!content) return json(response, 400, { error: '请描述需要协助的问题' });
      const createdAt = Date.now();
      const context = { ...(body.context || {}), userAgent: request.headers['user-agent'] || null, ip: requestIp(request) };
      testDb.exec('BEGIN');
      try {
        const result = testDb.prepare(`INSERT INTO support_tickets
          (user_id, session_id, category, subject, priority, content, context_json, status, created_at, updated_at, last_reply_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?)`)
          .run(auth.userId, body.sessionId || null, String(body.category || 'technical').slice(0, 30), subject, priority, content, JSON.stringify(context), createdAt, createdAt, createdAt);
        const ticketId = Number(result.lastInsertRowid);
        testDb.prepare('INSERT INTO support_ticket_messages(ticket_id, author_type, author_user_id, content, created_at) VALUES (?, ?, ?, ?, ?)')
          .run(ticketId, 'user', auth.userId, content, createdAt);
        testDb.exec('COMMIT');
        const { ticket } = ownedTicket(request, ticketId);
        return json(response, 200, { ok: true, ticketId, ticket: publicTicket(ticket) });
      } catch (error) {
        testDb.exec('ROLLBACK');
        throw error;
      }
    }
    const ticketDetailMatch = url.pathname.match(/^\/api\/support\/tickets\/(\d+)$/);
    if (request.method === 'GET' && ticketDetailMatch) {
      const { ticket } = ownedTicket(request, ticketDetailMatch[1]);
      const messages = testDb.prepare('SELECT id, author_type, content, created_at FROM support_ticket_messages WHERE ticket_id = ? ORDER BY created_at, id')
        .all(ticket.id).map((message) => ({ id: Number(message.id), authorType: message.author_type, content: message.content, createdAt: message.created_at }));
      if (!messages.length && ticket.content) messages.push({ id: 0, authorType: 'user', content: ticket.content, createdAt: ticket.created_at });
      return json(response, 200, { ticket: publicTicket(ticket, messages) });
    }
    const ticketReplyMatch = url.pathname.match(/^\/api\/support\/tickets\/(\d+)\/messages$/);
    if (request.method === 'POST' && ticketReplyMatch) {
      const { auth, ticket } = ownedTicket(request, ticketReplyMatch[1]);
      const body = await readBody(request);
      const content = String(body.content || '').trim().slice(0, 2000);
      if (!content) return json(response, 400, { error: '请填写追问内容' });
      const createdAt = Date.now();
      testDb.prepare('INSERT INTO support_ticket_messages(ticket_id, author_type, author_user_id, content, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(ticket.id, 'user', auth.userId, content, createdAt);
      testDb.prepare("UPDATE support_tickets SET status = CASE WHEN status IN ('resolved','closed') THEN 'open' ELSE status END, updated_at = ?, last_reply_at = ? WHERE id = ?")
        .run(createdAt, createdAt, ticket.id);
      const refreshed = ownedTicket(request, ticket.id).ticket;
      return json(response, 200, { ok: true, ticket: publicTicket(refreshed) });
    }
    if (request.method === 'POST' && url.pathname === '/api/test-auth/password-login-legacy') {
      const body = await readBody(request);
      const user = testDb.prepare('SELECT * FROM users WHERE phone = ?').get(String(body.phone || '').trim());
      if (!user || !verifyTestPassword(body.password, user.password_hash)) {
        return json(response, 401, { error: '测试账号或密码错误' });
      }
      const token = randomUUID();
      testAuthTokens.set(token, {
        userId: user.id,
        role: user.role,
        enterpriseId: user.enterprise_id,
        clientInstance: request.headers['x-wqt-client'] || null,
        expiresAt: Date.now() + 12 * 60 * 60 * 1000,
      });
      testDb.prepare('INSERT INTO user_sessions(user_id, jti, device_info, ip, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(user.id, token, request.headers['user-agent'] || null, requestIp(request), Date.now(), Date.now());
      return json(response, 200, {
        token,
        user: publicUser(user),
      });
    }
    if (request.method === 'POST' && url.pathname === '/api/game/recording') {
      const session = requireOwnedSession(url.searchParams.get('sessionId'), request);
      const mimeType = String(request.headers['content-type'] || 'audio/webm').split(';')[0].trim();
      if (!mimeType.startsWith('audio/')) return json(response, 415, { error: '只支持音频文件' });
      const audio = await readBinaryBody(request);
      if (audio.length < 128) return json(response, 400, { error: '录音内容为空' });
      const extension = mimeType.includes('mp4') ? 'm4a' : mimeType.includes('mpeg') ? 'mp3' : 'webm';
      const fileName = `session-${session.id}-${Date.now()}.${extension}`;
      const filePath = path.join(recordingDir, fileName);
      await writeFile(filePath, audio, { flag: 'wx' });
      const result = testDb.prepare('INSERT INTO recordings(user_id, session_id, file_name, mime_type, size_bytes, file_path, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(session.userId, session.id, fileName, mimeType, audio.length, filePath, Date.now());
      audit(session, request, 'recording_saved', { sizeBytes: audio.length, mimeType });
      return json(response, 200, { ok: true, recording: { id: Number(result.lastInsertRowid), fileName, mimeType, sizeBytes: audio.length } });
    }
    if (request.method === 'POST' && url.pathname === '/api/game/review') {
      const body = await readBody(request);
      const session = requireOwnedSession(body.sessionId, request);
      if (!session.endedAt) return json(response, 409, { error: '请先结束本局，再生成复盘报告' });
      const result = await queueReview(session);
      return json(response, 200, { ...result, downloadUrl: `/api/files/review/${result.id}` });
    }
    const recordingMatch = request.method === 'GET' && url.pathname.match(/^\/api\/files\/recording\/(\d+)$/);
    if (recordingMatch) {
      const row = ownedFile(request, 'recordings', recordingMatch[1]);
      const info = await stat(row.file_path).catch(() => null);
      if (!info) return json(response, 404, { error: '录音文件已丢失' });
      response.writeHead(200, {
        'Content-Type': row.mime_type,
        'Content-Length': info.size,
        'Content-Disposition': `inline; filename="${path.basename(row.file_name)}"`,
        'Cache-Control': 'private, no-store',
      });
      createReadStream(row.file_path).pipe(response);
      return;
    }
    const reviewMatch = request.method === 'GET' && url.pathname.match(/^\/api\/files\/review\/(\d+)$/);
    if (reviewMatch) {
      const row = ownedFile(request, 'review_reports', reviewMatch[1]);
      const html = Buffer.from(row.report_html, 'utf8');
      response.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Length': html.length,
        'Content-Disposition': `attachment; filename="wqt-review-${row.session_id}.html"`,
        'Cache-Control': 'private, no-store',
      });
      response.end(html);
      return;
    }
    if (request.method === 'GET' && url.pathname === '/api/activities/available') {
      const auth = requireTestAuth(request);
      const user = testDb.prepare('SELECT * FROM users WHERE id = ?').get(auth.userId);
      return json(response, 200, { activities: availableActivities(user) });
    }
    if (request.method === 'GET' && url.pathname === '/api/activities/resolve') {
      const auth = requireTestAuth(request);
      const user = testDb.prepare('SELECT * FROM users WHERE id = ?').get(auth.userId);
      return json(response, 200, { activity: resolveAvailableActivity(user, url.searchParams.get('code')) });
    }
    if (request.method === 'GET' && url.pathname === '/api/game/card/audio') {
      const token = url.searchParams.get('token');
      const grant = audioTokens.get(token);
      if (!grant || grant.expiresAt <= Date.now()) return json(response, 404, { error: '语音地址已失效' });
      return await streamAudio(request, response, grant);
    }

    if (request.method === 'POST' && url.pathname === '/api/game/start') {
      const auth = requireTestAuth(request);
      const body = await readBody(request);
      const user = testDb.prepare('SELECT * FROM users WHERE id = ?').get(auth.userId);
      const activity = resolveAvailableActivity(user, body.activityCode);
      const groups = selectGroups(body.settings?.deckVersion, body.cardGroupIds);
      if (!groups.length) return json(response, 404, { error: '没有可用的发布卡牌组' });
      const cards = cardsForGroups(groups);
      const maxScores = calculateMaxScores(cards);
      const startedAt = Date.now();
      const sessionPayload = {
        activityCode: activity.code,
        activityId: activity.id,
        cardGroupIds: groups.map((group) => group.id),
        phaseProgress: { 启蒙期: 0, 成长期: 0, 青春期: 0 },
      };
      const inserted = testDb.prepare(`INSERT INTO game_sessions
        (user_id, started_at, payload_json, game_mode, game_settings_json, status, card_group_id)
        VALUES (?, ?, ?, ?, ?, 'active', ?)`)
        .run(user.id, startedAt, JSON.stringify(sessionPayload), body.mode || activity.mode, JSON.stringify(body.settings || {}), groups[0]?.id || null);
      const sessionId = String(inserted.lastInsertRowid);
      sessions.set(sessionId, {
        id: sessionId,
        userId: user.id,
        activityId: activity.id,
        activityCode: activity.code,
        groupIds: groups.map((group) => group.id),
        cards,
        maxScores,
        answeredCardIds: new Set(),
        pendingGrant: null,
        cardGrants: new Map(),
        feedbackGrants: new Map(),
        phaseProgress: { 启蒙期: 0, 成长期: 0, 青春期: 0 },
        cardsPerPhase: body.settings?.cardsPerPhase || {},
        startedAt,
        endedAt: null,
        clientInstance: request.headers['x-wqt-client'] || null,
        audit: [],
      });
      audit(sessions.get(sessionId), request, 'game_start', { activityCode: activity.code, groupIds: groups.map((group) => group.id) });
      persistGameEvent(sessions.get(sessionId), 'game_start', { activityCode: activity.code, groupIds: groups.map((group) => group.id), clientInstance: request.headers['x-wqt-client'] || null });
      const cardGroups = groups.map((group) => ({ id: group.id, name: group.name, count: rowsForGroup(group).length, maxScores: parseJson(group.max_scores_json, {}) }));
      return json(response, 200, {
        sessionId,
        cardGroups,
        maxScores,
        totalCardCount: cards.length,
      });
    }

    if (request.method === 'GET' && url.pathname === '/api/game/card/suggest') {
      const session = requireSession(url.searchParams.get('sessionId'), request);
      const term = String(url.searchParams.get('q') || '').trim().toUpperCase().slice(0, 24);
      if (!term) return json(response, 200, { suggestions: [] });
      const suggestions = session.cards
        .filter((card) => cardIsAvailable(session, card))
        .filter((card) => cardCode(card).includes(term) || shortCode(card).toUpperCase().includes(term))
        .slice(0, 6)
        .map(publicSuggestion);
      audit(session, request, 'card_suggest', { query: term, resultCount: suggestions.length });
      return json(response, 200, { suggestions });
    }

    if (request.method === 'GET' && url.pathname === '/api/game/card/options') {
      const session = requireSession(url.searchParams.get('sessionId'), request);
      const phase = String(url.searchParams.get('phase') || '').trim();
      const safetyType = String(url.searchParams.get('safetyType') || '').trim();
      const phaseCards = session.cards.filter((card) => card.phase === phase && cardIsAvailable(session, card));
      const counts = new Map();
      for (const card of phaseCards) counts.set(card.safety_type, (counts.get(card.safety_type) || 0) + 1);
      const safetyTypes = [...counts.entries()].map(([name, count]) => ({ name, count }));
      const cards = safetyType
        ? phaseCards.filter((card) => card.safety_type === safetyType).map(publicSuggestion)
        : [];
      audit(session, request, 'card_options', { phase, safetyType: safetyType || null, resultCount: cards.length });
      return json(response, 200, { phase, remaining: phaseRemaining(session, phase), safetyTypes, cards });
    }

    if (request.method === 'POST' && url.pathname === '/api/game/card/resolve') {
      const body = await readBody(request);
      const session = requireSession(body.sessionId, request);
      const card = findCard(session, body.cardCode, body.cardRef);
      if (!card || !cardIsAvailable(session, card)) return json(response, 404, { error: '本局没有这张可作答卡牌，或该时期已经完成' });
      const grantId = randomUUID();
      session.pendingGrant = { grantId, cardId: card.card_id, issuedAt: Date.now() };
      session.cardGrants.set(grantId, { cardId: card.card_id, issuedAt: Date.now() });
      audit(session, request, 'card_resolve', { cardId: card.card_id, cardCode: cardCode(card), grantId });
      if (!card.audio_url) void ensureCardAudio(card).catch(() => {});
      return json(response, 200, { card: playableCard(card, grantId) });
    }

    if (request.method === 'POST' && url.pathname === '/api/game/card/tts') {
      const body = await readBody(request);
      const session = requireSession(body.sessionId, request);
      const cardGrant = session.cardGrants.get(body.grantId);
      if (!cardGrant) return json(response, 404, { error: '卡牌语音授权不存在' });
      const card = session.cards.find((item) => item.card_id === cardGrant.cardId);
      if (!card) return json(response, 404, { error: '卡牌不存在' });
      const audio = await ensureCardAudio(card);
      audit(session, request, 'card_tts_ready', {
        cardId: card.card_id,
        cardCode: cardCode(card),
        source: audio.source,
        cache: audio.cache,
        voiceType: audio.voiceType || null,
      });
      if (audio.source === 'published') return json(response, 200, { status: 'ready', source: audio.source, cache: audio.cache, audioUrl: audio.audioUrl });
      const token = issueAudioToken(session, audio.audioPath);
      return json(response, 200, { status: 'ready', source: audio.source, cache: audio.cache, audioUrl: `/api/game/card/audio?token=${encodeURIComponent(token)}` });
    }

    if (request.method === 'POST' && url.pathname === '/api/game/feedback/tts') {
      const body = await readBody(request);
      const session = requireSession(body.sessionId, request);
      const grant = session.feedbackGrants.get(String(body.feedbackGrantId || ''));
      if (!grant || Date.now() - grant.issuedAt > 30 * 60 * 1000) return json(response, 404, { error: '反馈语音授权不存在或已失效' });
      const audio = await ensureGeneratedAudio(grant.text, 'feedback');
      audit(session, request, 'feedback_tts_ready', { cardCode: grant.cardCode, cache: audio.cache, voiceType: audio.voiceType || null });
      const token = issueAudioToken(session, audio.audioPath);
      return json(response, 200, { status: 'ready', source: audio.source, cache: audio.cache, audioUrl: `/api/game/card/audio?token=${encodeURIComponent(token)}` });
    }

    if (request.method === 'POST' && url.pathname === '/api/game/card/answer') {
      const body = await readBody(request);
      const session = requireSession(body.sessionId, request);
      const grant = session.pendingGrant;
      if (!grant || grant.grantId !== body.grantId) return json(response, 409, { error: '卡牌授权已失效，请重新调取' });
      if (Date.now() - grant.issuedAt > 30 * 60 * 1000) return json(response, 410, { error: '卡牌停留时间过长，请重新调取' });
      const card = session.cards.find((item) => item.card_id === grant.cardId);
      if (!card || session.answeredCardIds.has(card.card_id)) return json(response, 409, { error: '该卡牌已经完成作答' });

      const choice = String(body.choice || '').toUpperCase();
      const option = parseOptions(card)[choice];
      if (choice !== 'D' && !option) return json(response, 400, { error: '选项不存在' });
      if (choice === 'D' && !String(body.customText || '').trim()) return json(response, 400, { error: '选项 D 不能为空' });

      const target = Math.max(0, Number(session.cardsPerPhase[card.phase]) || 0);
      const before = session.phaseProgress[card.phase] || 0;
      const after = Math.min(target, before + 1);
      session.phaseProgress[card.phase] = after;
      const creativeFeedback = choice === 'D' ? await generateCreativeFeedback(session, card, body.customText) : null;
      const consequence = creativeFeedback?.consequence || option.consequence;
      const reason = creativeFeedback?.reason || option.reason || '本选项暂无伍力理由。';
      const feedbackGrantId = randomUUID();
      session.feedbackGrants.set(feedbackGrantId, { text: consequence, cardCode: cardCode(card), issuedAt: Date.now() });
      session.answeredCardIds.add(card.card_id);
      session.pendingGrant = null;
      audit(session, request, 'card_answer', { cardId: card.card_id, cardCode: cardCode(card), choice, grantId: grant.grantId });
      persistGameEvent(session, 'card_choice', {
        cardId: card.card_id,
        cardCode: cardCode(card),
        phase: card.phase,
        safetyType: card.safety_type,
        title: card.title || `${card.safety_type}情境卡`,
        eventText: card.event,
        choice,
        optionText: choice === 'D' ? String(body.customText).trim() : option.text,
        consequence,
        powerReason: reason,
        feedbackProvider: creativeFeedback?.provider || null,
        attributeDelta: choice === 'D' ? {} : (option.attributeEffects || {}),
        isCreativeOption: choice === 'D',
        customText: choice === 'D' ? String(body.customText).trim() : null,
        clientInstance: request.headers['x-wqt-client'] || null,
      });

      return json(response, 200, {
        cardCode: cardCode(card),
        choice,
        consequence,
        reason,
        feedbackProvider: creativeFeedback?.provider || null,
        feedbackGrantId,
        attributeEffects: choice === 'D' ? {} : (option.attributeEffects || {}),
        phase: card.phase,
        phaseProgress: session.phaseProgress,
        phaseCompleted: target > 0 && before < target && after >= target,
      });
    }

    if (request.method === 'POST' && url.pathname === '/api/game/finish') {
      const body = await readBody(request);
      const session = requireOwnedSession(body.sessionId, request);
      if (session.endedAt) return json(response, 200, { ok: true, sessionId: session.id, phaseProgress: session.phaseProgress, alreadyFinished: true });
      const { finalScore, scoreDetails } = calculatePowerScore(body.attributes || {}, session.maxScores || {});
      audit(session, request, 'game_finish', { finalScore, clientFinalScore: body.finalScore, scoreFormula: 'average-dimension-rate' });
      persistGameEvent(session, 'game_end', { finalScore, attributes: body.attributes || null, scoreDetails, scoreFormula: 'average-dimension-rate' });
      session.endedAt = Date.now();
      testDb.prepare(`UPDATE game_sessions SET ended_at = ?, final_score = ?, payload_json = ?, score_details_json = ?, status = 'completed' WHERE id = ?`)
        .run(session.endedAt, finalScore, JSON.stringify(body.payload || {}), JSON.stringify(scoreDetails), session.id);
      return json(response, 200, { ok: true, sessionId: session.id, finalScore, scoreDetails, phaseProgress: session.phaseProgress });
    }

    if (request.method === 'POST' && url.pathname === '/api/game/event') {
      const body = await readBody(request);
      const session = requireSession(body.sessionId, request);
      if (body.type !== 'skill_used') return json(response, 400, { error: '测试环境只接受已定义的游戏事件' });
      const payload = { ...(body.payload || {}), clientInstance: request.headers['x-wqt-client'] || null };
      audit(session, request, body.type, payload);
      persistGameEvent(session, body.type, payload);
      return json(response, 200, { ok: true });
    }

    return json(response, 404, { error: 'Not found' });
  } catch (error) {
    return json(response, error.status || 500, { error: error.message });
  }
}

export default requestHandler;

if (!isVercel && process.env.WQT_EMBEDDED_API !== 'true') {
  const server = createServer(requestHandler);
  server.listen(port, '127.0.0.1', () => {
    console.log(`Session-scoped card API: http://127.0.0.1:${port}`);
    console.log(`Read-only database: ${dbPath}`);
    console.log(`Test data database: ${testDbPath}`);
  });
}
