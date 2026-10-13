// 统计「未设置密码、无法用三要素登录」的账号
// 用法（在服务器项目根目录）：node scripts/count_passwordless_users.mjs
// 依赖：.env 中的 DATABASE_URL（或 PG_MAIN_URL）
import dotenv from "dotenv";
import { createPool } from "../src/sql-pg.js";

dotenv.config();

const CONN = process.env.DATABASE_URL || process.env.PG_MAIN_URL;
if (!CONN) {
  console.error("❌ 未找到 DATABASE_URL / PG_MAIN_URL，请确认 .env");
  process.exit(1);
}

const pool = createPool(CONN);

const summary = await pool.query(`
  SELECT
    count(*)                                                              AS total_users,
    count(*) FILTER (WHERE password_hash IS NULL OR password_hash = '')   AS no_password,
    count(*) FILTER (WHERE phone IS NOT NULL AND (password_hash IS NULL OR password_hash = '')) AS no_password_with_phone
  FROM users
`);
console.log("\n=== 汇总 ===");
console.table(summary.rows);

const byRole = await pool.query(`
  SELECT role, count(*) AS no_password_count
  FROM users
  WHERE password_hash IS NULL OR password_hash = ''
  GROUP BY role
  ORDER BY no_password_count DESC
`);
console.log("=== 按角色分布（无密码）===");
console.table(byRole.rows);

const list = await pool.query(`
  SELECT id, phone, role, guardian_name, real_name, enterprise_id,
         to_char(to_timestamp(created_at/1000), 'YYYY-MM-DD') AS created
  FROM users
  WHERE password_hash IS NULL OR password_hash = ''
  ORDER BY id
`);
console.log(`=== 无密码账号明细（共 ${list.rows.length} 条）===`);
console.table(list.rows);

await pool.end();
process.exit(0);
