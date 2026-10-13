// 更新 2026 卡牌包到 0521 终版：以 cards_2026.json 为准，按 card_code 同步内容。
//   - 已存在 card_code：UPDATE cards + 追加 card_versions + 重新发布 cards_released
//   - 新 card_code（E04…E09）：新建 card + version + release
//   - 旧的、不在新编号集里的 2026版 卡（E4…E9）：标记 status='deleted'
//   - 重建「2026版」卡牌组的 released_ids_json（按 json 顺序）与 max_scores
//
// 用法：
//   node scripts/update_2026_cards.mjs <cards_2026.json> [--dry-run] [--group-name 2026版]
//
// DB 目标由环境变量决定（与 server 一致）：
//   CARDS_SOURCE=sqlite  CARDS_DB_PATH=./data/cards.db            本地 SQLite
//   CARDS_SOURCE=postgres CARDS_DATABASE_URL/DATABASE_URL=...     生产 PG

import 'dotenv/config';
import fs from 'fs';
import {
  initCardsDb, cardsDbRun, cardsDbGet, cardsDbAll
} from '../src/cards-db.js';

const args = process.argv.slice(2);
const jsonPath = args.find(a => !a.startsWith('--')) || './scripts/cards_2026.json';
const DRY = args.includes('--dry-run');
const groupName = (() => {
  const i = args.indexOf('--group-name');
  return i >= 0 && args[i + 1] ? args[i + 1] : '2026版';
})();

const DIMS = ['安全力', '脑波力', '实感力', '创心力', '沟通力'];

function computeMaxScores(cards) {
  const maxScores = {};
  for (const c of cards) {
    const opts = c.options || {};
    const cardMax = {};
    for (const k of Object.keys(opts)) {
      const eff = opts[k].attributeEffects || {};
      for (const d of DIMS) {
        const v = Number(eff[d] || 0);
        if (v > (cardMax[d] || 0)) cardMax[d] = v;
      }
    }
    for (const d of DIMS) maxScores[d] = (maxScores[d] || 0) + (cardMax[d] || 0);
  }
  return maxScores;
}

