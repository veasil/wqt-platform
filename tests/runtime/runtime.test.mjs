import assert from "node:assert/strict";
import { once } from "node:events";
import http from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import {
  createOwnedDatabase,
  dropOwnedDatabase,
  getTestPgAdminUrl,
  runNodeScript,
  sanitizedChildEnv,
} from "../helpers/runtime-test-env.mjs";

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
  const app = createApp({
    runtimeConfig: { JWT_SECRET: "test" },
    ossClient: null,
  });
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

test("routing preserves the baseline order plus explicitly approved tenant guards", async () => {
  const { createApp } = await import(appUrl);
  const expected = JSON.parse(
    await readFile(new URL("./fixtures/routes.json", import.meta.url), "utf8"),
  );
  // T1 intentionally adds role checks, a private file endpoint, and an error boundary.
  for (const route of expected.filter(
    (layer) =>
      layer.path === "/api/admin/oss/files" ||
      /^\/api\/admin\/(activities|level-applications|feedback)(\/|$)/.test(
        layer.path || "",
      ) ||
      layer.path === "/api/admin/users/:id/level",
  )) {
    route.handlers.push("<anonymous>");
  }
  const activityIndex = expected.findIndex(
    (layer) => layer.path === "/api/admin/activities",
  );
  expected.splice(activityIndex, 0, {
    path: "/api/session-files/:id",
    methods: ["get"],
    handlers: ["authMiddleware", "<anonymous>"],
  });
  expected.splice(expected.length - 1, 0, { ...expected.at(-1) });
  function signature(stack) {
    return stack.map((layer) =>
      layer.route
        ? {
            path: layer.route.path,
            methods: Object.keys(layer.route.methods),
            handlers: layer.route.stack.map((handler) => handler.name),
          }
        : {
            name: layer.name,
            regexp: String(layer.regexp),
            ...(layer.handle.stack
              ? { stack: signature(layer.handle.stack) }
              : {}),
          },
    );
  }
  assert.deepEqual(signature(createApp()._router.stack), expected);
});

test("PostgreSQL helper refuses missing admin configuration before importing pg", async () => {
  const result = await runNodeScript(`
    if (process.env.WQT_TEST_PG_ADMIN_URL) throw new Error("unexpected inherited admin URL");
    const { createOwnedDatabase } = await import(${JSON.stringify(pathToFileURL(resolve(root, "tests/helpers/runtime-test-env.mjs")).href)});
    try { await createOwnedDatabase(); throw new Error("database helper unexpectedly succeeded"); }
    catch (error) { console.log(error.message); }
  `);
  assert.equal(result.code, 0, result.stderr);
  assert.match(
    result.stdout,
    /WQT_TEST_PG_ADMIN_URL|DATABASE_URL|PostgreSQL|configuration/i,
  );
});

test("test helpers reject forged database ownership and strip inherited credentials", async () => {
  await assert.rejects(
    () =>
      dropOwnedDatabase({
        database: "wqt_r1_forged",
        adminUrl: "postgres://unused",
      }),
    /not created/,
  );
  const key = "DATABASE_URL";
  const previous = process.env[key];
  try {
    process.env[key] = "postgres://must-not-inherit";
    assert.equal(sanitizedChildEnv().DATABASE_URL, undefined);
    assert.equal(
      sanitizedChildEnv({ DATABASE_URL: "explicit" }).DATABASE_URL,
      "explicit",
    );
  } finally {
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
  }
});

test(
  "PostgreSQL runtime lifecycle is exercised in an owned database",
  { skip: !getTestPgAdminUrl() },
  async () => {
    const database = await createOwnedDatabase();
    try {
      const result = await runNodeScript(
        `await import(${JSON.stringify(pathToFileURL(resolve(root, "tests/runtime/scenarios/lifecycle.mjs")).href)});    `,
        {
          env: {
            WQT_RUNTIME_TEST_CHILD: "1",
            DATABASE_URL: database.connectionString,
            CARDS_DATABASE_URL: database.connectionString,
            CARDS_SOURCE: "postgres",
            JWT_SECRET: "wqt-r1-test-secret",
          },
        },
      );
      assert.equal(result.code, 0, result.stderr);
      assert.equal(result.timedOut, false);
      const lifecycle = JSON.parse(result.stdout.trim().split("\n").at(-1));
      assert.equal(lifecycle.listening, false);
      assert.equal(lifecycle.persisted, true);
    } finally {
      await dropOwnedDatabase(database);
    }
  },
);

function request(port, path) {
  return new Promise((resolveRequest, reject) => {
    const req = http.get({ hostname: "127.0.0.1", port, path }, (response) => {
      response.resume();
      response.once("end", () => resolveRequest(response));
    });
    req.on("error", reject);
  });
}

function close(server) {
  return new Promise((resolveClose, reject) =>
    server.close((error) => (error ? reject(error) : resolveClose())),
  );
}
