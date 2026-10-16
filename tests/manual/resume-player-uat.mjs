// Resume an existing owned local UAT database. Shutdown preserves DB, Redis and OSS.
// Example: WQT_TEST_PG_ADMIN_URL and WQT_TEST_REDIS_URL must identify the dedicated
// local test services; --database is always explicit. Live integrations are opt-in.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { sanitizedChildEnv } from '../helpers/runtime-test-env.mjs';

const ownedName = /^wqt_r1_[a-f0-9]{20}$/;
const loopback = new Set(['127.0.0.1', 'localhost', '[::1]']);

function parseOptions(args) {
  const options = { port: 8188 };
  const flags = new Set(['--child', '--reviewer', '--live-captcha', '--live-oss', '--live-ai', '--live-sms']);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--database' || arg === '--port') {
      if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error('Missing option value');
      const key = arg.slice(2);
      if (Object.hasOwn(options, key) && key !== 'port') throw new Error('Duplicate option');
      options[key] = args[++i];
    } else if (flags.has(arg)) options[arg.slice(2)] = true;
    else throw new Error('Unknown resume option');
  }
  if (!ownedName.test(options.database || '')) throw new Error('Explicit owned UAT --database required');
  options.port = Number(options.port);
  if (!Number.isInteger(options.port) || options.port < 1024 || options.port > 65535) throw new Error('Invalid local UAT port');
  return options;
}

function localService(value, kind) {
  let url;
  try { url = new URL(value); } catch { throw new Error('Explicit local test service configuration required'); }
  const protocol = kind === 'pg' ? ['postgres:', 'postgresql:'] : ['redis:'];
  const port = kind === 'pg' ? '55447' : '56347';
  // These are the dedicated WQT UAT Docker ports, not developer/business services.
  if (!protocol.includes(url.protocol) || !loopback.has(url.hostname) || url.port !== port || url.search || url.hash)
    throw new Error('Resume requires dedicated loopback UAT services');
  if (kind === 'redis' && !['', '/', '/0'].includes(url.pathname)) throw new Error('Unexpected test Redis database');
  return url;
}

async function verifyExistingDatabase(connectionString, database) {
  const { Client } = await import('pg');
  const client = new Client({ connectionString, connectionTimeoutMillis: 5000, query_timeout: 5000 });
  try {
    await client.connect();
    await client.query('BEGIN READ ONLY');
    const { rows: [row] } = await client.query("SELECT current_database() AS database, to_regclass('public.accounts') AS accounts, to_regclass('public.game_sessions') AS sessions, to_regclass('public.card_groups') AS card_groups");
    if (row.database !== database || !row.accounts || !row.sessions || !row.card_groups)
      throw new Error('Existing UAT schema required');
    await client.query('ROLLBACK');
  } finally { await client.end().catch(() => {}); }
}

