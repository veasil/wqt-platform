import pg from "pg";
import { decryptVal } from "./config.js";

const protectedKeys = new Set([
  "NODE_ENV",
  "SERVER_ENV",
  "JWT_SECRET",
  "SETTINGS_ENCRYPTION_KEY",
  "DATABASE_URL",
  "CARDS_DATABASE_URL",
  "CARDS_SOURCE",
  "DATABASE_SSL",
  "ENABLE_DEV_LOGIN",
  "DEV_LOGIN_KEY",
  "TEST_LOGIN_CODE",
  "TEST_LOGIN_PHONES",
]);
const externalKey =
  /^(BMOB_|OSS_|ALIBABA_|ALIYUN_|OPENAI_|DEEPSEEK_|GEMINI_|DASHSCOPE_|VOLCENGINE_|TENCENT_|CAPTCHA_)/;
const requiredServices = [
  "BMOB_APP_ID",
  "BMOB_REST_KEY",
  "ALIBABA_CLOUD_ACCESS_KEY_ID",
  "ALIBABA_CLOUD_ACCESS_KEY_SECRET",
  "OSS_BUCKET_NAME",
  "OSS_REGION",
];
const present = (value) => typeof value === "string" && value.trim().length > 0;
const isolated = (env) => ["test", "development"].includes(env.NODE_ENV);
const fail = (field) => {
  throw new Error(`Startup guard rejected ${field}`);
};

function databaseTarget(env, key, hostKey, nameKey) {
  if (!present(env[key])) fail(key);
  let url;
  try {
    url = new URL(env[key]);
  } catch {
    fail(key);
  }
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !url.hostname ||
    url.pathname.length < 2
  )
    fail(key);
  if (url.searchParams.has("options")) fail(`${key} options`);
  if (env.SERVER_ENV === "staging") {
    if (!present(env[hostKey]) || env[hostKey] !== url.hostname) fail(hostKey);
    if (
      !present(env[nameKey]) ||
      env[nameKey] !== decodeURIComponent(url.pathname.slice(1))
    )
      fail(nameKey);
  }
}

export function validateStartupEnvironment(env = process.env) {
  if (isolated(env)) return;
  if (env.NODE_ENV !== "production") fail("NODE_ENV");
  if (!["staging", "prod"].includes(env.SERVER_ENV)) fail("SERVER_ENV");
  if (
    !present(env.JWT_SECRET) ||
    env.JWT_SECRET.length < 32 ||
    /change.me|example|placeholder/i.test(env.JWT_SECRET) ||
    /^(.)\1+$/.test(env.JWT_SECRET)
  )
    fail("JWT_SECRET");
  if (
    !/^[0-9a-f]{64}$/i.test(env.SETTINGS_ENCRYPTION_KEY || "") ||
    /^(.)\1+$/.test(env.SETTINGS_ENCRYPTION_KEY)
  )
    fail("SETTINGS_ENCRYPTION_KEY");
  if (env.CARDS_SOURCE !== "postgres") fail("CARDS_SOURCE");
  databaseTarget(
    env,
    "DATABASE_URL",
    "WQT_EXPECTED_MAIN_HOST",
    "WQT_EXPECTED_MAIN_DATABASE",
  );
  databaseTarget(
    env,
    "CARDS_DATABASE_URL",
    "WQT_EXPECTED_CARDS_HOST",
    "WQT_EXPECTED_CARDS_DATABASE",
  );
  if (env.ENABLE_DEV_LOGIN && env.ENABLE_DEV_LOGIN !== "false")
    fail("ENABLE_DEV_LOGIN");
  for (const key of ["DEV_LOGIN_KEY", "TEST_LOGIN_CODE", "TEST_LOGIN_PHONES"])
    if (present(env[key])) fail(key);
  if (env.SERVER_ENV === "staging") {
    if (
      !present(env.WQT_EXPECTED_OSS_BUCKET) ||
      env.OSS_BUCKET_NAME !== env.WQT_EXPECTED_OSS_BUCKET ||
      env.OSS_BUCKET_NAME === "ai5000days-scoring-system-hk"
    )
      fail("OSS_BUCKET_NAME");
  }
}

export function validateEffectiveConfiguration(env, rows = []) {
  if (isolated(env)) return;
  validateStartupEnvironment(env);
  const effective = { ...env };
  for (const { key, value } of rows) {
    if (!present(value)) continue;
    if (protectedKeys.has(key) || key.startsWith("WQT_EXPECTED_"))
      fail(`database setting ${key}`);
    if (
      env.SERVER_ENV === "staging" &&
      (externalKey.test(key) ||
        /(?:API_KEY|SECRET|TOKEN|PASSWORD|BASE_URL|ENDPOINT)$/.test(key))
    )
      fail(`database setting ${key}`);
    effective[key] = value;
  }
  for (const key of requiredServices) {
    if (!present(effective[key]) || effective[key].startsWith("enc:"))
      fail(key);
  }
}

// No app initialization, listeners, migrations, seed writes or external service calls.
export async function preflightStartup(env = process.env) {
  validateStartupEnvironment(env);
  if (isolated(env)) return;
  // Staging must have all integration settings explicitly before any connection.
  if (env.SERVER_ENV === "staging") validateEffectiveConfiguration(env, []);
  let rows = [];
  for (const [index, connectionString] of [
    env.DATABASE_URL,
    env.CARDS_DATABASE_URL,
  ].entries()) {
    const client = new pg.Client({
      connectionString,
      connectionTimeoutMillis: 5000,
      query_timeout: 5000,
      ssl:
        env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined,
    });
    try {
      await client.connect();
      await client.query("BEGIN READ ONLY");
      const identity = await client.query("SELECT current_database() AS name");
      if (
        identity.rows[0].name !==
        decodeURIComponent(new URL(connectionString).pathname.slice(1))
      )
        fail("database identity");
      if (index === 0) {
        const table = await client.query(
          "SELECT to_regclass('public.system_settings') AS name",
        );
        if (table.rows[0].name)
          rows = (
            await client.query("SELECT key, value FROM public.system_settings")
          ).rows;
      }
      await client.query("ROLLBACK");
    } catch {
      throw new Error(
        `Startup guard: ${index === 0 ? "main" : "cards"} database preflight failed`,
      );
    } finally {
      await client.end().catch(() => {});
    }
  }
  // Encrypted service settings are validated by loadConfig after decryption. Staging forbids them.
  validateEffectiveConfiguration(
    env,
    rows.map((row) => ({
      ...row,
      value: env.SERVER_ENV === "staging" ? row.value : decryptVal(row.value),
    })),
  );
}
