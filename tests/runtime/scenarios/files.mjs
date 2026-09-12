import assert from "node:assert/strict";
import { createServer } from "node:http";
import { dbGet, dbRun } from "../../../src/db.js";
import { createApp } from "../../../src/app.js";
import { startRuntime } from "../../../src/runtime.js";
import { signToken } from "../../../src/middleware/auth.js";
import { rotateSession } from "../../../src/services/sessions.js";
import { createSessionFile } from "../../../src/integrations/media/session-files.js";

if (
  process.env.WQT_RUNTIME_TEST_CHILD !== "1" ||
  !process.env.DATABASE_URL ||
  !process.env.CARDS_DATABASE_URL
)
  throw new Error("files scenario must run through files.test.mjs");

import { PERMANENT_UNTIL as UNTIL } from "../../../src/account.js";

export async function runFilesScenario() {
  let runtime;
  let testServer;
  const fake = new FakeOss();
  try {
    runtime = await startRuntime({ port: 0, host: "127.0.0.1" });
    const users = await fixture();
    const app = createApp({
      runtimeConfig: {
        JWT_SECRET: "wqt-files-test-secret",
        SERVER_ENV: "prod",
      },
      ossClient: fake,
    });
    testServer = createServer(app);
    testServer.listen(0, "127.0.0.1");
    await new Promise((resolve, reject) => {
      testServer.once("listening", resolve);
      testServer.once("error", reject);
    });
    const base = `http://127.0.0.1:${testServer.address().port}`;
    const creatorToken = await token(users.creator);
    const adminAToken = await token(users.adminA);
    const adminBToken = await token(users.adminB);

    const audio = await multipart(
      base,
      "/api/upload/audio",
      creatorToken,
      users.sessionId,
    );
    assert.equal(audio.status, 200, JSON.stringify(audio.body));
    assert.match(audio.body.url, /^\/api\/session-files\/[0-9a-f-]{36}$/);
    assert.equal(audio.body.url.includes("oss"), false);
    const audioId = audio.body.url.split("/").at(-1);
    assert.equal(fake.privateKeys.size, 1);
    assert.equal([...fake.privateKeys.values()][0], true);

    const report = await request(
      base,
      "/api/upload/report",
      "POST",
      creatorToken,
      {
        sessionId: users.sessionId,
        html: "<h1>private report</h1>",
        markdown: "# private report",
      },
    );
    assert.equal(report.status, 200, JSON.stringify(report.body));
    assert.match(report.body.htmlUrl, /^\/api\/session-files\/[0-9a-f-]{36}$/);
    assert.match(
      report.body.markdownUrl,
      /^\/api\/session-files\/[0-9a-f-]{36}$/,
    );

    const downloaded = await request(
      base,
      `/api/session-files/${audioId}`,
      "GET",
      creatorToken,
    );
    assert.equal(downloaded.status, 200);
    assert.equal(downloaded.text, "audio bytes");
    assert.equal(
      downloaded.headers.get("content-disposition").startsWith("attachment"),
      true,
    );
    assert.equal(downloaded.headers.get("cache-control"), "private, no-store");
    assert.equal(downloaded.headers.get("x-content-type-options"), "nosniff");
    assert.equal(
      (await request(base, `/api/session-files/${audioId}`, "GET")).status,
      401,
    );

    const listed = await request(base, "/api/me/files", "GET", creatorToken);
    assert.equal(listed.status, 200, JSON.stringify(listed.body));
    assert.equal(listed.body.files.length, 3);
    assert.equal(Object.hasOwn(listed.body.files[0], "object_key"), false);

    await dbRun("UPDATE users SET enterprise_id=? WHERE id=?", [
      users.orgB,
      users.creator.id,
    ]);
    assert.equal(
      (
        await request(
          base,
          `/api/session-files/${audioId}`,
          "GET",
          creatorToken,
        )
      ).status,
      404,
    );
    assert.equal(
      (await request(base, "/api/me/files", "GET", creatorToken)).body.files
        .length,
      0,
    );
    assert.equal(
      (await request(base, `/api/session-files/${audioId}`, "GET", adminAToken))
        .status,
      200,
    );
    assert.equal(
      (await request(base, `/api/session-files/${audioId}`, "GET", adminBToken))
        .status,
      404,
    );

    assert.equal(
      (await request(base, "/api/admin/oss/files", "GET", creatorToken)).status,
      403,
    );
    assert.equal(
      (await request(base, "/api/admin/oss/files", "GET", adminAToken)).status,
      403,
    );

    const aiStory = await request(
      base,
      "/api/llm/story",
      "POST",
      creatorToken,
      { sessionId: users.sessionId, prompt: "x" },
    );
    const aiImage = await request(
      base,
      "/api/llm/image",
      "POST",
      creatorToken,
      { sessionId: users.sessionId, prompt: "x" },
    );
    assert.equal(aiStory.status, 404);
    assert.equal(aiImage.status, 404);

    await dbRun("UPDATE users SET enterprise_id=? WHERE id=?", [
      users.orgA,
      users.creator.id,
    ]);
    const race = new FakeOss();
    race.onPut = async () =>
      dbRun("UPDATE users SET enterprise_id=? WHERE id=?", [
        users.orgB,
        users.creator.id,
      ]);
    const raceFile = await import(
      "../../../src/integrations/media/session-files.js"
    );
    await assert.rejects(
      () =>
        raceFile.createSessionFile({
          userId: users.creator.id,
          sessionId: users.sessionId,
          filename: "race.webm",
          mediaType: "audio/webm",
          size: 4,
          ossClient: race,
          content: Buffer.from("race"),
        }),
      /不可访问/,
    );
    assert.equal(race.putCount, 1);
    assert.equal(race.deleteCount, 1);
    assert.equal(race.objects.size, 0);
    assert.equal(
      (
        await dbGet(
          "SELECT COUNT(*) AS count FROM session_files WHERE filename=?",
          ["race.webm"],
        )
      ).count,
      0,
    );

    await dbRun("UPDATE users SET enterprise_id=? WHERE id=?", [
      users.orgA,
      users.creator.id,
    ]);
    const failing = new FakeOss();
    await assert.rejects(() =>
      createSessionFile({
        userId: users.creator.id,
        sessionId: users.sessionId,
        filename: "invalid.webm",
        mediaType: "audio/webm",
        size: -1,
        ossClient: failing,
        content: Buffer.from("bad"),
      }),
    );
    assert.equal(failing.putCount, 1);
    assert.equal(failing.deleteCount, 1);
    assert.equal(failing.objects.size, 0);
    assert.equal(
      (
        await dbGet(
          "SELECT COUNT(*) AS count FROM session_files WHERE filename=?",
          ["invalid.webm"],
        )
      ).count,
      0,
    );
    console.log(
      JSON.stringify({ files: 3, privateObjects: fake.privateKeys.size }),
    );
  } finally {
    if (testServer) await close(testServer);
    if (runtime) await runtime.stop();
  }
}

