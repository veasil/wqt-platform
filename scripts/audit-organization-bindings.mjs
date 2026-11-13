// Explicit, read-only migration inventory. Never loads .env or prints personal identifiers.
import pg from 'pg';
const connectionString=process.env.WQT_MIGRATION_DATABASE_URL;
if(!connectionString)throw new Error('Explicit WQT_MIGRATION_DATABASE_URL required');
const client=new pg.Client({connectionString});
try {
  await client.connect();
  await client.query('BEGIN READ ONLY');
  const {rows}=await client.query(`SELECT COUNT(*)::int AS duplicate_groups,
    COALESCE(SUM(n-1),0)::int AS excess_bindings FROM (
      SELECT a.organization_id,b.identity_id,COUNT(*) AS n
      FROM account_bindings b JOIN accounts a ON a.id=b.account_id
      WHERE b.ended_at IS NULL GROUP BY a.organization_id,b.identity_id HAVING COUNT(*)>1
    ) conflicts`);
  console.log(JSON.stringify({readOnly:true,...rows[0],policy:'Keep historical accounts and sessions; review duplicate bindings before migration. No automatic merge.'}));
  await client.query('ROLLBACK');
} finally {await client.end();}
