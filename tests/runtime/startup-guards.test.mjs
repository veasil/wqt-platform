import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  validateEffectiveConfiguration,
  validateStartupEnvironment,
} from "../../src/startup-guards.js";

const JWT_SECRET = "wqt-test-jwt-secret-which-is-long-enough-123456";
const SETTINGS_ENCRYPTION_KEY =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

function validEnvironment(overrides = {}) {
  return {
    NODE_ENV: "production",
    SERVER_ENV: "prod",
    DATABASE_URL: "postgres://wqt:password@db.example.com:5432/wqt",
    CARDS_DATABASE_URL: "postgres://wqt:password@cards.example.com:5432/cards",
    JWT_SECRET,
    SETTINGS_ENCRYPTION_KEY,
    CARDS_SOURCE: "postgres",
    BMOB_APP_ID: "real-bmob-app-id",
    BMOB_REST_KEY: "real-bmob-rest-key",
    ALIBABA_CLOUD_ACCESS_KEY_ID: "real-aliyun-id",
    ALIBABA_CLOUD_ACCESS_KEY_SECRET: "real-aliyun-secret",
    OSS_BUCKET_NAME: "wqt-prod-bucket",
    OSS_REGION: "oss-cn-hangzhou",
    ...overrides,
  };
}

function assertRejected(validate, field) {
  assert.throws(validate, (error) => {
    assert.match(
      error.message,
      new RegExp(`(?:^|\\s)${field.replaceAll("_", "_")}(?:$|\\s)`),
    );
    assert.doesNotMatch(
      error.message,
      /postgres:\/\/|database-secret|copy-bucket/i,
    );
    return true;
  });
}

function assertAccepted(validate) {
  assert.doesNotThrow(validate);
}

test("development and test environments do not require strict startup protection", () => {
  assertAccepted(() => validateStartupEnvironment({ NODE_ENV: "test" }));
  assertAccepted(() => validateStartupEnvironment({ NODE_ENV: "development" }));
});

test("production requires an explicit environment and rejects weak secrets", () => {
  assertRejected(() => validateStartupEnvironment({}), "NODE_ENV");
  assertRejected(
    () => validateStartupEnvironment(validEnvironment({ JWT_SECRET: "short" })),
    "JWT_SECRET",
  );
  assertRejected(
    () =>
      validateStartupEnvironment(
        validEnvironment({ SETTINGS_ENCRYPTION_KEY: "f".repeat(64) }),
      ),
    "SETTINGS_ENCRYPTION_KEY",
  );
});

test("a fully specified production environment passes startup validation", () => {
  assertAccepted(() => validateStartupEnvironment(validEnvironment()));
});

test("staging requires endpoint and bucket identity to match the expected deployment", () => {
  const staging = validEnvironment({
    SERVER_ENV: "staging",
    DATABASE_URL:
      "postgres://wqt:password@staging-db.example.com:5432/wqt_staging",
    CARDS_DATABASE_URL:
      "postgres://wqt:password@staging-cards.example.com:5432/cards_staging",
    OSS_BUCKET_NAME: "wqt-staging-bucket",
    WQT_EXPECTED_MAIN_HOST: "staging-db.example.com",
    WQT_EXPECTED_MAIN_DATABASE: "wqt_staging",
    WQT_EXPECTED_CARDS_HOST: "staging-cards.example.com",
    WQT_EXPECTED_CARDS_DATABASE: "cards_staging",
    WQT_EXPECTED_OSS_BUCKET: "wqt-staging-bucket",
  });
  assertAccepted(() => validateStartupEnvironment(staging));
  assertRejected(
    () =>
      validateStartupEnvironment({
        ...staging,
        WQT_EXPECTED_MAIN_HOST: "wrong.example.com",
      }),
    "WQT_EXPECTED_MAIN_HOST",
  );
  assertRejected(
    () =>
      validateStartupEnvironment({
        ...staging,
        OSS_BUCKET_NAME: "ai5000days-scoring-system-hk",
      }),
    "OSS_BUCKET_NAME",
  );
});

test("startup rejects development login switches in production", () => {
  for (const field of [
    "ENABLE_DEV_LOGIN",
    "DEV_LOGIN_KEY",
    "TEST_LOGIN_CODE",
    "TEST_LOGIN_PHONES",
  ]) {
    assertRejected(
      () =>
        validateStartupEnvironment(
          validEnvironment({
            [field]: field === "ENABLE_DEV_LOGIN" ? "true" : "x",
          }),
        ),
      field,
    );
  }
});

test("effective configuration rejects database overrides of security and connection settings", () => {
  const env = validEnvironment();
  const values = {
    SERVER_ENV: "prod",
    NODE_ENV: "production",
    JWT_SECRET: "database-secret",
    SETTINGS_ENCRYPTION_KEY: SETTINGS_ENCRYPTION_KEY,
    DATABASE_URL: env.DATABASE_URL,
    CARDS_DATABASE_URL: env.CARDS_DATABASE_URL,
    CARDS_SOURCE: "postgres",
    ENABLE_DEV_LOGIN: "true",
    DEV_LOGIN_KEY: "database-dev-key",
    TEST_LOGIN_CODE: "123456",
    TEST_LOGIN_PHONES: "+6500000000",
  };
  for (const [key, value] of Object.entries(values)) {
    assertRejected(
      () => validateEffectiveConfiguration(env, [{ key, value }]),
      key,
    );
  }
});

test("staging rejects database supplied external service configuration", () => {
  const env = validEnvironment({
    SERVER_ENV: "staging",
    WQT_EXPECTED_MAIN_HOST: "db.example.com",
    WQT_EXPECTED_MAIN_DATABASE: "wqt",
    WQT_EXPECTED_CARDS_HOST: "cards.example.com",
    WQT_EXPECTED_CARDS_DATABASE: "cards",
    WQT_EXPECTED_OSS_BUCKET: "wqt-prod-bucket",
  });
  assertRejected(
    () =>
      validateEffectiveConfiguration(env, [
        { key: "OSS_BUCKET_NAME", value: "copy-bucket" },
      ]),
    "OSS_BUCKET_NAME",
  );
});

test("effective configuration requires real SMS and OSS settings", () => {
  const env = validEnvironment({ BMOB_APP_ID: "", OSS_BUCKET_NAME: "" });
  assertRejected(() => validateEffectiveConfiguration(env, []), "BMOB_APP_ID");
  assert.throws(
    () => validateEffectiveConfiguration({ ...env, BMOB_APP_ID: "real" }, []),
    /OSS_BUCKET_NAME/,
  );
});

test("production runtime rejects bad configuration before attempting a database connection", () => {
  const childEnvironment = {
    NODE_ENV: "production",
    SERVER_ENV: "prod",
    DATABASE_URL: "postgres://invalid-host.invalid:5432/wqt",
    CARDS_DATABASE_URL: "postgres://invalid-cards.invalid:5432/cards",
    JWT_SECRET: "short",
    SETTINGS_ENCRYPTION_KEY: "f".repeat(64),
    CARDS_SOURCE: "postgres",
  };
  const result = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      "await (await import('./src/runtime.js')).startRuntime()",
    ],
    {
      cwd: fileURLToPath(new URL("../..", import.meta.url)),
      env: childEnvironment,
      encoding: "utf8",
      timeout: 5000,
    },
  );
  const output = `${result.stdout}\n${result.stderr}`;
  assert.notEqual(result.status, 0);
  assert.match(output, /JWT_SECRET/);
  assert.doesNotMatch(output, /ENOTFOUND|ECONNREFUSED|connect ETIMEDOUT/i);
});
