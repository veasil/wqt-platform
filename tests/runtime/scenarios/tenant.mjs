import assert from "node:assert/strict";
import { dbGet, dbRun } from "../../../src/db.js";
import { rotateSession } from "../../../src/services/sessions.js";
import { signToken } from "../../../src/middleware/auth.js";
import { startRuntime } from "../../../src/runtime.js";

if (
  process.env.WQT_RUNTIME_TEST_CHILD !== "1" ||
  !process.env.DATABASE_URL ||
  !process.env.CARDS_DATABASE_URL
)
  throw new Error(
    "Run tenant scenario through the owned database test harness",
  );

import { PERMANENT_UNTIL as UNTIL } from "../../../src/account.js";
let phoneSequence = 0;

export async function runTenantScenario() {
  let runtime = await startRuntime({ port: 0, host: "127.0.0.1" });
  let base = runtimeBase(runtime);
  try {
    const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    const orgARun = await dbRun(
      "INSERT INTO organizations(name, owner_user_id, valid_until) VALUES(?, 0, ?)",
      [`tenant-a-${suffix}`, UNTIL],
    );
    const orgBRun = await dbRun(
      "INSERT INTO organizations(name, owner_user_id, valid_until) VALUES(?, 0, ?)",
      [`tenant-b-${suffix}`, UNTIL],
    );
    const orgA = { id: orgARun.lastID };
    const orgB = { id: orgBRun.lastID };
    const creator = await user(`creator-${suffix}`, orgA.id);
    const adminA = await user(`admin-a-${suffix}`, orgA.id, "enterprise");
    const adminB = await user(`admin-b-${suffix}`, orgB.id, "enterprise");
    await dbRun("UPDATE organizations SET owner_user_id=? WHERE id=?", [
      creator.id,
      orgA.id,
    ]);
    const creatorToken = await token(creator);
    const adminAToken = await token(adminA);
    const adminBToken = await token(adminB);

    const activityA = await activity(
      `activity-a-${suffix}`,
      orgA.id,
      creator.id,
    );
    const activityB = await activity(
      `activity-b-${suffix}`,
      orgB.id,
      adminB.id,
    );
    const personalActivity = await activity(
      `activity-personal-${suffix}`,
      null,
      creator.id,
    );

    const started = await json(base, "/api/game/start", "POST", creatorToken, {
      mode: "tenant-r1",
      activityCode: activityA.code,
    });
    assert.equal(started.status, 200, JSON.stringify(started.body));
    const sessionId = started.body.sessionId;
    assert.ok(sessionId);
    assert.deepEqual(
      await dbGet(
        "SELECT organization_id, ownership_kind FROM game_sessions WHERE id=?",
        [sessionId],
      ),
      { organization_id: orgA.id, ownership_kind: "organization" },
    );
    assert.equal(
      (
        await json(base, "/api/game/event", "POST", creatorToken, {
          sessionId,
          type: "fixture",
          payload: {},
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await json(base, "/api/game/finish", "POST", creatorToken, {
          sessionId,
          finalScore: 7,
        })
      ).status,
      200,
    );

    const join1 = await json(
      base,
      "/api/game/join-activity",
      "POST",
      creatorToken,
      { activity_code: activityA.code, session_id: sessionId },
    );
    const join2 = await json(
      base,
      "/api/game/join-activity",
      "POST",
      creatorToken,
      { activity_code: activityA.code, session_id: sessionId },
    );
    assert.equal(join1.status, 200, JSON.stringify(join1.body));
    assert.equal(join2.status, 200, JSON.stringify(join2.body));
    assert.equal(join1.body.table_no, join2.body.table_no);
    assert.equal(
      (
        await dbGet(
          "SELECT COUNT(*) AS count FROM activity_sessions WHERE activity_id=? AND session_id=?",
          [activityA.id, sessionId],
        )
      ).count,
      1,
    );

    await dbRun("UPDATE users SET enterprise_id=? WHERE id=?", [
      orgB.id,
      creator.id,
    ]);
    assert.equal(
      (await json(base, `/api/game/session/${sessionId}`, "GET", creatorToken))
        .status,
      404,
    );
    const last = await json(
      base,
      "/api/game/last-session",
      "GET",
      creatorToken,
    );
    assert.equal(last.status, 200);
    assert.equal(last.body.session, null);
    assert.equal(
      (
        await json(base, "/api/game/finish", "POST", creatorToken, {
          sessionId,
          finalScore: 8,
        })
      ).status,
      404,
    );
    assert.equal(
      (
        await json(base, "/api/game/event", "POST", creatorToken, {
          sessionId,
          type: "after-transfer",
        })
      ).status,
      404,
    );
    assert.equal(
      (await json(base, `/api/game/session/${sessionId}`, "GET", adminAToken))
        .status,
      200,
    );
    assert.equal(
      (await json(base, `/api/game/session/${sessionId}`, "GET", adminBToken))
        .status,
      404,
    );

    const dashA = await json(
      base,
      "/api/enterprise/dashboard",
      "GET",
      adminAToken,
    );
    const dashB = await json(
      base,
      "/api/enterprise/dashboard",
      "GET",
      adminBToken,
    );
    assert.equal(dashA.status, 200);
    assert.equal(dashB.status, 200);
    assert.equal(Number(dashA.body.totalSessions), 1);
    assert.equal(Number(dashB.body.totalSessions), 0);
    const listA = await json(
      base,
      "/api/enterprise/sessions",
      "GET",
      adminAToken,
    );
    const listB = await json(
      base,
      "/api/enterprise/sessions",
      "GET",
      adminBToken,
    );
    assert.equal(listA.status, 200, JSON.stringify(listA.body));
    assert.equal(listB.status, 200, JSON.stringify(listB.body));
    assert.equal(listA.body.total, 1);
    assert.equal(listB.body.total, 0);
    assert.equal(listA.body.sessions.length, 1);
    assert.equal(listB.body.sessions.length, 0);
    assert.equal((await json(base, "/api/enterprise/members", "GET", adminAToken)).status, 200);
    const memberStats = await json(base, `/api/enterprise/members/${creator.id}/stats`, "GET", adminBToken);
    assert.equal(memberStats.status, 200, JSON.stringify(memberStats.body));
    assert.equal(memberStats.body.stats.totalGames, 0);
    const ownActivities = await json(base, "/api/me/activities", "GET", creatorToken);
    assert.equal(ownActivities.status, 200, JSON.stringify(ownActivities.body));
    assert.equal(ownActivities.body.activities.length, 0);
    const ownSessions = await json(base, "/api/me/sessions", "GET", creatorToken);
    assert.equal(ownSessions.status, 200, JSON.stringify(ownSessions.body));
    assert.equal(ownSessions.body.total, 0);

    // Existing dirty associations must not leak A's session through B's activity queries.
    await dbRun("INSERT INTO activity_sessions(activity_id, session_id, table_no) VALUES(?,?,99)", [activityB.id, sessionId]);
    const activityDetailB = await json(base, `/api/enterprise/activities/${activityB.id}/sessions`, "GET", adminBToken);
    assert.equal(activityDetailB.status, 200, JSON.stringify(activityDetailB.body));
    assert.equal(activityDetailB.body.sessions.length, 0);
    const activitiesB = await json(base, "/api/enterprise/activities", "GET", adminBToken);
    assert.equal(activitiesB.status, 200, JSON.stringify(activitiesB.body));
    assert.equal(activitiesB.body.activities.find(activity => activity.id === activityB.id).table_count, 0);
    const platformBoss = await user(`platform-boss-${suffix}`, null, "boss");
    const deleteCreator = await json(base, `/api/admin/users/${creator.id}`, "DELETE", await token(platformBoss));
    assert.equal(deleteCreator.status, 409);
    assert.ok(await dbGet("SELECT id FROM game_sessions WHERE id=?", [sessionId]));

    const personal = await user(`personal-${suffix}`, null);
    const personalToken = await token(personal);
    const personalStart = await json(
      base,
      "/api/game/start",
      "POST",
      personalToken,
      { mode: "personal" },
    );
    assert.equal(personalStart.status, 200);
    await dbRun("UPDATE users SET enterprise_id=? WHERE id=?", [
      orgB.id,
      personal.id,
    ]);
    assert.equal(
      (
        await json(
          base,
          `/api/game/session/${personalStart.body.sessionId}`,
          "GET",
          personalToken,
        )
      ).status,
      200,
    );
    assert.equal(
      (await json(base, "/api/enterprise/sessions", "GET", adminBToken)).body
        .sessions.length,
      0,
    );

    const legacyRun = await dbRun(
      "INSERT INTO game_sessions(user_id, started_at, ownership_kind) VALUES(?,?,?)",
      [personal.id, Date.now(), "legacy_unknown"],
    );
    const legacy = { id: legacyRun.lastID };
    assert.equal(
      (await json(base, `/api/game/session/${legacy.id}`, "GET", personalToken))
        .status,
      404,
    );
    assert.equal(
      (await json(base, "/api/enterprise/sessions", "GET", adminBToken)).body
        .sessions.length,
      0,
    );
    assert.deepEqual(
      await dbGet(
        "SELECT organization_id, ownership_kind FROM game_sessions WHERE id=?",
        [legacy.id],
      ),
      { organization_id: null, ownership_kind: "legacy_unknown" },
    );

    const aSession = await json(base, "/api/game/start", "POST", adminAToken, {
      mode: "activity-a",
    });
    assert.equal(aSession.status, 200);
    const cross = await json(
      base,
      "/api/game/join-activity",
      "POST",
      adminAToken,
      { activity_code: activityB.code, session_id: aSession.body.sessionId },
    );
    const personalLink = await json(
      base,
      "/api/game/join-activity",
      "POST",
      personalToken,
      {
        activity_code: activityB.code,
        session_id: personalStart.body.sessionId,
      },
    );
    assert.equal(cross.status, 403);
    assert.equal(personalLink.status, 403);
    assert.equal(
      (
        await dbGet(
          "SELECT COUNT(*) AS count FROM activity_sessions WHERE session_id=?",
          [aSession.body.sessionId],
        )
      ).count,
      0,
    );
    assert.equal(
      (
        await json(base, "/api/game/event", "POST", adminBToken, {
          sessionId: aSession.body.sessionId,
          type: "attack",
        })
      ).status,
      404,
    );
    assert.equal(
      (
        await json(base, "/api/game/finish", "POST", adminBToken, {
          sessionId: aSession.body.sessionId,
          finalScore: 1,
        })
      ).status,
      404,
    );

    const allowedPublic = await json(
      base,
      "/api/game/join-activity",
      "POST",
      adminAToken,
      {
        activity_code: personalActivity.code,
        session_id: aSession.body.sessionId,
      },
    );
    assert.equal(allowedPublic.status, 200);
    const beforeRejectedStart = await dbGet(
      "SELECT COUNT(*) AS count FROM game_sessions",
    );
    assert.equal(
      (
        await json(base, "/api/game/start", "POST", adminAToken, {
          activityCode: activityB.code,
        })
      ).status,
      403,
    );
    assert.equal(
      (await dbGet("SELECT COUNT(*) AS count FROM game_sessions")).count,
      beforeRejectedStart.count,
    );
    assert.equal(
      (await json(base, "/api/admin/activities", "GET", creatorToken)).status,
      403,
    );
    assert.equal(
      (await json(base, "/api/admin/feedback", "GET", creatorToken)).status,
      403,
    );
    const publicActivity = await json(
      base,
      `/api/activities/by-code/${activityA.code}?withSessions=1`,
      "GET",
      null,
    );
    assert.equal(publicActivity.status, 200);
    assert.equal(publicActivity.body.sessions, undefined);

    await assert.rejects(
      () =>
        dbRun("UPDATE game_sessions SET organization_id=? WHERE id=?", [
          orgB.id,
          sessionId,
        ]),
      /immutable|23514|ownership/i,
    );
    const stable = await dbGet(
      "SELECT organization_id, ownership_kind FROM game_sessions WHERE id=?",
      [sessionId],
    );
    await runtime.stop();
    runtime = await startRuntime({ port: 0, host: "127.0.0.1" });
    base = runtimeBase(runtime);
    console.log("TENANT_SCENARIO_PASSED");
    assert.deepEqual(
      await dbGet(
        "SELECT organization_id, ownership_kind FROM game_sessions WHERE id=?",
        [sessionId],
      ),
      stable,
    );
  } finally {
    if (runtime?.server?.listening) await runtime.stop();
  }
}

function runtimeBase(runtime) {
  return `http://127.0.0.1:${runtime.server.address().port}`;
}

async function user(name, organizationId, role = "watcher") {
  const phone = `155${String(Date.now()).slice(-8)}${String(++phoneSequence).padStart(2, "0")}`;
  const result = await dbRun(
    "INSERT INTO users(username, phone, role, watcher_level, valid_until, enterprise_id, is_profile_complete) VALUES(?,?,?,?,?,?,1)",
    [name, phone, role, "initial", UNTIL, organizationId],
  );
  return {
    id: result.lastID,
    username: name,
    phone,
    role,
    enterprise_id: organizationId,
  };
}

async function activity(name, organizationId, creatorId) {
  const code = `T${++phoneSequence}${Date.now().toString(36).toUpperCase()}`;
  const result = await dbRun(
    "INSERT INTO activities(name, activity_code, started_at, created_by, enterprise_id, status) VALUES(?,?,?,?,?,'active')",
    [name, code, Date.now(), creatorId, organizationId],
  );
  return { id: result.lastID, code };
}

async function token(userRow) {
  return signToken({ ...userRow, jti: await rotateSession(userRow.id) });
}

async function json(base, pathname, method, tokenValue, body) {
  const headers = {};
  if (tokenValue) headers.authorization = `Bearer ${tokenValue}`;
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
