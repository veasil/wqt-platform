import pg from "pg";
import { pathToFileURL } from "node:url";

const { Client } = pg;

/**
 * Read-only ownership inventory. The caller must provide an already connected client.
 * No session, user, phone, URL, or other identifying values are returned.
 */
export async function auditSessionOwnership(client) {
  let inTransaction = false;
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    inTransaction = true;

    const schema = await client.query(
      `SELECT table_name, column_name
         FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name IN ('game_sessions', 'activities')
          AND column_name IN ('organization_id', 'ownership_kind', 'enterprise_id')`,
    );
    const columns = new Set(
      schema.rows.map((row) => `${row.table_name}.${row.column_name}`),
    );
    const hasOwnership =
      columns.has("game_sessions.organization_id") &&
      columns.has("game_sessions.ownership_kind");

    const totalResult = await client.query(
      "SELECT COUNT(*)::bigint AS count FROM game_sessions",
    );
    const total = Number(totalResult.rows[0]?.count || 0);
    let counts = { organization: 0, personal: 0, legacy_unknown: total };
    let currentMembershipHints = 0;
    let activityOrgHints = 0;
    let conflictingActivityOrgHints = 0;

    if (hasOwnership) {
      const grouped = await client.query(
        `SELECT ownership_kind, COUNT(*)::bigint AS count
           FROM game_sessions
          GROUP BY ownership_kind`,
      );
      counts = { organization: 0, personal: 0, legacy_unknown: 0 };
      for (const row of grouped.rows) {
        if (row.ownership_kind === "organization")
          counts.organization += Number(row.count);
        else if (row.ownership_kind === "personal")
          counts.personal += Number(row.count);
        else counts.legacy_unknown += Number(row.count);
      }
    }

    const unknown = hasOwnership
      ? "s.ownership_kind = 'legacy_unknown'"
      : "TRUE";
    const membership = await client.query(
      `SELECT COUNT(*)::bigint AS count FROM game_sessions s JOIN users u ON u.id = s.user_id WHERE ${unknown} AND u.enterprise_id IS NOT NULL`,
    );
    currentMembershipHints = Number(membership.rows[0].count);
    if (columns.has("activities.enterprise_id")) {
      const hints =
        await client.query(`SELECT COUNT(*)::bigint AS count FROM game_sessions s
        WHERE ${unknown} AND EXISTS (SELECT 1 FROM activity_sessions x JOIN activities a ON a.id=x.activity_id WHERE x.session_id=s.id AND a.enterprise_id IS NOT NULL)`);
      activityOrgHints = Number(hints.rows[0].count);
      const knownConflict = hasOwnership
        ? "OR (s.ownership_kind <> 'legacy_unknown' AND EXISTS (SELECT 1 FROM activity_sessions x JOIN activities a ON a.id=x.activity_id WHERE x.session_id=s.id AND a.enterprise_id IS NOT NULL AND (s.ownership_kind = 'personal' OR a.enterprise_id IS DISTINCT FROM s.organization_id)))"
        : "";
      const conflicts =
        await client.query(`SELECT COUNT(*)::bigint AS count FROM game_sessions s WHERE
        (SELECT COUNT(DISTINCT a.enterprise_id) FROM activity_sessions x JOIN activities a ON a.id=x.activity_id WHERE x.session_id=s.id) > 1 ${knownConflict}`);
      conflictingActivityOrgHints = Number(conflicts.rows[0].count);
    }

    const orphan = await client.query(
      `SELECT COUNT(*)::bigint AS count
         FROM game_sessions s
         LEFT JOIN users u ON u.id = s.user_id
        WHERE u.id IS NULL`,
    );

    const result = {
      schema: {
        game_sessions: {
          organization_id: columns.has("game_sessions.organization_id"),
          ownership_kind: columns.has("game_sessions.ownership_kind"),
        },
        activities: { enterprise_id: columns.has("activities.enterprise_id") },
      },
      total,
      organization: counts.organization,
      personal: counts.personal,
      legacy_unknown: counts.legacy_unknown,
      currentMembershipHints,
      activityOrgHints,
      conflictingActivityOrgHints,
      orphanCreator: Number(orphan.rows[0]?.count || 0),
    };
    await client.query("COMMIT");
    inTransaction = false;
    return result;
  } catch (error) {
    if (inTransaction) await client.query("ROLLBACK").catch(() => {});
    throw error;
  }
}

async function main() {
  const connectionString = process.env.WQT_MIGRATION_DATABASE_URL;
  if (!connectionString)
    throw new Error("WQT_MIGRATION_DATABASE_URL is required");
  const client = new Client({
    connectionString,
    connectionTimeoutMillis: 5000,
  });
  try {
    await client.connect();
    process.stdout.write(
      `${JSON.stringify(await auditSessionOwnership(client))}\n`,
    );
  } finally {
    await client.end().catch(() => {});
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    const detail = !process.env.WQT_MIGRATION_DATABASE_URL
      ? "WQT_MIGRATION_DATABASE_URL is required"
      : `database inspection failed (${/^[A-Z0-9_]+$/i.test(error.code || "") ? error.code : "UNKNOWN"})`;
    process.stderr.write(`ownership audit failed: ${detail}\n`);
    process.exitCode = 1;
  });
}
