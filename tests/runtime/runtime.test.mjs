import assert from "node:assert/strict";
import { once } from "node:events";
import http from "node:http";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { createOwnedDatabase, dropOwnedDatabase, getTestPgAdminUrl, runNodeScript, sanitizedChildEnv } from "../helpers/runtime-test-env.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const appUrl = pathToFileURL(resolve(root, "src/app.js")).href;
const runtimeUrl = pathToFileURL(resolve(root, "src/runtime.js")).href;

test("fresh app/runtime imports have no listener, database, or timer side effects", async () => {
  const result = await runNodeScript(`
    import net from "node:net";
    import pg from "pg";
    const calls = [];
    const listen = net.Server.prototype.listen;
    net.Server.prototype.listen = function (...args) { calls.push("listen"); return this; };
    const query = pg.Pool.prototype.query;
    pg.Pool.prototype.query = function (...args) { calls.push("query"); return Promise.reject(new Error("unexpected query")); };
    const connect = pg.Pool.prototype.connect;
    pg.Pool.prototype.connect = function (...args) { calls.push("connect"); return Promise.reject(new Error("unexpected connect")); };
    const setInterval = globalThis.setInterval;
    globalThis.setInterval = (...args) => { calls.push("interval"); return { unref() {} }; };
    await import(${JSON.stringify(appUrl)});
    await import(${JSON.stringify(runtimeUrl)});
    net.Server.prototype.listen = listen;
    pg.Pool.prototype.query = query;
    pg.Pool.prototype.connect = connect;
    globalThis.setInterval = setInterval;
    console.log(JSON.stringify(calls));
  `);
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout.trim().split("\n").at(-1)), []);
});

test("createApp assembles without a database and preserves basic HTTP semantics", async () => {
  const { createApp } = await import(appUrl);
  const app = createApp({ runtimeConfig: { JWT_SECRET: "test" }, ossClient: null });
  const server = http.createServer(app);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  try {
    assert.equal((await request(port, "/")).statusCode, 200);
    assert.equal((await request(port, "/api/does-not-exist")).statusCode, 404);
    assert.equal((await request(port, "/api/me")).statusCode, 401);
  } finally {
    await close(server);
  }
});

test("PostgreSQL helper refuses missing admin configuration before importing pg", async () => {
  const result = await runNodeScript(`
    if (process.env.WQT_TEST_PG_ADMIN_URL) throw new Error("unexpected inherited admin URL");
    const { createOwnedDatabase } = await import(${JSON.stringify(pathToFileURL(resolve(root, "tests/helpers/runtime-test-env.mjs")).href)});
    try { await createOwnedDatabase(); throw new Error("database helper unexpectedly succeeded"); }
    catch (error) { console.log(error.message); }
  `);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /WQT_TEST_PG_ADMIN_URL|DATABASE_URL|PostgreSQL|configuration/i);
});

test("test helpers reject forged database ownership and strip inherited credentials", async () => {
  await assert.rejects(() => dropOwnedDatabase({ database: "wqt_r1_forged", adminUrl: "postgres://unused" }), /not created/);
  const key = "DATABASE_URL";
  const previous = process.env[key];
  try {
    process.env[key] = "postgres://must-not-inherit";
    assert.equal(sanitizedChildEnv().DATABASE_URL, undefined);
    assert.equal(sanitizedChildEnv({ DATABASE_URL: "explicit" }).DATABASE_URL, "explicit");
  } finally {
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
  }
});

