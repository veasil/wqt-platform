import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createOwnedDatabase,
  dropOwnedDatabase,
  getTestPgAdminUrl,
  runNodeScript,
} from "../helpers/runtime-test-env.mjs";

test(
  "authentication routes enforce complete credentials, session rules, and public settings allowlist",
  { skip: !getTestPgAdminUrl() },
  async () => {
    const owned = await createOwnedDatabase();
    try {
      const result = await runNodeScript(
        `const scenario = await import(${JSON.stringify(new URL("./scenarios/authentication.mjs", import.meta.url).href)}); await scenario.runAuthenticationScenario();`,
        {
          env: {
            WQT_RUNTIME_TEST_CHILD: "1",
            DATABASE_URL: owned.connectionString,
            CARDS_DATABASE_URL: owned.connectionString,
            CARDS_SOURCE: "postgres",
            JWT_SECRET: "wqt-auth-test-secret",
            SERVER_ENV: "prod",
            NODE_ENV: "test",
          },
          timeoutMs: 60_000,
        },
      );
      assert.equal(result.timedOut, false, result.stderr);
      assert.equal(result.code, 0, result.stderr);
      assert.match(result.stdout, /"adminLogin":true/);
    } finally {
      await dropOwnedDatabase(owned);
    }
  },
);
