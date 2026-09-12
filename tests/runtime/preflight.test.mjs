import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createOwnedDatabase,
  dropOwnedDatabase,
  getTestPgAdminUrl,
  runNodeScript,
} from "../helpers/runtime-test-env.mjs";

test(
  "staging preflight is read-only and rejects copied settings before runtime writes",
  { skip: !getTestPgAdminUrl() },
  async () => {
    const owned = await createOwnedDatabase();
    const target = new URL(owned.connectionString);
    try {
      const result = await runNodeScript(
        `
      import assert from 'node:assert/strict';
      import pg from 'pg';
      import { preflightStartup } from './src/startup-guards.js';
      import { startRuntime } from './src/runtime.js';
      const client = new pg.Client({connectionString:process.env.DATABASE_URL, connectionTimeoutMillis:5000});
      await client.connect();
      try {
        await preflightStartup();
        assert.equal((await client.query("SELECT count(*)::int AS n FROM pg_tables WHERE schemaname='public'")).rows[0].n,0);
        await client.query('CREATE TABLE system_settings(key TEXT PRIMARY KEY,value TEXT,description TEXT)');
        await client.query("INSERT INTO system_settings(key,value) VALUES ('BMOB_REST_KEY','copied-secret-must-not-escape')");
        await assert.rejects(startRuntime({port:0,host:'127.0.0.1'}), e => /database setting BMOB_REST_KEY/.test(e.message) && !e.message.includes('copied-secret'));
        assert.equal((await client.query("SELECT to_regclass('public.users') AS name")).rows[0].name,null);
        assert.equal((await client.query("SELECT value FROM system_settings WHERE key='BMOB_REST_KEY'")).rows[0].value,'copied-secret-must-not-escape');
        await client.query('DELETE FROM system_settings');
        await preflightStartup();
        assert.equal((await client.query("SELECT to_regclass('public.game_sessions') AS name")).rows[0].name,null);
        const runtime = await startRuntime({port:0,host:'127.0.0.1'});
        try {
          const response = await fetch('http://127.0.0.1:' + runtime.server.address().port + '/api/settings');
          assert.equal(response.status,200);
          await response.arrayBuffer();
        } finally { await runtime.stop(); }
        console.log('PREFLIGHT_READ_ONLY_PASSED');
      } finally { await client.end(); }
    `,
        {
          env: {
            NODE_ENV: "production",
            SERVER_ENV: "staging",
            DATABASE_URL: owned.connectionString,
            CARDS_DATABASE_URL: owned.connectionString,
            CARDS_SOURCE: "postgres",
            JWT_SECRET: "preflight-isolated-strong-fixture-key-2026",
            SETTINGS_ENCRYPTION_KEY: "0123456789abcdef".repeat(4),
            WQT_EXPECTED_MAIN_HOST: target.hostname,
            WQT_EXPECTED_CARDS_HOST: target.hostname,
            WQT_EXPECTED_MAIN_DATABASE: owned.database,
            WQT_EXPECTED_CARDS_DATABASE: owned.database,
            WQT_EXPECTED_OSS_BUCKET: "wqt-preflight-fixture",
            OSS_BUCKET_NAME: "wqt-preflight-fixture",
            OSS_REGION: "oss-cn-hongkong",
            BMOB_APP_ID: "fixture-app",
            BMOB_REST_KEY: "fixture-key",
            ALIBABA_CLOUD_ACCESS_KEY_ID: "fixture-id",
            ALIBABA_CLOUD_ACCESS_KEY_SECRET: "fixture-key",
          },
          timeoutMs: 60000,
        },
      );
      assert.equal(result.code, 0, result.stderr);
      assert.equal(result.timedOut, false);
      assert.match(result.stdout, /PREFLIGHT_READ_ONLY_PASSED/);
    } finally {
      await dropOwnedDatabase(owned);
    }
  },
);