async function main() {
  const cards = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
  console.log(`[update] 源文件 ${jsonPath}：${cards.length} 张卡  目标=${process.env.CARDS_SOURCE || 'postgres'}  dry-run=${DRY}`);

  await initCardsDb();
  const now = Date.now();

  const maxRow = await cardsDbGet('SELECT MAX(key) AS k FROM cards');
  let nextKey = Number(maxRow?.k || 0);

  const releasedIds = [];
  let created = 0, updated = 0;

  for (const c of cards) {
    const optionsJson = JSON.stringify(c.options);
    const trainerJson = c.trainer_material ? JSON.stringify(c.trainer_material) : null;
    const existing = await cardsDbGet(
      'SELECT id, key, version FROM cards WHERE card_code = ?', [c.card_code]
    );

    if (existing) {
      const key = existing.key;
      const newVer = Number(existing.version || 1) + 1;
      if (DRY) {
        console.log(`  [dry] 更新 ${c.card_code} (card#${existing.id} -> v${newVer})`);
        updated++;
        continue;
      }
      // 1) 覆盖 cards 沙盒
      await cardsDbRun(
        `UPDATE cards SET safety_type=?, event=?, phase=?, options_json=?, status='active',
           version=?, updated_at=?, deleted_at=NULL, workbench='2026版',
           title=?, guide_text=?, subtopic=?, whitepaper_ref=?, trainer_material_json=?
         WHERE id=?`,
        [c.safety_type, c.event, c.phase, optionsJson, newVer, now,
          c.title, c.guide_text, c.subtopic, c.whitepaper_ref, trainerJson, existing.id]
      );
      // 2) 追加版本
      const verRow = await cardsDbRun(
        `INSERT INTO card_versions (card_id, key, safety_type, event, phase, options_json, version, version_label, branch, created_at,
           card_code, workbench, title, guide_text, subtopic, whitepaper_ref, trainer_material_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, '0521终版同步', 'main', ?, ?, '2026版', ?, ?, ?, ?, ?)`,
        [existing.id, key, c.safety_type, c.event, c.phase, optionsJson, newVer, now,
          c.card_code, c.title, c.guide_text, c.subtopic, c.whitepaper_ref, trainerJson]
      );
      await cardsDbRun('UPDATE cards SET current_version_id=? WHERE id=?', [verRow.lastID, existing.id]);
      // 3) 重新发布快照
      const relRow = await cardsDbRun(
        `INSERT INTO cards_released (card_id, key, safety_type, event, phase, options_json, card_code, title, guide_text, version_label, from_version_id, released_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '0521终版发布', ?, ?)`,
        [existing.id, key, c.safety_type, c.event, c.phase, optionsJson, c.card_code, c.title, c.guide_text, verRow.lastID, now]
      );
      releasedIds.push(relRow.lastID);
      updated++;
      console.log(`  upd   ${c.card_code} -> card#${existing.id} v${newVer} released#${relRow.lastID}`);
    } else {
      nextKey += 1;
      const key = nextKey;
      if (DRY) {
        console.log(`  [dry] 新建 ${c.card_code} key=${key} 「${c.title}」`);
        created++;
        continue;
      }
      const cardRow = await cardsDbRun(
        `INSERT INTO cards (key, safety_type, event, phase, options_json, status, version, created_at, updated_at,
           card_code, workbench, title, guide_text, subtopic, whitepaper_ref, trainer_material_json)
         VALUES (?, ?, ?, ?, ?, 'active', 1, ?, ?, ?, '2026版', ?, ?, ?, ?, ?)`,
        [key, c.safety_type, c.event, c.phase, optionsJson, now, now,
          c.card_code, c.title, c.guide_text, c.subtopic, c.whitepaper_ref, trainerJson]
      );
      const cardId = cardRow.lastID;
      const verRow = await cardsDbRun(
        `INSERT INTO card_versions (card_id, key, safety_type, event, phase, options_json, version, version_label, branch, created_at,
           card_code, workbench, title, guide_text, subtopic, whitepaper_ref, trainer_material_json)
         VALUES (?, ?, ?, ?, ?, ?, 1, '0521终版导入', 'main', ?, ?, '2026版', ?, ?, ?, ?, ?)`,
        [cardId, key, c.safety_type, c.event, c.phase, optionsJson, now,
          c.card_code, c.title, c.guide_text, c.subtopic, c.whitepaper_ref, trainerJson]
      );
      await cardsDbRun('UPDATE cards SET current_version_id=? WHERE id=?', [verRow.lastID, cardId]);
      const relRow = await cardsDbRun(
        `INSERT INTO cards_released (card_id, key, safety_type, event, phase, options_json, card_code, title, guide_text, version_label, from_version_id, released_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '0521终版发布', ?, ?)`,
        [cardId, key, c.safety_type, c.event, c.phase, optionsJson, c.card_code, c.title, c.guide_text, verRow.lastID, now]
      );
      releasedIds.push(relRow.lastID);
      created++;
      console.log(`  new   ${c.card_code} -> card#${cardId} key=${key} released#${relRow.lastID}`);
    }
  }

  // 作废不在新编号集里的旧 2026版 卡（如旧 E4…E9）
  const newCodes = new Set(cards.map(c => c.card_code));
  const old2026 = await cardsDbAll(
    "SELECT id, card_code FROM cards WHERE workbench='2026版' AND status<>'deleted'"
  );
  const toDeprecate = old2026.filter(r => !newCodes.has(r.card_code));
  for (const r of toDeprecate) {
    if (DRY) { console.log(`  [dry] 作废旧卡 ${r.card_code} (card#${r.id})`); continue; }
    await cardsDbRun("UPDATE cards SET status='deleted', deleted_at=? WHERE id=?", [now, r.id]);
    console.log(`  del   ${r.card_code} (card#${r.id}) 标记 deleted`);
  }

  // 重建「2026版」卡牌组
  const idsJson = JSON.stringify(releasedIds);
  const maxScoresJson = JSON.stringify(computeMaxScores(cards));
  if (DRY) {
    console.log(`\n[dry] 将重建卡牌组「${groupName}」，含 ${releasedIds.length} 张；作废 ${toDeprecate.length} 张旧卡`);
  } else {
    const grp = await cardsDbGet('SELECT id FROM card_groups WHERE name = ?', [groupName]);
    if (grp) {
      await cardsDbRun(
        'UPDATE card_groups SET released_ids_json=?, max_scores_json=?, updated_at=? WHERE id=?',
        [idsJson, maxScoresJson, now, grp.id]
      );
      console.log(`\n[update] 重建卡牌组「${groupName}」(id=${grp.id})，含 ${releasedIds.length} 张`);
    } else {
      const ins = await cardsDbRun(
        `INSERT INTO card_groups (name, description, released_ids_json, max_scores_json, is_default, created_at, updated_at)
         VALUES (?, ?, ?, ?, 0, ?, ?)`,
        [groupName, '2026 精选卡牌包（45 张）', idsJson, maxScoresJson, now, now]
      );
      console.log(`\n[update] 新建卡牌组「${groupName}」(id=${ins.lastID})，含 ${releasedIds.length} 张`);
    }
  }

  console.log(`\n[update] 完成：更新 ${updated} 张，新建 ${created} 张，作废 ${toDeprecate.length} 张，卡牌组含 ${releasedIds.length} 张快照。`);
  process.exit(0);
}

main().catch(e => { console.error('[update] 失败:', e); process.exit(1); });
