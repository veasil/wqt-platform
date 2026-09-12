import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createOwnedDatabase,
  dropOwnedDatabase,
  getTestPgAdminUrl,
  runNodeScript,
} from "../helpers/runtime-test-env.mjs";

test(
  "tenant ownership and migration invariants survive runtime restart",
  { skip: !getTestPgAdminUrl() },
  async () => {
    const owned = await createOwnedDatabase();
    try {
      const result = await runNodeScript(
        `
      process.env.WQT_RUNTIME_TEST_CHILD = "1";
      const { runTenantScenario } = await import(${JSON.stringify(new URL("./scenarios/tenant.mjs", import.meta.url).href)});
      await runTenantScenario();
    `,
        {
          env: {
            DATABASE_URL: owned.connectionString,
            CARDS_DATABASE_URL: owned.connectionString,
            CARDS_SOURCE: "postgres",
            JWT_SECRET: "wqt-r1-tenant-test-secret",
            WQT_RUNTIME_TEST_CHILD: "1",
          },
          timeoutMs: 60_000,
        },
      );
      assert.equal(result.timedOut, false, result.stderr);
      assert.equal(result.code, 0, result.stderr);
      assert.match(result.stdout, /TENANT_SCENARIO_PASSED/);
    } finally {
      await dropOwnedDatabase(owned);
    }
  },
);