test("PostgreSQL runtime lifecycle is exercised in an owned database", { skip: !getTestPgAdminUrl() }, async () => {
  const database = await createOwnedDatabase();
  try {
    const result = await runNodeScript(`
      import assert from "node:assert/strict";
      import net from "node:net";
      import { dbRun, dbGet } from ${JSON.stringify(pathToFileURL(resolve(root, "src/db.js")).href)};
      import { rotateSession } from ${JSON.stringify(pathToFileURL(resolve(root, "src/services/sessions.js")).href)};
      import { signToken } from ${JSON.stringify(pathToFileURL(resolve(root, "src/middleware/auth.js")).href)};
      const { startRuntime } = await import(${JSON.stringify(runtimeUrl)});
      const starting = startRuntime({ port: 0, host: "127.0.0.1" });
      await assert.rejects(() => startRuntime(), /already running or starting/);
      const first = await starting;
      const { PERMANENT_UNTIL } = await import(${JSON.stringify(pathToFileURL(resolve(root, "src/account.js")).href)});
      const user = await dbGet("INSERT INTO users(phone, username, role, watcher_level, valid_until, is_profile_complete) VALUES(?,?,?,?,?,1) RETURNING id, username, phone, role, enterprise_id", ["1555555" + Date.now().toString().slice(-4), "r1_" + Date.now(), "watcher", "initial", PERMANENT_UNTIL]);
      const jti = await rotateSession(user.id);
      const token = signToken({ ...user, jti });
      const base = "http://127.0.0.1:" + first.server.address().port;
      const headers = { "content-type": "application/json", authorization: "Bearer " + token };
      const unauthenticated = await fetch(base + "/api/game/start", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      assert.equal(unauthenticated.status, 401);
      await unauthenticated.text();
      const started = await fetch(base + "/api/game/start", { method: "POST", headers, body: JSON.stringify({ ts: Date.now(), mode: "r1" }) });
      assert.equal(started.status, 200);
      const startedBody = await started.json();
      const event = await fetch(base + "/api/game/event", { method: "POST", headers, body: JSON.stringify({ sessionId: startedBody.sessionId, type: "card_choice", payload: { card: "fixture" } }) });
      assert.equal(event.status, 200);
      await event.text();
      const finished = await fetch(base + "/api/game/finish", { method: "POST", headers, body: JSON.stringify({ sessionId: startedBody.sessionId, endedAt: Date.now(), finalScore: 7 }) });
      assert.equal(finished.status, 200);
      await finished.text();
      const inspected = await fetch(base + "/api/game/session/" + startedBody.sessionId, { headers: { authorization: "Bearer " + token } });
      assert.equal(inspected.status, 200);
      const inspectedBody = await inspected.json();
      assert.equal(inspectedBody.session.final_score, 7);
      assert.equal(inspectedBody.events.length, 1);
      assert.equal((await dbGet("SELECT COUNT(*) AS count FROM game_events WHERE session_id = ?", [startedBody.sessionId])).count, 1);
      const concurrent = await Promise.allSettled([
        startRuntime({ port: 0, host: "127.0.0.1" }),
        startRuntime({ port: 0, host: "127.0.0.1" }),
      ]);
      assert.equal(concurrent.filter(item => item.status === "fulfilled").length, 0);
      await Promise.all([first.stop(), first.stop()]);
      const occupied = net.createServer().listen(0, "127.0.0.1");
      await new Promise(resolve => occupied.once("listening", resolve));
      const occupiedPort = occupied.address().port;
      await assert.rejects(() => startRuntime({ port: occupiedPort, host: "127.0.0.1" }), { code: "EADDRINUSE" });
      await new Promise((resolve, reject) => occupied.close(error => error ? reject(error) : resolve()));
      const restarted = await startRuntime({ port: occupiedPort, host: "127.0.0.1" });
      await restarted.stop();
      console.log(JSON.stringify({ listening: restarted.server.listening, concurrent: concurrent.map(item => item.status), persisted: true }));
    `, {
      env: {
        DATABASE_URL: database.connectionString,
        CARDS_DATABASE_URL: database.connectionString,
        CARDS_SOURCE: "postgres",
        JWT_SECRET: "wqt-r1-test-secret",
      },
    });
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.timedOut, false);
    const lifecycle = JSON.parse(result.stdout.trim().split("\n").at(-1));
    assert.equal(lifecycle.listening, false);
    assert.equal(lifecycle.persisted, true);
  } finally {
    await dropOwnedDatabase(database);
  }
});

function request(port, path) {
  return new Promise((resolveRequest, reject) => {
    const req = http.get({ hostname: "127.0.0.1", port, path }, response => {
      response.resume();
      response.once("end", () => resolveRequest(response));
    });
    req.on("error", reject);
  });
}

function close(server) {
  return new Promise((resolveClose, reject) => server.close(error => error ? reject(error) : resolveClose()));
}
