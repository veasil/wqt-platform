import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createOwnedDatabase,
  dropOwnedDatabase,
  getTestPgAdminUrl,
  runNodeScript,
} from "../helpers/runtime-test-env.mjs";

test(
  "synthetic seed populates a complete isolated domain and is atomic",
  { skip: !getTestPgAdminUrl() },
  async () => {
    const owned = await createOwnedDatabase();
    try {
      const result = await runNodeScript(
        `const scenario = await import(${JSON.stringify(new URL("./scenarios/synthetic-data.mjs", import.meta.url).href)}); await scenario.runSyntheticDataScenario();`,
        {
          env: {
            WQT_RUNTIME_TEST_CHILD: "1",
            DATABASE_URL: owned.connectionString,
            CARDS_DATABASE_URL: owned.connectionString,
            CARDS_SOURCE: "postgres",
          },
          timeoutMs: 60000,
        },
      );
      assert.equal(result.timedOut, false, result.stderr);
      assert.equal(result.code, 0, result.stderr);
      assert.match(result.stdout, /SYNTHETIC_DATA_SCENARIO_PASSED/);
    } finally {
      await dropOwnedDatabase(owned);
    }
  },
);
