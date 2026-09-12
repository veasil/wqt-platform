import pg from "pg";

/**
 * SQLite → PostgreSQL 兼容层（纯转换，无副作用）
 *
 * 设计目标：让原本面向 sqlite3 的 dbRun/dbGet/dbAll 调用点零改动地跑在 PostgreSQL 上。
 * 处理三件事：
 *   1. 占位符 ?         → $1,$2,...
 *   2. INSERT OR IGNORE → INSERT ... ON CONFLICT DO NOTHING
 *   3. INSERT（有 id 列的表）自动追加 RETURNING id，使返回值带 lastID
 *
 * 注意：本项目 SQL 中不存在字符串字面量里的 `?`，因此朴素的顺序替换是安全的。
 */

// BIGINT(int8, oid=20) 默认被 node-postgres 解析为字符串。
// 本项目的自增 id 与毫秒时间戳都在 JS 安全整数范围内（< 2^53），
// 统一解析为 number，保持与原 sqlite 行为一致（数值比较、JSON 输出、COUNT(*) 求和）。
pg.types.setTypeParser(20, (v) => (v === null ? null : parseInt(v, 10)));

// 没有自增 id 列的表（自然主键 / 复合主键）——不要给它们追加 RETURNING id
const ID_LESS_TABLES = new Set(["sms_codes", "activity_sessions", "system_settings"]);

/** 把 `?` 占位符顺序替换为 `$1,$2,...` */
export function toPgParams(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

/**
 * 转换写语句（run 用）：处理 OR IGNORE / RETURNING / 占位符。
 * 读语句（get/all）只需 toPgParams。
 */
export function transformSql(sql) {
  let text = sql;

  const isInsert = /^\s*INSERT\s+/i.test(text);

  // INSERT OR IGNORE → INSERT ... ON CONFLICT DO NOTHING
  if (/INSERT\s+OR\s+IGNORE/i.test(text)) {
    text = text.replace(/INSERT\s+OR\s+IGNORE\s+INTO/i, "INSERT INTO");
    if (!/ON\s+CONFLICT/i.test(text)) {
      text = text.trimEnd().replace(/;?\s*$/, "") + " ON CONFLICT DO NOTHING";
    }
  }

  // 给有 id 列的 INSERT 追加 RETURNING id（已带 RETURNING 或 ON CONFLICT 的跳过）
  if (isInsert && !/RETURNING/i.test(text) && !/ON\s+CONFLICT/i.test(text)) {
    const m = text.match(/INSERT\s+INTO\s+["']?(\w+)["']?/i);
    const table = m ? m[1].toLowerCase() : null;
    if (table && !ID_LESS_TABLES.has(table)) {
      text = text.trimEnd().replace(/;?\s*$/, "") + " RETURNING id";
    }
  }

  return toPgParams(text);
}

// 瞬时网络错误（连接被对端/代理掐断、超时）——重试可从池里换一条健康连接
function isTransient(err) {
  return /terminated unexpectedly|ECONNRESET|Connection terminated|timeout|ETIMEDOUT|EPIPE/i.test(
    (err && err.message) || ""
  );
}

// 写语句默认不重试（避免非幂等 INSERT 重复执行）；读语句安全重试
async function query(pool, text, params, { retry } = { retry: true }) {
  let lastErr;
  const attempts = retry ? 4 : 1;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await pool.query(text, params);
    } catch (e) {
      lastErr = e;
      if (!retry || !isTransient(e) || i === attempts) throw e;
      await new Promise((r) => setTimeout(r, 300 * i));
    }
  }
  throw lastErr;
}

/**
 * 基于一个 pg.Pool 生成与原 sqlite 封装同签名的 { run, get, all }。
 *   run → { lastID, changes }   （写语句，不自动重试以保证非幂等安全）
 *   get → 单行对象 | undefined   （读语句，瞬时断连自动重试）
 *   all → 行数组                 （读语句，瞬时断连自动重试）
 */
export function makePgApi(pool, { retryReads = true } = {}) {
  return {
    async run(sql, params = []) {
      const res = await query(pool, transformSql(sql), params, { retry: false });
      return { lastID: res.rows && res.rows[0] ? res.rows[0].id : undefined, changes: res.rowCount };
    },
    async get(sql, params = []) {
      const res = await query(pool, toPgParams(sql), params, { retry: retryReads });
      return res.rows[0];
    },
    async all(sql, params = []) {
      const res = await query(pool, toPgParams(sql), params, { retry: retryReads });
      return res.rows;
    },
  };
}

/** 统一的连接池构造：从连接串建池，按需开启 SSL（连 Zeabur 公网端点时需要）。 */
export function createPool(connectionString) {
  const ssl =
    process.env.DATABASE_SSL === "true"
      ? { rejectUnauthorized: false }
      : false;
  const pool = new pg.Pool({
    connectionString,
    ssl,
    max: 10,
    keepAlive: true,                 // 防止公网代理掐断空闲连接
    connectionTimeoutMillis: 15000,
    idleTimeoutMillis: 30000,
  });
  // 空闲连接被对端断开时 pg 会在 pool 上抛 error，必须兜住否则进程崩溃
  pool.on("error", (err) => {
    console.warn("⚠️  PG pool idle client error:", err.message);
  });
  return pool;
}
