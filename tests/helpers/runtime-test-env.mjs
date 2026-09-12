import crypto from "node:crypto";
import { spawn } from "node:child_process";

const PASSTHROUGH_KEYS = [
  "PATH",
  "Path",
  "SystemRoot",
  "WINDIR",
  "TEMP",
  "TMP",
  "PATHEXT",
  "ComSpec",
];
const ownedDatabases = new Map();

/** Build a child environment without inheriting credentials or .env-related config. */
export function sanitizedChildEnv(overrides = {}) {
  const env = {};
  for (const key of PASSTHROUGH_KEYS) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  return { ...env, NODE_ENV: "test", ...overrides };
}

export async function runNodeScript(
  source,
  { env = {}, cwd = process.cwd(), timeoutMs = 30_000 } = {},
) {
  const child = spawn(process.execPath, ["--input-type=module", "-e", source], {
    cwd,
    env: sanitizedChildEnv(env),
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const stdout = [];
  const stderr = [];
  child.stdout.on("data", (chunk) => stdout.push(chunk));
  child.stderr.on("data", (chunk) => stderr.push(chunk));
  const result = await new Promise((resolve, reject) => {
    let settled = false;
    let timedOut = false;
    const finish = (value) => {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.once("error", (error) => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        reject(error);
      }
    });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      finish({ code, signal, timedOut });
    });
  });
  return {
    ...result,
    stdout: Buffer.concat(stdout).toString("utf8"),
    stderr: Buffer.concat(stderr).toString("utf8"),
  };
}

export function getTestPgAdminUrl() {
  return process.env.WQT_TEST_PG_ADMIN_URL || null;
}

export function ownedDatabaseName(prefix = "wqt_r1") {
  return `${prefix}_${crypto.randomBytes(10).toString("hex")}`;
}

export async function createOwnedDatabase() {
  const adminUrl = getTestPgAdminUrl();
  if (!adminUrl)
    throw new Error("WQT_TEST_PG_ADMIN_URL is required for PostgreSQL tests");
  const { Client } = await import("pg");
  const database = ownedDatabaseName();
  const client = new Client({
    connectionString: adminUrl,
    connectionTimeoutMillis: 5000,
  });
  await client.connect();
  try {
    await client.query(`CREATE DATABASE "${database}"`);
  } finally {
    await client.end();
  }
  const url = new URL(adminUrl);
  url.pathname = `/${database}`;
  ownedDatabases.set(database, adminUrl);
  return { database, connectionString: url.toString(), adminUrl };
}

export async function dropOwnedDatabase({ database, adminUrl }) {
  if (!database || !adminUrl || ownedDatabases.get(database) !== adminUrl) {
    throw new Error(
      "Refusing to drop a database not created by this test helper",
    );
  }
  const { Client } = await import("pg");
  const client = new Client({ connectionString: adminUrl });
  await client.connect();
  let dropped = false;
  try {
    await client.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
    dropped = true;
  } finally {
    await client.end();
    if (dropped) ownedDatabases.delete(database);
  }
}
