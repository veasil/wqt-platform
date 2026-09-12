import { dbGet } from "../../db.js";
import { cardsDbRun, cardsDbGet, cardsDbAll } from "../../cards-db.js";
import { authMiddleware } from "../../middleware/auth.js";
import { ROOT_DIR } from "../../paths.js";
import { promises as fsPromises } from "node:fs";
import path from "node:path";
import fetch from "node-fetch";

export function registerCardRoutes(app) {
  // ======== API: Cards Management ========

  // 卡牌格式化辅助：将 cards_released 行转为前端卡牌对象
  function formatReleasedCard(c) {
    return {
      id: c.card_id,
      key: c.key,
      card_code: c.card_code || null,
      safetyType: c.safety_type,
      event: c.event,
      phase: c.phase,
      status: "released",
      audio_url: c.audio_url || null,
      attribute_reason: c.attribute_reason || null,
      title: c.title || null,
      guide_text: c.guide_text || null,
      options: JSON.parse(c.options_json),
    };
  }

  // 1. Get all cards (Public Game API)
  // 支持 ?group_id=:id；未指定时优先使用 is_default 卡牌组；
  // 若无任何卡牌组则回退到"每个 key 取最新快照"的旧行为。
  app.get("/api/cards", async (req, res) => {
    try {
      let groupId = req.query.group_id ? Number(req.query.group_id) : null;

      if (!groupId) {
        const def = await cardsDbGet(
          "SELECT id FROM card_groups WHERE is_default = 1 LIMIT 1",
        );
        if (def) groupId = def.id;
      }

      if (groupId) {
        const group = await cardsDbGet(
          "SELECT * FROM card_groups WHERE id = ?",
          [groupId],
        );
        if (group) {
          let ids = [];
          try {
            ids = JSON.parse(group.released_ids_json || "[]");
          } catch (_) {}
          if (ids.length === 0)
            return res.json({
              cards: [],
              group: { id: group.id, name: group.name, maxScores: null },
            });

          const placeholders = ids.map(() => "?").join(",");
          const rows = await cardsDbAll(
            `SELECT * FROM cards_released WHERE id IN (${placeholders})`,
            ids,
          );
          // 按 ids 顺序重排
          const byId = new Map(rows.map((r) => [r.id, r]));
          const ordered = ids.map((i) => byId.get(i)).filter(Boolean);
          let maxScores = null;
          try {
            maxScores = group.max_scores_json
              ? JSON.parse(group.max_scores_json)
              : null;
          } catch (_) {}
          return res.json({
            cards: ordered.map(formatReleasedCard),
            group: { id: group.id, name: group.name, maxScores },
          });
        }
      }

      // 回退：每个 key 最新快照
      const cards = await cardsDbAll(`
      SELECT cr.* FROM cards_released cr
      INNER JOIN (
        SELECT key, MAX(released_at) as max_t FROM cards_released GROUP BY key
      ) latest ON cr.key = latest.key AND cr.released_at = latest.max_t
      ORDER BY cr.key ASC
    `);
      res.json({ cards: cards.map(formatReleasedCard) });
    } catch (e) {
      res.status(500).json({ error: "Failed to fetch cards: " + e.message });
    }
  });

  // 1a-study. 守望学习：在 /api/cards 基础上回连 cards 表补全
  // subtopic / whitepaper_ref / trainer_material_json（培训资料，未进发布快照）。
  async function enrichWithStudyFields(releasedRows) {
    const cards = releasedRows.map(formatReleasedCard);
    const cardIds = [
      ...new Set(releasedRows.map((r) => r.card_id).filter(Boolean)),
    ];
    if (cardIds.length === 0) return cards;
    const ph = cardIds.map(() => "?").join(",");
    const extra = await cardsDbAll(
      `SELECT id, subtopic, whitepaper_ref, trainer_material_json FROM cards WHERE id IN (${ph})`,
      cardIds,
    );
    const byId = new Map(extra.map((e) => [e.id, e]));
    return cards.map((c) => {
      const e = byId.get(c.id);
      let tm = null;
      if (e && e.trainer_material_json) {
        try {
          const j = JSON.parse(e.trainer_material_json);
          tm = {
            mentorIndex: j.mentor_index || "",
            trainerNotes: j.trainer_notes || "",
            extraCases: j.extra_cases || "",
          };
        } catch (_) {}
      }
      return {
        ...c,
        subtopic: e?.subtopic || null,
        whitepaperRef: e?.whitepaper_ref || null,
        trainerMaterial: tm,
      };
    });
  }

  // 守望学习为会员权益：authMiddleware 内含 resolveValidity，无会员/已到期/被停用直接 403
  app.get("/api/cards/study", authMiddleware, async (req, res) => {
    try {
      let groupId = req.query.group_id ? Number(req.query.group_id) : null;
      if (!groupId) {
        const def = await cardsDbGet(
          "SELECT id FROM card_groups WHERE is_default = 1 LIMIT 1",
        );
        if (def) groupId = def.id;
      }

      let rows;
      if (groupId) {
        const group = await cardsDbGet(
          "SELECT * FROM card_groups WHERE id = ?",
          [groupId],
        );
        if (!group) return res.status(404).json({ error: "卡牌组不存在" });
        let ids = [];
        try {
          ids = JSON.parse(group.released_ids_json || "[]");
        } catch (_) {}
        if (ids.length === 0)
          return res.json({
            cards: [],
            group: { id: group.id, name: group.name },
          });
        const ph = ids.map(() => "?").join(",");
        const fetched = await cardsDbAll(
          `SELECT * FROM cards_released WHERE id IN (${ph})`,
          ids,
        );
        const byId = new Map(fetched.map((r) => [r.id, r]));
        rows = ids.map((i) => byId.get(i)).filter(Boolean);
        const cards = await enrichWithStudyFields(rows);
        return res.json({ cards, group: { id: group.id, name: group.name } });
      }

      // 回退：每个 key 最新快照
      rows = await cardsDbAll(`
      SELECT cr.* FROM cards_released cr
      INNER JOIN (
        SELECT key, MAX(released_at) as max_t FROM cards_released GROUP BY key
      ) latest ON cr.key = latest.key AND cr.released_at = latest.max_t
      ORDER BY cr.key ASC
    `);
      const cards = await enrichWithStudyFields(rows);
      res.json({ cards });
    } catch (e) {
      res
        .status(500)
        .json({ error: "Failed to fetch study cards: " + e.message });
    }
  });

  // 1b. 公开：卡牌组列表（供前端三条杠菜单）
  app.get("/api/card-groups", async (req, res) => {
    try {
      const groups = await cardsDbAll(
        "SELECT id, name, description, is_default, released_ids_json FROM card_groups ORDER BY is_default DESC, id ASC",
      );
      const result = groups.map((g) => {
        let count = 0;
        try {
          count = JSON.parse(g.released_ids_json || "[]").length;
        } catch (_) {}
        return {
          id: g.id,
          name: g.name,
          description: g.description || "",
          is_default: !!g.is_default,
          count,
        };
      });
      res.json({ groups: result });
    } catch (e) {
      res
        .status(500)
        .json({ error: "Failed to fetch card groups: " + e.message });
    }
  });

  // 1c. Admin：卡牌组 CRUD
  app.get("/api/admin/card-groups", authMiddleware, async (req, res) => {
    try {
      const groups = await cardsDbAll(
        "SELECT * FROM card_groups ORDER BY is_default DESC, id ASC",
      );
      const result = groups.map((g) => {
        let ids = [];
        try {
          ids = JSON.parse(g.released_ids_json || "[]");
        } catch (_) {}
        return {
          id: g.id,
          name: g.name,
          description: g.description || "",
          is_default: !!g.is_default,
          count: ids.length,
          released_ids: ids,
          created_at: g.created_at,
          updated_at: g.updated_at,
        };
      });
      res.json({ groups: result });
    } catch (e) {
      res.status(500).json({ error: "Failed: " + e.message });
    }
  });

  app.get("/api/admin/card-groups/:id", authMiddleware, async (req, res) => {
    try {
      const group = await cardsDbGet("SELECT * FROM card_groups WHERE id = ?", [
        req.params.id,
      ]);
      if (!group) return res.status(404).json({ error: "卡牌组不存在" });
      let ids = [];
      try {
        ids = JSON.parse(group.released_ids_json || "[]");
      } catch (_) {}

      let cards = [];
      if (ids.length > 0) {
        const placeholders = ids.map(() => "?").join(",");
        const rows = await cardsDbAll(
          `SELECT * FROM cards_released WHERE id IN (${placeholders})`,
          ids,
        );
        const byId = new Map(rows.map((r) => [r.id, r]));
        cards = ids
          .map((i) => byId.get(i))
          .filter(Boolean)
          .map((r) => ({
            released_id: r.id,
            card_id: r.card_id,
            key: r.key,
            safety_type: r.safety_type,
            event: r.event,
            phase: r.phase,
            version_label: r.version_label,
          }));
      }

      res.json({
        id: group.id,
        name: group.name,
        description: group.description || "",
        is_default: !!group.is_default,
        released_ids: ids,
        cards,
        created_at: group.created_at,
        updated_at: group.updated_at,
      });
    } catch (e) {
      res.status(500).json({ error: "Failed: " + e.message });
    }
  });

  // 辅助：把沙盒 card_ids 解析为 released_ids；如该 card 当前 version 尚未发布，则自动 snapshot
  async function resolveReleasedIdsFromCardIds(cardIds, releasedBy, label) {
    const out = [];
    const now = Date.now();
    for (const cid of cardIds) {
      const card = await cardsDbGet("SELECT * FROM cards WHERE id = ?", [cid]);
      if (!card) continue;
      // 强制升级为 active（既然加入卡牌组就视为发布）
      if (card.status !== "active") {
        await cardsDbRun(
          "UPDATE cards SET status='active', updated_at=? WHERE id=?",
          [now, cid],
        );
      }
      // 复用：若已存在 from_version_id == current_version_id 的快照，直接用
      let snap = null;
      if (card.current_version_id) {
        snap = await cardsDbGet(
          "SELECT id FROM cards_released WHERE card_id=? AND from_version_id=? ORDER BY id DESC LIMIT 1",
          [card.id, card.current_version_id],
        );
      }
      if (snap) {
        out.push(snap.id);
        continue;
      }
      // 新建快照
      const ins = await cardsDbRun(
        `INSERT INTO cards_released
       (card_id, key, safety_type, event, phase, options_json, audio_url, attribute_reason, card_code, title, guide_text, version_label, from_version_id, released_by, released_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          card.id,
          card.key,
          card.safety_type,
          card.event,
          card.phase,
          card.options_json,
          card.audio_url,
          card.attribute_reason,
          card.card_code,
          card.title,
          card.guide_text,
          label || card.version_label || `v${card.version || 1}版`,
          card.current_version_id,
          releasedBy,
          now,
        ],
      );
      out.push(ins.lastID);
    }
    return out;
  }

  // 计算卡牌组各维度理论满分（每张卡取该维度最高选项值，然后所有卡求和）
  async function computeMaxScoresForGroup(releasedIdsJson) {
    let ids = [];
    try {
      ids = JSON.parse(releasedIdsJson || "[]");
    } catch (_) {}
    if (ids.length === 0) return null;

    const placeholders = ids.map(() => "?").join(",");
    const rows = await cardsDbAll(
      `SELECT options_json FROM cards_released WHERE id IN (${placeholders})`,
      ids,
    );

    const maxScores = {}; // { "安全力": total, "脑波力": total, ... }
    for (const row of rows) {
      let options;
      try {
        options = JSON.parse(row.options_json);
      } catch (_) {
        continue;
      }
      // 每张卡：取每个维度在所有选项中的最大值
      const cardMax = {};
      for (const optKey of Object.keys(options)) {
        const effects = options[optKey]?.attributeEffects;
        if (!effects) continue;
        for (const [attr, val] of Object.entries(effects)) {
          const v = Number(val) || 0;
          if (v > (cardMax[attr] || 0)) cardMax[attr] = v;
        }
      }
      // 累加到总分
      for (const [attr, val] of Object.entries(cardMax)) {
        maxScores[attr] = (maxScores[attr] || 0) + val;
      }
    }
    return Object.keys(maxScores).length > 0 ? maxScores : null;
  }

  app.post("/api/admin/card-groups", authMiddleware, async (req, res) => {
    try {
      const { name, description, released_ids, card_ids, is_default } =
        req.body || {};
      if (!name) return res.status(400).json({ error: "name required" });
      let ids = [];
      if (Array.isArray(card_ids) && card_ids.length > 0) {
        ids = await resolveReleasedIdsFromCardIds(
          card_ids.map(Number).filter(Boolean),
          req.user.uid,
          `加入卡牌组：${name}`,
        );
      } else if (Array.isArray(released_ids)) {
        ids = released_ids.map(Number).filter(Boolean);
      }
      const now = Date.now();
      const idsJson = JSON.stringify(ids);
      const maxScores = await computeMaxScoresForGroup(idsJson);
      const result = await cardsDbRun(
        `INSERT INTO card_groups (name, description, released_ids_json, max_scores_json, is_default, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          name,
          description || "",
          idsJson,
          maxScores ? JSON.stringify(maxScores) : null,
          is_default ? 1 : 0,
          req.user.uid,
          now,
          now,
        ],
      );
      if (is_default) {
        await cardsDbRun(
          "UPDATE card_groups SET is_default = 0 WHERE id != ?",
          [result.lastID],
        );
      }
      res.json({ ok: true, id: result.lastID, count: ids.length });
    } catch (e) {
      res.status(500).json({ error: "Failed: " + e.message });
    }
  });

  app.put("/api/admin/card-groups/:id", authMiddleware, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const existing = await cardsDbGet(
        "SELECT * FROM card_groups WHERE id = ?",
        [id],
      );
      if (!existing) return res.status(404).json({ error: "卡牌组不存在" });

      const { name, description, released_ids, card_ids, is_default } =
        req.body || {};
      const newName = name != null ? name : existing.name;
      const newDesc = description != null ? description : existing.description;

      let newIdsJson = existing.released_ids_json;
      if (Array.isArray(card_ids)) {
        const resolved = await resolveReleasedIdsFromCardIds(
          card_ids.map(Number).filter(Boolean),
          req.user.uid,
          `加入卡牌组：${newName}`,
        );
        newIdsJson = JSON.stringify(resolved);
      } else if (Array.isArray(released_ids)) {
        newIdsJson = JSON.stringify(released_ids.map(Number).filter(Boolean));
      }
      const newDefault =
        is_default != null ? (is_default ? 1 : 0) : existing.is_default;
      const now = Date.now();
      const maxScores = await computeMaxScoresForGroup(newIdsJson);

      await cardsDbRun(
        `UPDATE card_groups SET name=?, description=?, released_ids_json=?, max_scores_json=?, is_default=?, updated_at=? WHERE id=?`,
        [
          newName,
          newDesc,
          newIdsJson,
          maxScores ? JSON.stringify(maxScores) : null,
          newDefault,
          now,
          id,
        ],
      );
      if (newDefault) {
        await cardsDbRun(
          "UPDATE card_groups SET is_default = 0 WHERE id != ?",
          [id],
        );
      }
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: "Failed: " + e.message });
    }
  });

  app.delete("/api/admin/card-groups/:id", authMiddleware, async (req, res) => {
    try {
      await cardsDbRun("DELETE FROM card_groups WHERE id = ?", [req.params.id]);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: "Failed: " + e.message });
    }
  });

  // 2. Get all cards (Admin API - Filterable)
  app.get("/api/admin/cards", authMiddleware, async (req, res) => {
    try {
      const { status } = req.query;
      let sql = "SELECT * FROM cards";
      const params = [];

      if (status) {
        sql += " WHERE status = ?";
        params.push(status);
      } else {
        // Default to showing all except deleted? Or just all?
        // Let's show all for admin if no status specified, or maybe excluding deleted by default unless requested.
        // For now, simple logic: all.
      }

      sql += " ORDER BY id DESC"; // Newest first for admin

      const cards = await cardsDbAll(sql, params);
      const formattedCards = cards.map((c) => ({
        id: c.id,
        key: c.key,
        card_code: c.card_code || null,
        workbench: c.workbench || "经典版",
        safetyType: c.safety_type,
        event: c.event,
        phase: c.phase,
        status: c.status,
        audio_url: c.audio_url || null,
        attribute_reason: c.attribute_reason || null,
        title: c.title || null,
        guide_text: c.guide_text || null,
        subtopic: c.subtopic || null,
        whitepaper_ref: c.whitepaper_ref || null,
        trainer_material: (() => {
          try {
            return c.trainer_material_json
              ? JSON.parse(c.trainer_material_json)
              : null;
          } catch {
            return null;
          }
        })(),
        notes: c.notes || "[]",
        current_version_id: c.current_version_id || null,
        author_id: c.author_id || null,
        updatedAt: c.updated_at,
        options: JSON.parse(c.options_json),
      }));
      res.json({ cards: formattedCards });
    } catch (e) {
      res
        .status(500)
        .json({ error: "Failed to fetch admin cards: " + e.message });
    }
  });

  // 2. Generate card using LLM
  // fs already imported at top of file

  app.post("/api/admin/generate-card", authMiddleware, async (req, res) => {
    const { topic, content } = req.body;
    if (!topic && !content)
      return res.status(400).json({ error: "Missing topic or content" });

    // Read the prompt template
    const promptPath = path.join(ROOT_DIR, "cards-generation-prompt.md");
    let systemPrompt;
    try {
      systemPrompt = await fsPromises.readFile(promptPath, "utf-8");
    } catch (e) {
      console.error("Failed to read prompt file:", e);
      return res.status(500).json({ error: "Failed to read prompt template" });
    }

    // Construct the full user message
    const userMessage = `请根据以下信息生成卡牌 JSON：\n${topic ? `Topic: ${topic}\n` : ""}${content ? `Content: ${content}` : ""}`;

    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey)
      return res.status(500).json({ error: "Server missing DEEPSEEK_API_KEY" });

    const model = process.env.DEEPSEEK_MODEL || "deepseek-chat";

    try {
      const response = await fetch(
        "https://api.deepseek.com/chat/completions",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userMessage },
            ],
            temperature: 1.0, // Creativity
            response_format: { type: "json_object" }, // Force JSON if supported, or just trust prompt
          }),
        },
      );

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`DeepSeek API error: ${response.status} ${errText}`);
      }

      const data = await response.json();
      const generatedContent = data.choices[0].message.content;

      let cardJson;
      try {
        cardJson = JSON.parse(generatedContent);
      } catch (e) {
        // Try to extract JSON from code block if present
        const match = generatedContent.match(/```json\n([\s\S]*?)\n```/);
        if (match) {
          cardJson = JSON.parse(match[1]);
        } else {
          throw new Error("Failed to parse JSON from LLM response");
        }
      }

      res.json({ card: cardJson, raw: generatedContent });
    } catch (e) {
      console.error("Card Generation Error:", e);
      res.status(500).json({ error: e.message });
    }
  });

  // 3. Save a new card
  app.post("/api/cards", authMiddleware, async (req, res) => {
    const card = req.body;

    // Basic validation
    if (!card.safetyType || !card.event || !card.phase || !card.options) {
      return res.status(400).json({ error: "Invalid card data structure" });
    }

    try {
      // Find next key if not provided or if provided key already exists
      let key = card.key;
      let exists = false;

      if (key) {
        const row = await cardsDbGet("SELECT 1 FROM cards WHERE key = ?", [
          key,
        ]);
        if (row) exists = true;
      }

      if (!key || exists) {
        // Auto-generate a key (max + 1)
        const maxKeyRow = await cardsDbGet("SELECT MAX(key) as k FROM cards");
        const maxKey = maxKeyRow?.k || 0;
        key = maxKey + 1;
      }

      const optionsJson = JSON.stringify(card.options);

      // New cards start as 'pending'
      const status = "pending";
      const version = 1;
      const createdAt = Date.now();

      const attributeReason = card.attributeReason || null;
      // 2026 卡牌包新增字段
      const cardCode = card.card_code || null;
      const workbench = card.workbench || "经典版";
      const title = card.title || null;
      const guideText = card.guide_text || null;
      const subtopic = card.subtopic || null;
      const whitepaperRef = card.whitepaper_ref || null;
      const trainerMaterialJson = card.trainer_material
        ? JSON.stringify(card.trainer_material)
        : null;

      const result = await cardsDbRun(
        `INSERT INTO cards (key, safety_type, event, phase, options_json, attribute_reason, status, version, created_at, updated_at, author_id,
         card_code, workbench, title, guide_text, subtopic, whitepaper_ref, trainer_material_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          key,
          card.safetyType,
          card.event,
          card.phase,
          optionsJson,
          attributeReason,
          status,
          version,
          createdAt,
          createdAt,
          req.user.uid,
          cardCode,
          workbench,
          title,
          guideText,
          subtopic,
          whitepaperRef,
          trainerMaterialJson,
        ],
      );

      // 同时在 card_versions 建初版
      const versionResult = await cardsDbRun(
        `INSERT INTO card_versions (card_id, key, safety_type, event, phase, options_json, attribute_reason, version, version_label, author_id, branch, created_at,
         card_code, workbench, title, guide_text, subtopic, whitepaper_ref, trainer_material_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          result.lastID,
          key,
          card.safetyType,
          card.event,
          card.phase,
          optionsJson,
          attributeReason,
          1,
          "v1-初版",
          req.user.uid,
          "main",
          createdAt,
          cardCode,
          workbench,
          title,
          guideText,
          subtopic,
          whitepaperRef,
          trainerMaterialJson,
        ],
      );

      // 回写 current_version_id
      await cardsDbRun("UPDATE cards SET current_version_id = ? WHERE id = ?", [
        versionResult.lastID,
        result.lastID,
      ]);

      res.json({ ok: true, id: result.lastID, key, status });
    } catch (e) {
      console.error("Save Card Error:", e);
      res.status(500).json({ error: "Failed to save card: " + e.message });
    }
  });

  // 4. Update Card (沙盒自由编辑 / 状态变更)
  app.put("/api/cards/:id", authMiddleware, async (req, res) => {
    const { id } = req.params;
    const updates = req.body;

    try {
      const existing = await cardsDbGet("SELECT * FROM cards WHERE id = ?", [
        id,
      ]);
      if (!existing) return res.status(404).json({ error: "Card not found" });

      const safetyType = updates.safetyType || existing.safety_type;
      const event = updates.event || existing.event;
      const phase =
        updates.phase !== undefined ? updates.phase : existing.phase;
      const status = updates.status || existing.status;
      const optionsJson = updates.options
        ? JSON.stringify(updates.options)
        : existing.options_json;
      const audioUrl =
        updates.audio_url !== undefined
          ? updates.audio_url || null
          : existing.audio_url;
      const attributeReason =
        updates.attributeReason !== undefined
          ? updates.attributeReason || null
          : existing.attribute_reason;
      const updatedAt = Date.now();

      // 2026 卡牌包新增字段（未传则保留原值）
      const cardCode =
        updates.card_code !== undefined
          ? updates.card_code || null
          : existing.card_code;
      const workbench =
        updates.workbench !== undefined
          ? updates.workbench || "经典版"
          : existing.workbench;
      const title =
        updates.title !== undefined ? updates.title || null : existing.title;
      const guideText =
        updates.guide_text !== undefined
          ? updates.guide_text || null
          : existing.guide_text;
      const subtopic =
        updates.subtopic !== undefined
          ? updates.subtopic || null
          : existing.subtopic;
      const whitepaperRef =
        updates.whitepaper_ref !== undefined
          ? updates.whitepaper_ref || null
          : existing.whitepaper_ref;
      const trainerMaterialJson =
        updates.trainer_material !== undefined
          ? updates.trainer_material
            ? JSON.stringify(updates.trainer_material)
            : null
          : existing.trainer_material_json;

      let deletedAt = existing.deleted_at;
      if (status === "deleted" && existing.status !== "deleted") {
        deletedAt = Date.now();
      } else if (status !== "deleted") {
        deletedAt = null;
      }

      await cardsDbRun(
        `UPDATE cards SET safety_type=?, event=?, phase=?, options_json=?, status=?, audio_url=?, attribute_reason=?, updated_at=?, deleted_at=?,
         card_code=?, workbench=?, title=?, guide_text=?, subtopic=?, whitepaper_ref=?, trainer_material_json=? WHERE id=?`,
        [
          safetyType,
          event,
          phase,
          optionsJson,
          status,
          audioUrl,
          attributeReason,
          updatedAt,
          deletedAt,
          cardCode,
          workbench,
          title,
          guideText,
          subtopic,
          whitepaperRef,
          trainerMaterialJson,
          id,
        ],
      );

      res.json({ ok: true, id, status });
    } catch (e) {
      console.error("Update Card Error:", e);
      res.status(500).json({ error: "Failed to update card: " + e.message });
    }
  });

  // 4.5 Bulk Release API (批量发布到游戏)
  app.post(
    "/api/admin/cards/bulk-release",
    authMiddleware,
    async (req, res) => {
      const { cardIds, secretKey } = req.body;
      if (!cardIds || !Array.isArray(cardIds) || cardIds.length === 0) {
        return res.status(400).json({ error: "No cardIds provided" });
      }

      let devKey = process.env.DEV_KEY || "sj0127wqt";
      try {
        const sysDbRow = await dbGet(
          "SELECT setting_value FROM system_settings WHERE setting_key = 'DEV_KEY'",
        );
        if (sysDbRow && sysDbRow.setting_value) devKey = sysDbRow.setting_value;
      } catch (e) {}

      if (secretKey !== devKey) {
        return res.status(403).json({ error: "密钥不正确，拒绝发布！" });
      }

      try {
        const results = [];
        const now = Date.now();
        for (const id of cardIds) {
          const card = await cardsDbGet("SELECT * FROM cards WHERE id = ?", [
            id,
          ]);
          if (!card) continue;

          // 插入 cards_released 快照
          await cardsDbRun(
            `INSERT INTO cards_released (card_id, key, safety_type, event, phase, options_json, audio_url, attribute_reason, version_label, from_version_id, released_by, released_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              card.id,
              card.key,
              card.safety_type,
              card.event,
              card.phase,
              card.options_json,
              card.audio_url,
              card.attribute_reason,
              card.version_label || `v${card.version || 1}版`,
              card.current_version_id,
              req.user.uid,
              now,
            ],
          );

          // 确保 cards.status 为 active
          if (card.status !== "active") {
            await cardsDbRun(
              "UPDATE cards SET status='active', updated_at=? WHERE id=?",
              [now, id],
            );
          }

          results.push({ id, key: card.key });
        }

        res.json({ ok: true, results });
      } catch (e) {
        console.error("Bulk Release Error:", e);
        res
          .status(500)
          .json({ error: "Failed to bulk release cards: " + e.message });
      }
    },
  );

  // 兼容旧路由
  app.post(
    "/api/admin/cards/bulk-publish",
    authMiddleware,
    (req, res, next) => {
      req.url = "/api/admin/cards/bulk-release";
      next();
    },
  );

  // 4.6 Bulk Upsert API (按 key upsert 卡牌到沙盒，含写版本，DEV_KEY 鉴权)
  app.post("/api/admin/cards/bulk-upsert", async (req, res) => {
    const { cards, secretKey, authorId, status, versionLabel } = req.body || {};
    if (!Array.isArray(cards) || cards.length === 0) {
      return res.status(400).json({ error: "No cards provided" });
    }

    let devKey = process.env.DEV_KEY || "sj0127wqt";
    try {
      const sysDbRow = await dbGet(
        "SELECT setting_value FROM system_settings WHERE setting_key = 'DEV_KEY'",
      );
      if (sysDbRow && sysDbRow.setting_value) devKey = sysDbRow.setting_value;
    } catch (e) {}
    if (secretKey !== devKey) {
      return res.status(403).json({ error: "密钥不正确" });
    }

    const finalStatus = status || "active";
    const label = versionLabel || "沙盒同步";
    const author = Number.isInteger(authorId) ? authorId : null;
    const now = Date.now();
    const results = [];

    try {
      for (const c of cards) {
        if (!c || c.key == null || !c.safetyType || !c.event || !c.options) {
          results.push({ key: c?.key, ok: false, error: "missing fields" });
          continue;
        }
        const optionsJson = JSON.stringify(c.options);
        const attrReason = c.attributeReason || null;
        const existing = await cardsDbGet(
          "SELECT id, version FROM cards WHERE key = ?",
          [c.key],
        );
        let cardId, newVer;
        if (existing) {
          newVer = (existing.version || 1) + 1;
          await cardsDbRun(
            `UPDATE cards SET safety_type=?, phase=?, event=?, options_json=?, attribute_reason=?, status=?, version=?, updated_at=?, author_id=?, branch='release' WHERE id=?`,
            [
              c.safetyType,
              c.phase || null,
              c.event,
              optionsJson,
              attrReason,
              finalStatus,
              newVer,
              now,
              author,
              existing.id,
            ],
          );
          cardId = existing.id;
        } else {
          const ins = await cardsDbRun(
            `INSERT INTO cards (key, safety_type, phase, event, options_json, attribute_reason, status, version, created_at, updated_at, author_id, branch)
           VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, 'release')`,
            [
              c.key,
              c.safetyType,
              c.phase || null,
              c.event,
              optionsJson,
              attrReason,
              finalStatus,
              now,
              now,
              author,
            ],
          );
          cardId = ins.lastID;
          newVer = 1;
        }
        const verIns = await cardsDbRun(
          `INSERT INTO card_versions (card_id, key, safety_type, event, phase, options_json, attribute_reason, status, version, version_label, created_at, author_id, note, branch, promoted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'main', ?)`,
          [
            cardId,
            c.key,
            c.safetyType,
            c.event,
            c.phase || null,
            optionsJson,
            attrReason,
            finalStatus,
            newVer,
            label,
            now,
            author,
            c.note || null,
            now,
          ],
        );
        await cardsDbRun("UPDATE cards SET current_version_id=? WHERE id=?", [
          verIns.lastID,
          cardId,
        ]);
        results.push({
          key: c.key,
          id: cardId,
          version: newVer,
          ok: true,
          action: existing ? "updated" : "inserted",
        });
      }
      res.json({ ok: true, count: results.length, results });
    } catch (e) {
      console.error("Bulk Upsert Error:", e);
      res.status(500).json({ error: "Failed to bulk upsert: " + e.message });
    }
  });

  // 5. Soft Delete Card (Shortcut)
  app.delete("/api/cards/:id", authMiddleware, async (req, res) => {
    const { id } = req.params;
    try {
      const existing = await cardsDbGet("SELECT * FROM cards WHERE id = ?", [
        id,
      ]);
      if (!existing) return res.status(404).json({ error: "Card not found" });

      const newVersion = (existing.version || 0) + 1;
      const now = Date.now();

      await cardsDbRun(
        `UPDATE cards SET status='deleted', version=?, updated_at=?, deleted_at=? WHERE id=?`,
        [newVersion, now, now, id],
      );

      res.json({ ok: true, id, status: "deleted" });
    } catch (e) {
      res.status(500).json({ error: "Failed to delete card: " + e.message });
    }
  });
}

export function registerCardVersionRoutes(app) {
  // ======== API: 卡牌版本和批注 ========
  app.get("/api/admin/cards/:id/versions", authMiddleware, async (req, res) => {
    try {
      const id = req.params.id;
      const card = await cardsDbGet("SELECT * FROM cards WHERE id = ?", [id]);
      if (!card) return res.json({ versions: [] });

      const history = await cardsDbAll(
        "SELECT * FROM card_versions WHERE card_id = ? ORDER BY created_at DESC",
        [id],
      );

      // 权限过滤：boss 全量可见，普通用户只看自己的版本
      const filtered = history.filter((c) => {
        if (req.user.role === "boss") return true;
        if (String(c.author_id) === String(req.user.uid)) return true;
        return false;
      });

      const versions = filtered.map((c) => ({
        id: c.id,
        version: c.version,
        version_label: c.version_label,
        branch: c.branch || "main",
        note: c.note || null,
        event: c.event,
        safetyType: c.safety_type,
        phase: c.phase,
        audio_url: c.audio_url || null,
        attribute_reason: c.attribute_reason || null,
        options: JSON.parse(c.options_json),
        author_id: c.author_id || null,
        parent_id: c.parent_id || null,
        promoted_at: c.promoted_at || null,
        is_current: card.current_version_id === c.id,
        created_at: c.created_at,
      }));

      res.json({ versions, current_version_id: card.current_version_id });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // 删除单个历史版本
  app.delete(
    "/api/admin/cards/:id/versions/:verId",
    authMiddleware,
    async (req, res) => {
      try {
        const { id, verId } = req.params;

        const versionRow = await cardsDbGet(
          "SELECT * FROM card_versions WHERE id = ? AND card_id = ?",
          [verId, id],
        );
        if (!versionRow) {
          return res
            .status(404)
            .json({ error: "指定的历史版本未找到或已删除" });
        }

        // 权限校验
        if (req.user.role !== "boss") {
          if (String(versionRow.author_id) !== String(req.user.uid)) {
            return res
              .status(403)
              .json({ error: "您没有权限删除他人创建的版本！" });
          }
        }

        await cardsDbRun("DELETE FROM card_versions WHERE id = ?", [verId]);
        res.json({ ok: true });
      } catch (e) {
        console.error("Delete Version Error:", e);
        res.status(500).json({ error: e.message });
      }
    },
  );

  app.get("/api/admin/cards/:id/notes", authMiddleware, async (req, res) => {
    try {
      const card = await cardsDbGet("SELECT notes FROM cards WHERE id = ?", [
        req.params.id,
      ]);
      if (!card) return res.status(404).json({ error: "卡牌不存在" });
      const notes = card.notes ? JSON.parse(card.notes) : [];
      res.json({ notes });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/admin/cards/:id/notes", authMiddleware, async (req, res) => {
    const { content, selected_text } = req.body || {};
    if (!content) return res.status(400).json({ error: "批注内容不能为空" });
    try {
      const card = await cardsDbGet("SELECT notes FROM cards WHERE id = ?", [
        req.params.id,
      ]);
      if (!card) return res.status(404).json({ error: "卡牌不存在" });
      const notes = card.notes ? JSON.parse(card.notes) : [];
      const ts = Date.now();
      notes.push({
        id: ts,
        author: req.user.uid,
        author_name: req.user.username || null,
        content,
        selected_text: selected_text || null,
        completed: false,
        created_at: ts,
      });
      await cardsDbRun("UPDATE cards SET notes=? WHERE id=?", [
        JSON.stringify(notes),
        req.params.id,
      ]);
      res.json({ ok: true, notes });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // 编辑批注（修改内容 or 标记完成）
  app.put(
    "/api/admin/cards/:id/notes/:noteId",
    authMiddleware,
    async (req, res) => {
      const { content, completed } = req.body || {};
      try {
        const card = await cardsDbGet("SELECT notes FROM cards WHERE id = ?", [
          req.params.id,
        ]);
        if (!card) return res.status(404).json({ error: "卡牌不存在" });
        const notes = card.notes ? JSON.parse(card.notes) : [];
        const nid = parseInt(req.params.noteId);
        const idx = notes.findIndex(
          (n) => n.id === nid || n.created_at === nid,
        );
        if (idx === -1) return res.status(404).json({ error: "批注不存在" });
        if (content !== undefined) notes[idx].content = content;
        if (completed !== undefined) notes[idx].completed = completed;
        await cardsDbRun("UPDATE cards SET notes=? WHERE id=?", [
          JSON.stringify(notes),
          req.params.id,
        ]);
        res.json({ ok: true });
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    },
  );

  // 删除批注
  app.delete(
    "/api/admin/cards/:id/notes/:noteId",
    authMiddleware,
    async (req, res) => {
      try {
        const card = await cardsDbGet("SELECT notes FROM cards WHERE id = ?", [
          req.params.id,
        ]);
        if (!card) return res.status(404).json({ error: "卡牌不存在" });
        const notes = card.notes ? JSON.parse(card.notes) : [];
        const nid = parseInt(req.params.noteId);
        const filtered = notes.filter(
          (n) => n.id !== nid && n.created_at !== nid,
        );
        if (filtered.length === notes.length)
          return res.status(404).json({ error: "批注不存在" });
        await cardsDbRun("UPDATE cards SET notes=? WHERE id=?", [
          JSON.stringify(filtered),
          req.params.id,
        ]);
        res.json({ ok: true });
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    },
  );

  // 创建新版本（存入 card_versions）
  app.post("/api/admin/cards/:id/branch", authMiddleware, async (req, res) => {
    const { version_label, note, branch, parent_id } = req.body || {};
    try {
      const src = await cardsDbGet("SELECT * FROM cards WHERE id = ?", [
        req.params.id,
      ]);
      if (!src) return res.status(404).json({ error: "卡牌不存在" });

      const label =
        version_label ||
        `v${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-新版本`;
      const branchName = branch || "main";
      const now = Date.now();

      // 计算下一版本号
      const maxVer = await cardsDbGet(
        "SELECT MAX(version) as v FROM card_versions WHERE card_id = ?",
        [src.id],
      );
      const nextVersion = (maxVer?.v || src.version || 0) + 1;

      const result = await cardsDbRun(
        `INSERT INTO card_versions(card_id, key, safety_type, event, phase, options_json, audio_url, attribute_reason, version, version_label, note, branch, parent_id, author_id, created_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          src.id,
          src.key,
          src.safety_type,
          src.event,
          src.phase,
          src.options_json,
          src.audio_url,
          src.attribute_reason,
          nextVersion,
          label,
          note || null,
          branchName,
          parent_id || null,
          req.user.uid,
          now,
        ],
      );
      res.json({
        ok: true,
        version_id: result.lastID,
        version: nextVersion,
        version_label: label,
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // 更新版本内容
  app.put("/api/admin/card-versions/:id", authMiddleware, async (req, res) => {
    try {
      const ver = await cardsDbGet("SELECT * FROM card_versions WHERE id = ?", [
        req.params.id,
      ]);
      if (!ver) return res.status(404).json({ error: "版本不存在" });

      const updates = req.body;
      const safetyType = updates.safetyType || ver.safety_type;
      const event = updates.event || ver.event;
      const phase = updates.phase !== undefined ? updates.phase : ver.phase;
      const optionsJson = updates.options
        ? JSON.stringify(updates.options)
        : ver.options_json;
      const audioUrl =
        updates.audio_url !== undefined ? updates.audio_url : ver.audio_url;
      const attributeReason =
        updates.attributeReason !== undefined
          ? updates.attributeReason || null
          : ver.attribute_reason;
      const nowStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      const submitter = req.user.username || String(req.user.uid);
      const desc = updates.versionDesc ? ` · ${updates.versionDesc}` : "";
      const versionLabel =
        updates.version_label ||
        `v${ver.version || 1}.${nowStr}版 — ${submitter}${desc}`;
      const note = updates.note !== undefined ? updates.note : ver.note;

      await cardsDbRun(
        `UPDATE card_versions SET safety_type=?, event=?, phase=?, options_json=?, audio_url=?, attribute_reason=?, version_label=?, note=?, author_id=? WHERE id=?`,
        [
          safetyType,
          event,
          phase,
          optionsJson,
          audioUrl,
          attributeReason,
          versionLabel,
          note,
          req.user.uid,
          req.params.id,
        ],
      );
      res.json({
        ok: true,
        version_id: parseInt(req.params.id),
        version_label: versionLabel,
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Promote: 把某个版本推送到沙盒（card_versions → cards）
  app.post(
    "/api/admin/card-versions/:id/promote",
    authMiddleware,
    async (req, res) => {
      try {
        const ver = await cardsDbGet(
          "SELECT * FROM card_versions WHERE id = ?",
          [req.params.id],
        );
        if (!ver) return res.status(404).json({ error: "版本不存在" });

        const now = Date.now();
        await cardsDbRun(
          `UPDATE cards SET safety_type=?, event=?, phase=?, options_json=?, audio_url=?, attribute_reason=?,
       current_version_id=?, status='active', updated_at=? WHERE id=?`,
          [
            ver.safety_type,
            ver.event,
            ver.phase,
            ver.options_json,
            ver.audio_url,
            ver.attribute_reason,
            ver.id,
            now,
            ver.card_id,
          ],
        );

        // 记录推送时间
        await cardsDbRun("UPDATE card_versions SET promoted_at=? WHERE id=?", [
          now,
          ver.id,
        ]);

        res.json({ ok: true, card_id: ver.card_id, version_id: ver.id });
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    },
  );

  // Release: 把沙盒内容发布到游戏（cards → cards_released）
  app.post("/api/admin/cards/:id/release", authMiddleware, async (req, res) => {
    try {
      const card = await cardsDbGet("SELECT * FROM cards WHERE id = ?", [
        req.params.id,
      ]);
      if (!card) return res.status(404).json({ error: "卡牌不存在" });
      if (card.status !== "active")
        return res.status(400).json({ error: "只能发布 active 状态的卡牌" });

      const now = Date.now();
      const label =
        req.body?.version_label ||
        `发布于${new Date().toISOString().slice(0, 10)}`;

      await cardsDbRun(
        `INSERT INTO cards_released (card_id, key, safety_type, event, phase, options_json, audio_url, attribute_reason, card_code, title, guide_text, version_label, from_version_id, released_by, released_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          card.id,
          card.key,
          card.safety_type,
          card.event,
          card.phase,
          card.options_json,
          card.audio_url,
          card.attribute_reason,
          card.card_code,
          card.title,
          card.guide_text,
          label,
          card.current_version_id,
          req.user.uid,
          now,
        ],
      );

      res.json({ ok: true, card_id: card.id, key: card.key });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ======== 登录 / 账号资产模块路由（已抽出到 src/routes/）========
}