function integrationEnvironment(options) {
  const external = {};
  if (!['reviewer', 'live-captcha', 'live-oss', 'live-ai', 'live-sms'].some(key => options[key])) return external;
  const local = dotenv.parse(readFileSync(new URL('../../.env', import.meta.url)));
  const copyRequired = keys => {
    for (const key of keys) {
      if (!local[key]) throw new Error('Requested local integration configuration incomplete');
      external[key] = local[key];
    }
  };
  // Reviewer credentials are retained in memory only; no provisioning or password reset.
  if (options.reviewer) copyRequired(['WQT_UAT_REVIEW_PHONE', 'WQT_UAT_REVIEW_PASSWORD']);
  if (options['live-sms']) copyRequired(['BMOB_APP_ID', 'BMOB_REST_KEY']);
  if (options['live-captcha']) {
    copyRequired(['CAPTCHA_APP_ID', 'CAPTCHA_APP_SECRET_KEY', 'TENCENT_SECRET_ID', 'TENCENT_SECRET_KEY']);
    external.CAPTCHA_ENABLED = 'true';
  }
  if (options['live-oss']) {
    copyRequired(['ALIBABA_CLOUD_ACCESS_KEY_ID', 'ALIBABA_CLOUD_ACCESS_KEY_SECRET', 'OSS_BUCKET_NAME']);
    for (const key of ['OSS_REGION', 'OSS_ENDPOINT']) if (local[key]) external[key] = local[key];
    if (!external.OSS_REGION && !external.OSS_ENDPOINT) throw new Error('Requested local integration configuration incomplete');
  }
  if (options['live-ai']) {
    for (const [key, value] of Object.entries(local))
      if (/^(DEEPSEEK|DASHSCOPE|OPENAI|GEMINI)_(API_KEY|BASE_URL|MODEL)$/.test(key)) external[key] = value;
    if (!external.DASHSCOPE_API_KEY) throw new Error('Requested local integration configuration incomplete');
    external.DEFAULT_LLM_PROVIDER = '阿里云 DashScope';
    external.DEFAULT_LLM_MODEL = 'qwen-plus';
  }
  return external;
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  if (options.child) {
    if (process.env.WQT_RUNTIME_TEST_CHILD !== '1' || process.env.WQT_REDIS_NAMESPACE !== options.database)
      throw new Error('Owned UAT child environment required');
    const pgUrl = localService(process.env.DATABASE_URL, 'pg');
    localService(process.env.REDIS_URL, 'redis');
    if (decodeURIComponent(pgUrl.pathname.slice(1)) !== options.database || process.env.CARDS_DATABASE_URL !== process.env.DATABASE_URL)
      throw new Error('Owned UAT database mismatch');
    await verifyExistingDatabase(pgUrl.toString(), options.database);
    const [{ startRuntime }, { createUatStorage }] = await Promise.all([
      import('../../src/runtime.js'), import('../helpers/uat-storage.mjs'),
    ]);
    const disabledStorage = async () => { throw new Error('Local UAT storage not enabled'); };
    // An explicit disabled client also prevents fallback to any persisted OSS keys.
    const storage = process.env.ALIBABA_CLOUD_ACCESS_KEY_ID ? createUatStorage(process.env) : {
      put: disabledStorage, get: disabledStorage, getStream: disabledStorage,
      delete: disabledStorage, list: disabledStorage,
    };
    // startRuntime performs normal schema migrations and stale-session recovery.
    // There is deliberately no seed, AI probe, database drop, or OSS cleanup.
    const runtime = await startRuntime({ port: options.port, host: '127.0.0.1', storageClient: storage });
    try {
      console.log(`PLAYER_UAT_RESUMED http://127.0.0.1:${options.port}/player/ database=${options.database}`);
      await new Promise(resolve => { process.once('SIGINT', resolve); process.once('SIGTERM', resolve); });
    } finally { await runtime.stop(); }
    return;
  }
  const pgUrl = localService(process.env.WQT_TEST_PG_ADMIN_URL, 'pg');
  const redisUrl = localService(process.env.WQT_TEST_REDIS_URL, 'redis');
  pgUrl.pathname = `/${options.database}`;
  await verifyExistingDatabase(pgUrl.toString(), options.database);
  const external = integrationEnvironment(options);
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), '--child', '--database', options.database, '--port', String(options.port)], {
    windowsHide: true, stdio: 'inherit',
    env: sanitizedChildEnv({
      ...external, WQT_RUNTIME_TEST_CHILD: '1', WQT_ACCOUNT_MODEL: 'accounts',
      DATABASE_URL: pgUrl.toString(), CARDS_DATABASE_URL: pgUrl.toString(), CARDS_SOURCE: 'postgres',
      REDIS_URL: redisUrl.toString(), WQT_REDIS_NAMESPACE: options.database,
      SERVER_ENV: 'prod', JWT_SECRET: 'local-player-uat-synthetic-secret',
      SETTINGS_ENCRYPTION_KEY: '0123456789abcdef'.repeat(4),
    }),
  });
  const stop = () => child.kill('SIGTERM');
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try {
    process.exitCode = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0)));
    });
  } finally {
    process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
  }
}

main().catch(() => {
  // Driver/provider errors may contain connection details. Never dump credentials.
  console.error('PLAYER_UAT_RESUME_FAILED: check owned database, local service configuration and requested integration settings.');
  process.exitCode = 1;
});
