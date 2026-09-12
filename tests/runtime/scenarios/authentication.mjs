import assert from "node:assert/strict";
import { dbGet, dbRun } from "../../../src/db.js";
import { startRuntime } from "../../../src/runtime.js";
import { signToken } from "../../../src/middleware/auth.js";
import { rotateSession } from "../../../src/services/sessions.js";
import { smsStore } from "../../../src/services/sms.js";
import bcrypt from "bcryptjs";

if (
  process.env.WQT_RUNTIME_TEST_CHILD !== "1" ||
  !process.env.DATABASE_URL ||
  !process.env.CARDS_DATABASE_URL
)
  throw new Error(
    "authentication scenario must run through authentication.test.mjs",
  );

import { PERMANENT_UNTIL as UNTIL } from "../../../src/account.js";

export async function runAuthenticationScenario() {
  let runtime;
  try {
    runtime = await startRuntime({ port: 0, host: "127.0.0.1" });
    await dbRun(
      "INSERT INTO system_settings(key, value, description) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      ["DEV_KEY", "legacy-test-key", "test secret"],
    );
    await dbRun(
      "INSERT INTO system_settings(key, value, description) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      ["JWT_SECRET", "db-test-secret", "test secret"],
    );
    await dbRun(
      "INSERT INTO system_settings(key, value, description) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      ["TOAPIS_API_KEY", "db-test-key", "test secret"],
    );
    await dbRun(
      "INSERT INTO system_settings(key, value, description) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      ["operator_permissions", "{}", "test permissions"],
    );
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const org = await dbRun(
      "INSERT INTO organizations(name, owner_user_id, valid_until) VALUES(?,0,?)",
      [`auth-org-${suffix}`, UNTIL],
    );
    const player = await user(
      `player-${suffix}`,
      "watcher",
      org.lastID,
      "player",
    );
    const boss = await user(`boss-${suffix}`, "boss", null, "boss");
    const enterprise = await user(
      `enterprise-${suffix}`,
      "enterprise",
      org.lastID,
      "enterprise",
    );
    const password = "password-123";
    await dbRun("UPDATE users SET password_hash=? WHERE id IN (?,?,?)", [
      bcrypt.hashSync(password, 10),
      player.id,
      boss.id,
      enterprise.id,
    ]);
    const base = `http://127.0.0.1:${runtime.server.address().port}`;

    smsStore.set(player.phone, {
      code: "111111",
      expiresAt: Date.now() + 300000,
    });
    const wrong = await json(base, "/api/auth/login", {
      phone: player.phone,
      password: "wrong-password",
      code: "111111",
    });
    assert.equal(wrong.status, 401);
    smsStore.set(player.phone, {
      code: "111111",
      expiresAt: Date.now() + 300000,
    });
    const login = await json(base, "/api/auth/login", {
      phone: player.phone,
      password,
      code: "111111",
    });
    assert.equal(login.status, 200, JSON.stringify(login.body));
    assert.ok(login.body.token);
    const replay = await json(base, "/api/auth/login", {
      phone: player.phone,
      password,
      code: "111111",
    });
    assert.equal(replay.status, 400);

    const phoneOnly = await json(base, "/api/auth/admin-login", {
      phone: boss.phone,
    });
    assert.equal(phoneOnly.status, 400);
    assert.equal(phoneOnly.body?.token, undefined);
    smsStore.set(enterprise.phone, {
      code: "222222",
      expiresAt: Date.now() + 300000,
    });
    const enterpriseAdmin = await json(base, "/api/auth/admin-login", {
      phone: enterprise.phone,
      password,
      code: "222222",
    });
    assert.equal(enterpriseAdmin.status, 403);
    smsStore.set(boss.phone, {
      code: "333333",
      expiresAt: Date.now() + 300000,
    });
    const adminLogin = await json(base, "/api/auth/admin-login", {
      phone: boss.phone,
      password,
      code: "333333",
    });
    assert.equal(adminLogin.status, 200, JSON.stringify(adminLogin.body));
    assert.equal(adminLogin.body.user.role, "boss");
    assert.ok(adminLogin.body.token);

    process.env.NODE_ENV = "production";
    const oldDev = await json(base, "/api/auth/dev-login", {
      key: "sj0127wqt",
    });
    assert.equal(oldDev.status, 404);
    const settings = await request(base, "/api/settings");
    assert.equal(settings.status, 200);
    for (const setting of settings.body.settings) {
      assert.ok(
        [
          "DEFAULT_GAME_TIME",
          "GAME_MODES",
          "REVIEW_MIN_CARDS",
          "BRANDING_INFO",
          "ATTRIBUTES_CONFIG",
        ].includes(setting.key),
      );
    }
    assert.equal(
      settings.body.settings.some((s) =>
        [
          "DEV_KEY",
          "JWT_SECRET",
          "TOAPIS_API_KEY",
          "operator_permissions",
        ].includes(s.key),
      ),
      false,
    );

    const oldBossToken = await token(boss);
    await dbRun("UPDATE users SET role='watcher' WHERE id=?", [boss.id]);
    const downgraded = await request(
      base,
      "/api/admin/organizations",
      oldBossToken,
    );
    assert.equal(downgraded.status, 403);
    console.log(
      JSON.stringify({ login: true, adminLogin: true, settingsPublic: true }),
    );
  } finally {
    if (runtime) await runtime.stop();
  }
}

async function user(username, role, enterpriseId, label) {
  const result = await dbRun(
    "INSERT INTO users(username, phone, role, enterprise_id, valid_until, guardian_name, is_profile_complete) VALUES(?,?,?,?,?,?,1)",
    [
      username,
      `166${Date.now()}${Math.floor(Math.random() * 1000)}`,
      role,
      enterpriseId,
      UNTIL,
      label,
    ],
  );
  const row = await dbGet(
    "SELECT id, username, phone, role, enterprise_id FROM users WHERE id=?",
    [result.lastID],
  );
  return row;
}

async function token(user) {
  return signToken({ ...user, jti: await rotateSession(user.id) });
}

async function json(base, pathname, body) {
  return request(base, pathname, null, body);
}

async function request(base, pathname, tokenValue, body) {
  const method = body ? "POST" : "GET";
  const headers = tokenValue ? { authorization: `Bearer ${tokenValue}` } : {};
  if (body) headers["content-type"] = "application/json";
  const response = await fetch(base + pathname, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch (_) {}
  return { status: response.status, body: parsed };
}