async function fixture() {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const a = await dbRun(
    "INSERT INTO organizations(name, owner_user_id, valid_until) VALUES(?,0,?)",
    [`files-a-${suffix}`, UNTIL],
  );
  const b = await dbRun(
    "INSERT INTO organizations(name, owner_user_id, valid_until) VALUES(?,0,?)",
    [`files-b-${suffix}`, UNTIL],
  );
  const creator = await user(`creator-${suffix}`, a.lastID, "watcher");
  const adminA = await user(`admin-a-${suffix}`, a.lastID, "enterprise");
  const adminB = await user(`admin-b-${suffix}`, b.lastID, "enterprise");
  const session = await dbRun(
    "INSERT INTO game_sessions(user_id, organization_id, ownership_kind, started_at) VALUES(?,?,?,?)",
    [creator.id, a.lastID, "organization", Date.now()],
  );
  return {
    orgA: a.lastID,
    orgB: b.lastID,
    creator,
    adminA,
    adminB,
    sessionId: session.lastID,
  };
}

async function user(name, organizationId, role) {
  const result = await dbRun(
    "INSERT INTO users(username, phone, role, valid_until, enterprise_id, is_profile_complete) VALUES(?,?,?,?,?,1)",
    [
      name,
      `155${Date.now()}${Math.floor(Math.random() * 1000)}`,
      role,
      UNTIL,
      organizationId,
    ],
  );
  return {
    id: result.lastID,
    username: name,
    role,
    enterprise_id: organizationId,
  };
}

async function token(user) {
  return signToken({ ...user, jti: await rotateSession(user.id) });
}

async function multipart(base, pathname, tokenValue, sessionId) {
  const form = new FormData();
  form.append("sessionId", String(sessionId));
  form.append(
    "file",
    new Blob(["audio bytes"], { type: "audio/webm" }),
    "sample.webm",
  );
  const response = await fetch(base + pathname, {
    method: "POST",
    headers: { authorization: `Bearer ${tokenValue}` },
    body: form,
  });
  return parse(response);
}

async function request(base, pathname, method, tokenValue, body) {
  const headers = tokenValue ? { authorization: `Bearer ${tokenValue}` } : {};
  if (body) {
    headers["content-type"] = "application/json";
  }
  return parse(
    await fetch(base + pathname, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    }),
  );
}

async function parse(response) {
  const text = await response.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch (_) {}
  return { status: response.status, body, text, headers: response.headers };
}

function close(server) {
  return new Promise((resolve, reject) =>
    server.close((e) => (e ? reject(e) : resolve())),
  );
}

class FakeOss {
  constructor() {
    this.putCount = 0;
    this.deleteCount = 0;
    this.objects = new Map();
    this.privateKeys = new Map();
    this.onPut = null;
  }
  async put(key, content, options = {}) {
    this.putCount++;
    if (this.onPut) await this.onPut();
    this.objects.set(key, Buffer.from(content));
    this.privateKeys.set(
      key,
      options.headers?.["x-oss-object-acl"] === "private",
    );
    return { name: key };
  }
  async get(key) {
    if (!this.objects.has(key)) throw new Error("missing");
    return { content: this.objects.get(key) };
  }
  async delete(key) {
    this.deleteCount++;
    this.objects.delete(key);
    this.privateKeys.delete(key);
    return {};
  }
  async list() {
    throw new Error(
      "The user file list must use metadata, not bucket prefixes",
    );
  }
}
