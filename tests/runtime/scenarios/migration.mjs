import assert from "node:assert/strict";
import pg from "pg";
import { startRuntime } from "../../../src/runtime.js";
import { dbRun, dbGet, withTransaction } from "../../../src/db.js";
import { PERMANENT_UNTIL } from "../../../src/account.js";
import { startSession } from "../../../src/game/sessions/service.js";
import { auditSessionOwnership } from "../../../scripts/audit-session-ownership.mjs";

if (
  process.env.WQT_RUNTIME_TEST_CHILD !== "1" ||
  !process.env.DATABASE_URL ||
  !process.env.CARDS_DATABASE_URL
)
  throw new Error("Use the owned database test harness");

export async function runMigrationScenario() {
  let runtime = await startRuntime({ port: 0, host: "127.0.0.1" });
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const org = await dbRun(
      "INSERT INTO organizations(name, owner_user_id, valid_until) VALUES('migration-org',0,?)",
      [PERMANENT_UNTIL],
    );
    const user = await dbRun(
      "INSERT INTO users(username, enterprise_id) VALUES('migration-creator',?)",
      [org.lastID],
    );
    await runtime.stop();
    // Reconstruct the pre-T1 schema only inside the database this test created.
    await client.query("DROP TABLE session_files");
    await client.query(
      "DROP TRIGGER game_sessions_immutable_ownership ON game_sessions",
    );
    await client.query(
      "ALTER TABLE game_sessions DROP COLUMN organization_id CASCADE, DROP COLUMN ownership_kind CASCADE",
    );
    const old = await client.query(
      "INSERT INTO game_sessions(user_id, started_at) VALUES($1,$2) RETURNING id",
      [user.lastID, Date.now()],
    );
    const before = await auditSessionOwnership(client);
    assert.equal(before.total, 1);
    assert.equal(before.legacy_unknown, 1);
    assert.equal(before.currentMembershipHints, 1);
    runtime = await startRuntime({ port: 0, host: "127.0.0.1" });
    assert.deepEqual(
      await dbGet(
        "SELECT organization_id, ownership_kind FROM game_sessions WHERE id=?",
        [old.rows[0].id],
      ),
      { organization_id: null, ownership_kind: "legacy_unknown" },
    );
    const after = await auditSessionOwnership(client);
    assert.equal(after.total, 1);
    assert.equal(
      after.organization,
      0,
      "The current member relationship is not historical proof",
    );
    assert.equal(after.legacy_unknown, 1);
    const fresh = await startSession(user.lastID, {});
    assert.equal(
      (
        await dbGet("SELECT organization_id FROM game_sessions WHERE id=?", [
          fresh.sessionId,
        ])
      ).organization_id,
      org.lastID,
    );

    // BEGIN and writes share one connection; throwing must roll back all changes.
    await assert.rejects(
      () =>
        withTransaction(async (tx) => {
          await tx.run("UPDATE users SET username='must-rollback' WHERE id=?", [
            user.lastID,
          ]);
          throw new Error("fixture rollback");
        }),
      /fixture rollback/,
    );
    assert.equal(
      (await dbGet("SELECT username FROM users WHERE id=?", [user.lastID]))
        .username,
      "migration-creator",
    );
    console.log("MIGRATION_SCENARIO_PASSED");
  } finally {
    await client.end();
    await runtime.stop();
  }
}
