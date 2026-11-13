import pg from 'pg';
import { auditLegacyAccounts } from '../src/platform/accounts/legacy-audit.js';

const url = process.env.WQT_MIGRATION_DATABASE_URL;
if (!url) {
  console.error('WQT_MIGRATION_DATABASE_URL is required; no .env or application database fallback');
  process.exitCode = 1;
} else {
  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 5000 });
  try {
    await client.connect();
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await client.query("SET LOCAL statement_timeout = '15s'");
    const columns = (await client.query("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='game_sessions'")).rows.map(row => row.column_name);
    const historicalColumns = columns.includes('organization_id') && columns.includes('ownership_kind');
    const users = (await client.query('SELECT id, phone, role, enterprise_id FROM users')).rows;
    const sessions = (await client.query(`SELECT user_id${historicalColumns ? ', organization_id, ownership_kind' : ''} FROM game_sessions`)).rows;
    const organizations = (await client.query('SELECT id FROM organizations')).rows;
    const result = auditLegacyAccounts(users, sessions, organizations.map(row => row.id));
    await client.query('ROLLBACK');
    // Aggregate only: no phone, names, credentials, or row-level personal data.
    console.log(JSON.stringify({ historicalColumns, ...result }, null, 2));
  } catch {
    console.error('Account mapping audit failed; database/schema access needs checking. No changes were applied.');
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}
