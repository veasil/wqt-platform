import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createOwnedDatabase,
  dropOwnedDatabase,
  getTestPgAdminUrl,
  runNodeScript,
} from "../helpers/runtime-test-env.mjs";

test(
  "legacy migration never infers organization from current membership; transactions roll back",
  { skip: !getTestPgAdminUrl() },
  async () => {
    const owned = await createOwnedDatabase();
    try {
      const result = await runNodeScript(
        `const scenario = await import(${JSON.stringify(new URL("./scenarios/migration.mjs", import.meta.url).href)}); await scenario.runMigrationScenario();`,
        {
          env: {
            WQT_RUNTIME_TEST_CHILD: "1",
            DATABASE_URL: owned.connectionString,
            CARDS_DATABASE_URL: owned.connectionString,
            CARDS_SOURCE: "postgres",
            JWT_SECRET: "migration-fixture",
          },
          timeoutMs: 60000,
        },
      );
      assert.equal(result.timedOut, false, result.stderr);
      assert.equal(result.code, 0, result.stderr);
      assert.match(result.stdout, /MIGRATION_SCENARIO_PASSED/);
    } finally {
      await dropOwnedDatabase(owned);
    }
  },
);

test("ownership audit refuses implicit application database configuration", async () => {
  const result = await runNodeScript(
    `const { spawnSync } = await import('node:child_process'); const child = spawnSync(process.execPath, ['scripts/audit-session-ownership.mjs'], { env: process.env, encoding: 'utf8' }); console.log(child.status); console.log(child.stderr);`,
    {
      env: { DATABASE_URL: "postgres://must-not-connect.invalid/database" },
    },
  );
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /^1\r?\n/);
  assert.match(result.stdout, /WQT_MIGRATION_DATABASE_URL is required/);
  assert.doesNotMatch(result.stdout, /must-not-connect/);
});
