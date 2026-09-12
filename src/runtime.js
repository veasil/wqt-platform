import path from "path";
import fs from "fs";
import OSS from "ali-oss";
import { initDb, dbRun, dbGet, dbAll } from "./db.js";
import { initCardsDb, cardsDbRun, cardsDbGet, cardsDbAll } from "./cards-db.js";
import { config, loadConfig } from "./config.js";
import { initSms, stopSms } from "./services/sms.js";
import { closeDb } from "./db.js";
import { closeCardsDb } from "./cards-db.js";
import { createApp } from "./app.js";
import { ROOT_DIR } from "./paths.js";
async function initializeRuntime() {
  await initDb();
  await initCardsDb(); // 初始化独立卡牌数据库

  // 自动初始化卡牌组（仅首次：card_groups 为空时）
  // 初版内容直接从 public/cards-data.js 读取，写入独立快照，保证和静态文件一致
  {
    const groupCount = await cardsDbGet("SELECT COUNT(*) as c FROM card_groups");
    if (groupCount.c === 0) {
      console.log("📦 首次启动：自动创建卡牌组...");
      const now = Date.now();

      // 读取 cards-data.js 并解析 CARD_DATA 数组
      const raw = fs.readFileSync(path.join(ROOT_DIR, "public", "cards-data.js"), "utf8");
      const match = raw.match(/const CARD_DATA = (\[[\s\S]*\]);/);
      if (match) {
        const cards = JSON.parse(match[1]);
        const v1Ids = [];

        for (const c of cards) {
          // 按 key 查 cards 表的真实 id，找不到则用 key 兜底
          const cardRow = await cardsDbGet("SELECT id FROM cards WHERE key = ?", [c.key]);
          const cardId = cardRow ? cardRow.id : c.key;
          const optionsJson = JSON.stringify(c.options);
          const result = await cardsDbRun(
            `INSERT INTO cards_released (card_id, key, safety_type, event, phase, options_json, audio_url, version_label, released_by, released_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [cardId, c.key, c.safetyType, c.event, c.phase || null, optionsJson, null, "初版", null, 0]
          );
          v1Ids.push(result.lastID);
        }

        // 创建初版组（默认）
        await cardsDbRun(
          `INSERT INTO card_groups (name, description, released_ids_json, is_default, created_at, updated_at)
           VALUES (?, ?, ?, 1, ?, ?)`,
          ["初版卡牌", "对应 cards-data.js 的原始 45 张卡牌", JSON.stringify(v1Ids), now, now]
        );
        console.log(`  ✅ 创建「初版卡牌」(默认) — ${v1Ids.length} 张`);

        // 如果已有其他 released 快照，创建 1.1 版组
        const latestRows = await cardsDbAll(
          `SELECT id FROM cards_released r1
           WHERE released_at > 0
             AND released_at = (SELECT MAX(released_at) FROM cards_released r2 WHERE r2.key = r1.key AND r2.released_at > 0)
           ORDER BY key`
        );
        if (latestRows.length > 0) {
          const latestIds = latestRows.map(r => r.id);
          await cardsDbRun(
            `INSERT INTO card_groups (name, description, released_ids_json, is_default, created_at, updated_at)
             VALUES (?, ?, ?, 0, ?, ?)`,
            ["1.1版卡牌", "含新发布卡牌的版本", JSON.stringify(latestIds), now, now]
          );
          console.log(`  ✅ 创建「1.1版卡牌」 — ${latestIds.length} 张`);
        }
      } else {
        console.log("  ⚠️ 未能解析 public/cards-data.js，跳过卡牌组初始化");
      }
    }
  }

  // 启动时为缺少 max_scores_json 的卡牌组补算
  {
    const groupsNeedCalc = await cardsDbAll("SELECT id, released_ids_json FROM card_groups WHERE max_scores_json IS NULL");
    for (const g of groupsNeedCalc) {
      let ids = [];
      try { ids = JSON.parse(g.released_ids_json || "[]"); } catch (_) {}
      if (ids.length === 0) continue;
      const placeholders = ids.map(() => "?").join(",");
      const rows = await cardsDbAll(`SELECT options_json FROM cards_released WHERE id IN (${placeholders})`, ids);
      const maxScores = {};
      for (const row of rows) {
        let options;
        try { options = JSON.parse(row.options_json); } catch (_) { continue; }
        const cardMax = {};
        for (const optKey of Object.keys(options)) {
          const effects = options[optKey]?.attributeEffects;
          if (!effects) continue;
          for (const [attr, val] of Object.entries(effects)) {
            const v = Number(val) || 0;
            if (v > (cardMax[attr] || 0)) cardMax[attr] = v;
          }
        }
        for (const [attr, val] of Object.entries(cardMax)) {
          maxScores[attr] = (maxScores[attr] || 0) + val;
        }
      }
      if (Object.keys(maxScores).length > 0) {
        await cardsDbRun("UPDATE card_groups SET max_scores_json = ? WHERE id = ?", [JSON.stringify(maxScores), g.id]);
      }
    }
    if (groupsNeedCalc.length > 0) console.log(`✅ 已为 ${groupsNeedCalc.length} 个卡牌组补算 max_scores_json`);
  }

  await loadConfig();
  initSms();
}

async function cleanupStaleSessions() {
  const cutoff = Date.now() - 3 * 60 * 60 * 1000;
  try {
    const staleSessions = await dbAll("SELECT id FROM game_sessions WHERE ended_at IS NULL AND started_at < ?", [cutoff]);
    if (!staleSessions || staleSessions.length === 0) return;
    for (const s of staleSessions) {
      const eventCount = await dbGet("SELECT COUNT(*) as cnt FROM game_events WHERE session_id = ?", [s.id]);
      if (eventCount.cnt > 0) await dbRun("UPDATE game_sessions SET ended_at = ?, status = 'auto_finished' WHERE id = ?", [Date.now(), s.id]);
      else await dbRun("UPDATE game_sessions SET status = 'abandoned', ended_at = ? WHERE id = ?", [Date.now(), s.id]);
    }
    console.log(`✅ 已清理 ${staleSessions.length} 个过期场次`);
  } catch (e) {
    console.error("清理过期场次失败:", e.message);
  }
}
let cleanupInFlight = null;
function runCleanup() {
  if (!cleanupInFlight) {
    cleanupInFlight = cleanupStaleSessions().finally(() => { cleanupInFlight = null; });
  }
  return cleanupInFlight;
}
function createOssClient(runtimeConfig) {
  const ossConfig = { accessKeyId: runtimeConfig.ALIBABA_CLOUD_ACCESS_KEY_ID, accessKeySecret: runtimeConfig.ALIBABA_CLOUD_ACCESS_KEY_SECRET, bucket: runtimeConfig.OSS_BUCKET_NAME || "ai5000days-scoring-system-hk", secure: true };
  if (runtimeConfig.OSS_ENDPOINT) ossConfig.endpoint = runtimeConfig.OSS_ENDPOINT;
  else ossConfig.region = (runtimeConfig.OSS_REGION || "oss-cn-hongkong").startsWith("oss-") ? runtimeConfig.OSS_REGION : `oss-${runtimeConfig.OSS_REGION}`;
  const client = runtimeConfig.ALIBABA_CLOUD_ACCESS_KEY_ID && runtimeConfig.ALIBABA_CLOUD_ACCESS_KEY_SECRET ? new OSS(ossConfig) : null;
  if (client) {
    console.log("✅ OSS Client initialized.");
    console.log("   Bucket:", ossConfig.bucket);
    console.log("   Region/Endpoint:", ossConfig.region || ossConfig.endpoint);
  } else {
    console.log("❌ OSS Client NOT initialized.");
    console.log("   ALIBABA_CLOUD_ACCESS_KEY_ID present:", !!runtimeConfig.ALIBABA_CLOUD_ACCESS_KEY_ID);
    console.log("   ALIBABA_CLOUD_ACCESS_KEY_SECRET present:", !!runtimeConfig.ALIBABA_CLOUD_ACCESS_KEY_SECRET);
  }
  return client;
}
let activeRuntime = null;
let startingRuntime = null;
export async function startRuntime({ port, host } = {}) {
  if (activeRuntime || startingRuntime) throw new Error("Runtime is already running or starting");
  startingRuntime = startRuntimeInternal({ port, host });
  try {
    activeRuntime = await startingRuntime;
    return activeRuntime;
  } finally {
    startingRuntime = null;
  }
}
async function startRuntimeInternal({ port, host } = {}) {
  let server = null;
  let sessionTimer = null;
  let stopPromise = null;
  try {
    await initializeRuntime();
    const ossClient = createOssClient(config);
    const app = createApp({ runtimeConfig: config, ossClient });
    const listenPort = port ?? config.PORT ?? 8080;
    const listenHost = host ?? process.env.HOST ?? "0.0.0.0";
    server = await new Promise((resolve, reject) => {
      const instance = app.listen(Number(listenPort), listenHost, () => {
        instance.removeListener("error", reject);
        resolve(instance);
      });
      instance.once("error", reject);
    });
    const actualPort = server.address()?.port ?? listenPort;
    console.log(`✅ Server running on http://${listenHost}:${actualPort}`);
    console.log(`🌐 Public access via your server IP: http://127.0.0.1:${actualPort}`);
    runCleanup();
    sessionTimer = setInterval(runCleanup, 60 * 60 * 1000);
    return { app, server, stop };
  } catch (error) {
    try { await stop(); } catch (cleanupError) {
      // Keep the startup failure (e.g. EADDRINUSE) as the primary error.
      error.cleanupError = cleanupError;
    }
    throw error;
  }

  function stop() {
    if (stopPromise) return stopPromise;
    stopPromise = (async () => {
      const errors = [];
      const release = async action => {
        try { await action(); } catch (error) { errors.push(error); }
      };
      if (sessionTimer) clearInterval(sessionTimer);
      if (server) await release(() => new Promise((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve());
      }));
      // An already-running cleanup must finish before its database is closed.
      await release(() => cleanupInFlight);
      await release(() => stopSms());
      await release(() => closeCardsDb());
      await release(() => closeDb());
      if (activeRuntime?.server === server) activeRuntime = null;
      if (errors.length) throw new AggregateError(errors, "Runtime cleanup failed");
    })();
    return stopPromise;
  }
}
