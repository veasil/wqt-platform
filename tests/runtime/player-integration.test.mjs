import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createOwnedDatabase,
  dropOwnedDatabase,
  getTestPgAdminUrl,
  runNodeScript,
} from "../helpers/runtime-test-env.mjs";
test(
  "new player runtime and browser integrate real account, state, feedback and downloads",
  { skip: !getTestPgAdminUrl() || !process.env.WQT_TEST_REDIS_URL },
  async () => {
    const owned = await createOwnedDatabase();
    try {
      const result = await runNodeScript(
        `const {run}=await import(${JSON.stringify(new URL("./scenarios/player-integration.mjs", import.meta.url).href)});await run();`,
        {
          env: {
            WQT_RUNTIME_TEST_CHILD: "1",
            WQT_ACCOUNT_MODEL: "accounts",
            DATABASE_URL: owned.connectionString,
            CARDS_DATABASE_URL: owned.connectionString,
            CARDS_SOURCE: "postgres",
            JWT_SECRET: "player-test-synthetic-secret",
            REDIS_URL: process.env.WQT_TEST_REDIS_URL,
            WQT_REDIS_NAMESPACE: owned.database,
          },
          timeoutMs: 90000,
        },
      );
      assert.equal(result.code, 0, result.stderr + "\n" + result.stdout);
      assert.match(result.stdout, /PLAYER_INTEGRATION_OK/);
    } finally {
      await dropOwnedDatabase(owned);
    }
  },
);
