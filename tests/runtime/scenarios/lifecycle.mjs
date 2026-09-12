import assert from "node:assert/strict";
import net from "node:net";
import { dbRun, dbGet } from "../../../src/db.js";
import { rotateSession } from "../../../src/services/sessions.js";
import bcrypt from "bcryptjs";
import { smsStore } from "../../../src/services/sms.js";

assert.equal(
  process.env.WQT_RUNTIME_TEST_CHILD,
  "1",
  "Run this scenario through npm run test:runtime",
);
assert.ok(
  process.env.DATABASE_URL && process.env.CARDS_DATABASE_URL,
  "Both test databases must be explicit",
);
const { startRuntime } = await import("../../../src/runtime.js");
const starting = startRuntime({ port: 0, host: "127.0.0.1" });
await assert.rejects(() => startRuntime(), /already running or starting/);
const first = await starting;
const { PERMANENT_UNTIL } = await import("../../../src/account.js");
const base = "http://127.0.0.1:" + first.server.address().port;
const created = await dbRun(
  "INSERT INTO users(phone, username, password_hash, role, watcher_level, valid_until, is_profile_complete) VALUES(?,?,?,?,?,?,1)",
  [
    "15555550001",
    "runtime_fixture",
    bcrypt.hashSync("fixture-password", 4),
    "watcher",
    "initial",
    PERMANENT_UNTIL,
  ],
);
const user = await dbGet("SELECT * FROM users WHERE id = ?", [created.lastID]);
// Substitute only the SMS provider; exercise the real password/code/session login path.
smsStore.set(user.phone, { code: "123456", expiresAt: Date.now() + 60000 });
const login = await fetch(base + "/api/auth/login", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    phone: user.phone,
    password: "fixture-password",
    code: "123456",
  }),
});
assert.equal(login.status, 200);
const { token } = await login.json();
assert.equal(smsStore.has(user.phone), false, "Login must consume the code");
const headers = {
  "content-type": "application/json",
  authorization: "Bearer " + token,
};
const unauthenticated = await fetch(base + "/api/game/start", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: "{}",
});
assert.equal(unauthenticated.status, 401);
await unauthenticated.text();
const started = await fetch(base + "/api/game/start", {
  method: "POST",
  headers,
  body: JSON.stringify({ ts: Date.now(), mode: "r1" }),
});
assert.equal(started.status, 200);
const startedBody = await started.json();
const event = await fetch(base + "/api/game/event", {
  method: "POST",
  headers,
  body: JSON.stringify({
    sessionId: startedBody.sessionId,
    type: "card_choice",
    payload: { card: "fixture" },
  }),
});
assert.equal(event.status, 200);
await event.text();
const finished = await fetch(base + "/api/game/finish", {
  method: "POST",
  headers,
  body: JSON.stringify({
    sessionId: startedBody.sessionId,
    endedAt: Date.now(),
    finalScore: 7,
  }),
});
assert.equal(finished.status, 200);
await finished.text();
const inspected = await fetch(
  base + "/api/game/session/" + startedBody.sessionId,
  { headers: { authorization: "Bearer " + token } },
);
assert.equal(inspected.status, 200);
const inspectedBody = await inspected.json();
assert.equal(inspectedBody.session.final_score, 7);
assert.equal(inspectedBody.events.length, 1);
assert.equal(
  (
    await dbGet(
      "SELECT COUNT(*) AS count FROM game_events WHERE session_id = ?",
      [startedBody.sessionId],
    )
  ).count,
  1,
);

// Platform checks use the current database state, including when a JWT is stale.
await expectStatus("/api/admin/organizations", token, 403);
await dbRun("UPDATE users SET valid_until = ? WHERE id = ?", [
  Date.now() - 1000,
  user.id,
]);
await expectStatus("/api/me", token, 403, "ACCOUNT_EXPIRED");
await dbRun("UPDATE users SET valid_until = ? WHERE id = ?", [
  PERMANENT_UNTIL,
  user.id,
]);
const org = await dbRun(
  "INSERT INTO organizations(name, owner_user_id, valid_until) VALUES(?,?,?)",
  ["Fixture organization", user.id, PERMANENT_UNTIL],
);
await dbRun(
  "UPDATE users SET role = 'enterprise', enterprise_id = ? WHERE id = ?",
  [org.lastID, user.id],
);
await expectStatus("/api/enterprise/info", token, 200);
await expectStatus("/api/enterprise/dashboard", token, 200);
await dbRun("UPDATE users SET role = 'watcher' WHERE id = ?", [user.id]);
await expectStatus("/api/enterprise/info", token, 403);
await dbRun("UPDATE organizations SET status = 'suspended' WHERE id = ?", [
  org.lastID,
]);
await expectStatus("/api/me", token, 403, "ORG_SUSPENDED");
await dbRun("UPDATE organizations SET status = 'active' WHERE id = ?", [
  org.lastID,
]);
await rotateSession(user.id);
await expectStatus("/api/me", token, 401, "SESSION_REVOKED");

async function expectStatus(path, bearer, expected, code) {
  const response = await fetch(base + path, {
    headers: { authorization: "Bearer " + bearer },
  });
  const body = await response.json();
  assert.equal(response.status, expected, path + ": " + JSON.stringify(body));
  if (code) assert.equal(body.code, code);
  return body;
}
const concurrent = await Promise.allSettled([
  startRuntime({ port: 0, host: "127.0.0.1" }),
  startRuntime({ port: 0, host: "127.0.0.1" }),
]);
assert.equal(
  concurrent.filter((item) => item.status === "fulfilled").length,
  0,
);
await Promise.all([first.stop(), first.stop()]);
const occupied = net.createServer().listen(0, "127.0.0.1");
await new Promise((resolve) => occupied.once("listening", resolve));
const occupiedPort = occupied.address().port;
await assert.rejects(
  () => startRuntime({ port: occupiedPort, host: "127.0.0.1" }),
  { code: "EADDRINUSE" },
);
await new Promise((resolve, reject) =>
  occupied.close((error) => (error ? reject(error) : resolve())),
);
const restarted = await startRuntime({ port: occupiedPort, host: "127.0.0.1" });
await restarted.stop();
console.log(
  JSON.stringify({
    listening: restarted.server.listening,
    concurrent: concurrent.map((item) => item.status),
    persisted: true,
  }),
);
