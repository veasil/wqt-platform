import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createOwnedDatabase,
  dropOwnedDatabase,
  getTestPgAdminUrl,
  runNodeScript,
} from "../helpers/runtime-test-env.mjs";

test(
  "PostgreSQL backup and restore preserves session ownership migration",
  { skip: !getTestPgAdminUrl() },
  async () => {
    const owned = [];
    try {
      owned.push(await createOwnedDatabase());
      owned.push(await createOwnedDatabase());
      owned.push(await createOwnedDatabase());
      const result = await runNodeScript(
        `const scenario = await import(${JSON.stringify(new URL("./scenarios/recovery.mjs", import.meta.url).href)}); await scenario.runRecoveryScenario();`,
        {
          env: {
            WQT_RUNTIME_TEST_CHILD: "1",
            WQT_RECOVERY_SOURCE_URL: owned[0].connectionString,
            WQT_RECOVERY_RESTORE_URL: owned[1].connectionString,
            WQT_RECOVERY_FINAL_URL: owned[2].connectionString,
          },
          timeoutMs: 120000,
        },
      );
      assert.equal(result.timedOut, false, "recovery scenario timed out");
      const diagnostic = result.stderr
        .replace(/(?:postgres(?:ql)?:\/\/)[^\s)]+/gi, "postgresql://<redacted>")
        .slice(-1500);
      assert.equal(
        result.code,
        0,
        `recovery scenario failed${diagnostic ? `: ${diagnostic}` : ""}`,
      );
      assert.match(result.stdout, /RECOVERY_SCENARIO_PASSED/);
    } finally {
      const cleanup = await Promise.allSettled(owned.map(dropOwnedDatabase));
      if (cleanup.some((result) => result.status === "rejected"))
        throw new Error("owned database cleanup failed");
    }
  },
);
