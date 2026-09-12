import assert from "node:assert/strict";
import {
  initCardsDb,
  closeCardsDb,
  cardsDbGet,
} from "../../../src/cards-db.js";
import {
  closeDb,
  dbAll,
  dbGet,
  initDb,
  withTransaction,
} from "../../../src/db.js";
import { seedSyntheticData } from "../../../src/development/synthetic-data.js";

if (process.env.WQT_RUNTIME_TEST_CHILD !== "1")
  throw new Error("synthetic scenario must run in a child");

export async function runSyntheticDataScenario() {
  try {
    await initDb({ connectionString: process.env.DATABASE_URL });
    await initCardsDb({
      source: "postgres",
      connectionString: process.env.CARDS_DATABASE_URL,
    });
    const password = "synthetic-password-2026";
    let rolledBack = false;
    await assert.rejects(
      withTransaction(async (tx) => {
        await seedSyntheticData(tx, { password });
        throw new Error("synthetic fixture rollback probe");
      }),
      /rollback probe/,
    );
    rolledBack =
      (await dbGet("SELECT COUNT(*)::int AS count FROM users")).count === 0;
    assert.equal(rolledBack, true);

    const ids = await withTransaction((tx) =>
      seedSyntheticData(tx, { password }),
    );
    assert.ok(ids.users.boss && ids.organizations.orgA);
    assert.equal(
      (await dbGet("SELECT COUNT(*)::int AS count FROM users")).count,
      5,
    );
    assert.equal(
      (await dbGet("SELECT COUNT(*)::int AS count FROM organizations")).count,
      2,
    );
    assert.equal(
      (await dbGet("SELECT COUNT(*)::int AS count FROM game_sessions")).count,
      4,
    );
    assert.equal(
      (
        await dbGet(
          "SELECT COUNT(*)::int AS count FROM game_events WHERE type='card_choice'",
        )
      ).count,
      2,
    );
    assert.equal(
      (await dbGet("SELECT COUNT(*)::int AS count FROM activity_sessions"))
        .count,
      3,
    );
    assert.equal(
      (await dbGet("SELECT COUNT(*)::int AS count FROM session_files")).count,
      0,
    );
    assert.equal(
      (await dbGet("SELECT COUNT(*)::int AS count FROM user_sessions")).count,
      0,
    );
    assert.equal(
      (await dbGet("SELECT role FROM users WHERE id=?", [ids.users.adminA]))
        .role,
      "enterprise",
    );
    assert.equal(
      (await dbGet("SELECT role FROM users WHERE id=?", [ids.users.adminB]))
        .role,
      "enterprise",
    );
    assert.equal(
      (
        await dbGet("SELECT owner_user_id FROM organizations WHERE id=?", [
          ids.organizations.orgA,
        ])
      ).owner_user_id,
      ids.users.adminA,
    );
    assert.equal(
      (
        await dbGet("SELECT enterprise_id FROM users WHERE id=?", [
          ids.users.memberA,
        ])
      ).enterprise_id,
      ids.organizations.orgA,
    );
    assert.equal(
      (
        await dbGet("SELECT ownership_kind FROM game_sessions WHERE id=?", [
          ids.sessions.legacyUnknown,
        ])
      ).ownership_kind,
      "legacy_unknown",
    );
    assert.ok(
      await cardsDbGet(
        "SELECT 1 FROM information_schema.tables WHERE table_name='cards'",
      ),
    );

    const before = await snapshot();
    await assert.rejects(
      withTransaction((tx) => seedSyntheticData(tx, { password })),
      /requires empty domain tables/,
    );
    assert.deepEqual(await snapshot(), before);
    await assert.rejects(
      withTransaction((tx) => seedSyntheticData(tx, { password: "short" })),
      /at least 12/,
    );
    console.log("SYNTHETIC_DATA_SCENARIO_PASSED");
  } finally {
    const cleanup = await Promise.allSettled([closeCardsDb(), closeDb()]);
    const failed = cleanup.find((result) => result.status === "rejected");
    if (failed) throw failed.reason;
  }
}

async function snapshot() {
  const tables = [
    "users",
    "organizations",
    "game_sessions",
    "activities",
    "user_feedback",
    "user_sessions",
    "session_files",
    "game_events",
    "activity_sessions",
  ];
  const rows = {};
  for (const table of tables)
    rows[table] = (
      await dbAll(`SELECT COUNT(*)::int AS count FROM ${table}`)
    )[0].count;
  return rows;
}
