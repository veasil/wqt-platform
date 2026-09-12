import bcrypt from "bcryptjs";
import { dbRun, dbGet, dbAll } from "../../db.js";
import { authMiddleware } from "../../middleware/auth.js";
import { requireRole, requireEnterprise } from "../../middleware/rbac.js";
import { normalizePhone } from "../../services/sms.js";
import {
  generateActivityCode,
  generateInviteCode,
} from "../../game/activities/codes.js";

export function registerOrganizationRoutes(app) {
  // ======== API: Boss 组织管理 ========

  // 创建组织 + 组织管理员账号
  app.post(
    "/api/admin/organizations",
    authMiddleware,
    requireRole("boss"),
    async (req, res) => {
      const {
        orgName,
        description,
        maxMembers,
        adminPhone,
        adminName,
        adminPassword,
      } = req.body || {};
      if (!orgName) return res.status(400).json({ error: "组织名称不能为空" });
      if (!adminPhone)
        return res.status(400).json({ error: "管理员手机号不能为空" });
      const cleanPhone = normalizePhone(adminPhone);
      if (cleanPhone.length < 6)
        return res.status(400).json({ error: "管理员手机号格式不正确" });

      try {
        // 检查手机号是否已关联其他组织
        const existingUser = await dbGet(
          "SELECT id, enterprise_id, role FROM users WHERE phone = ?",
          [cleanPhone],
        );
        if (
          existingUser &&
          (existingUser.role === "boss" || existingUser.role === "operator")
        ) {
          return res.status(409).json({
            error: "该账号已是系统管理员（boss/运营），不能作为组织管理员",
          });
        }
        if (existingUser && existingUser.enterprise_id) {
          return res.status(409).json({ error: "该手机号已关联其他组织" });
        }

        // 创建组织
        const orgResult = await dbRun(
          "INSERT INTO organizations(name, description, max_members, owner_user_id) VALUES(?,?,?,?)",
          [orgName, description || null, maxMembers || 50, 0], // owner_user_id 先占位
        );
        const orgId = orgResult.lastID;

        let adminUserId;
        if (existingUser) {
          // 已有账号：升级为组织管理员
          await dbRun(
            "UPDATE users SET role='enterprise', enterprise_id=? WHERE id=?",
            [orgId, existingUser.id],
          );
          adminUserId = existingUser.id;
        } else {
          // 创建新用户
          const defaultPwd = adminPassword || cleanPhone.slice(-6);
          const hash = bcrypt.hashSync(defaultPwd, 10);
          const r = await dbRun(
            "INSERT INTO users(phone, guardian_name, real_name, password_hash, role, enterprise_id, is_profile_complete) VALUES(?,?,?,?,'enterprise',?,1)",
            [cleanPhone, adminName || null, adminName || null, hash, orgId],
          );
          adminUserId = r.lastID;
        }

        // 回填 owner_user_id
        await dbRun("UPDATE organizations SET owner_user_id=? WHERE id=?", [
          adminUserId,
          orgId,
        ]);

        res.json({
          ok: true,
          organization: {
            id: orgId,
            name: orgName,
            maxMembers: maxMembers || 50,
          },
          adminUser: { id: adminUserId, phone: cleanPhone, role: "enterprise" },
        });
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    },
  );

  // 列出所有组织
  app.get(
    "/api/admin/organizations",
    authMiddleware,
    requireRole("boss"),
    async (req, res) => {
      try {
        const rows = await dbAll(`
      SELECT o.*,
        (SELECT COUNT(*) FROM users WHERE enterprise_id = o.id) as current_members,
        u.guardian_name as owner_name, u.phone as owner_phone
      FROM organizations o
      LEFT JOIN users u ON u.id = o.owner_user_id
      ORDER BY o.created_at DESC
    `);
        res.json({ organizations: rows });
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    },
  );

  // 更新组织
  app.put(
    "/api/admin/organizations/:id",
    authMiddleware,
    requireRole("boss"),
    async (req, res) => {
      const { name, description, maxMembers, status } = req.body || {};
      try {
        const org = await dbGet("SELECT * FROM organizations WHERE id = ?", [
          req.params.id,
        ]);
        if (!org) return res.status(404).json({ error: "组织不存在" });
        await dbRun(
          "UPDATE organizations SET name=?, description=?, max_members=?, status=?, updated_at=? WHERE id=?",
          [
            name || org.name,
            description ?? org.description,
            maxMembers || org.max_members,
            status || org.status,
            Date.now(),
            req.params.id,
          ],
        );
        res.json({ ok: true });
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    },
  );

  // 停用组织
  app.delete(
    "/api/admin/organizations/:id",
    authMiddleware,
    requireRole("boss"),
    async (req, res) => {
      try {
        await dbRun(
          "UPDATE organizations SET status='suspended', updated_at=? WHERE id=?",
          [Date.now(), req.params.id],
        );
        res.json({ ok: true });
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    },
  );

  // Boss 给组织加人
  app.post(
    "/api/admin/organizations/:id/members",
    authMiddleware,
    requireRole("boss"),
    async (req, res) => {
      const orgId = Number(req.params.id);
      const { phone, guardianName, realName, password } = req.body || {};
      if (!phone) return res.status(400).json({ error: "手机号不能为空" });
      const cleanPhone = normalizePhone(phone);

      try {
        const org = await dbGet(
          "SELECT * FROM organizations WHERE id = ? AND status = 'active'",
          [orgId],
        );
        if (!org) return res.status(404).json({ error: "组织不存在或已停用" });

        // 检查配额
        const memberCount = await dbGet(
          "SELECT COUNT(*) as cnt FROM users WHERE enterprise_id = ?",
          [orgId],
        );
        if (memberCount.cnt >= org.max_members)
          return res.status(400).json({ error: "组织成员已满" });

        // 检查手机号
        const exists = await dbGet(
          "SELECT id, enterprise_id FROM users WHERE phone = ?",
          [cleanPhone],
        );
        if (exists && exists.enterprise_id)
          return res.status(409).json({ error: "该手机号已关联组织" });

        if (exists) {
          await dbRun("UPDATE users SET enterprise_id=? WHERE id=?", [
            orgId,
            exists.id,
          ]);
          res.json({ ok: true, user: { id: exists.id, phone: cleanPhone } });
        } else {
          const defaultPwd = password || cleanPhone.slice(-6);
          const hash = bcrypt.hashSync(defaultPwd, 10);
          const r = await dbRun(
            "INSERT INTO users(phone, guardian_name, real_name, password_hash, role, enterprise_id, is_profile_complete) VALUES(?,?,?,?,'watcher',?,1)",
            [cleanPhone, guardianName || null, realName || null, hash, orgId],
          );
          res.json({ ok: true, user: { id: r.lastID, phone: cleanPhone } });
        }
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    },
  );

  // ======== Boss 邀请码管理 ========
  app.post(
    "/api/admin/invite-codes",
    authMiddleware,
    requireRole("boss"),
    async (req, res) => {
      const { maxUses, expiresInDays, organizationId } = req.body || {};
      try {
        const code = await generateInviteCode();
        const expiresAt =
          Date.now() + (expiresInDays || 3) * 24 * 60 * 60 * 1000;
        const type = organizationId ? "organization" : "general";
        const result = await dbRun(
          "INSERT INTO invite_codes(code, type, organization_id, created_by, max_uses, expires_at) VALUES(?,?,?,?,?,?)",
          [
            code,
            type,
            organizationId || null,
            req.user.uid,
            maxUses || 1,
            expiresAt,
          ],
        );
        res.json({ ok: true, id: result.lastID, code, type, expiresAt });
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    },
  );

  app.get(
    "/api/admin/invite-codes",
    authMiddleware,
    requireRole("boss"),
    async (req, res) => {
      try {
        const rows = await dbAll(`
      SELECT ic.*, o.name as org_name, u.guardian_name as creator_name
      FROM invite_codes ic
      LEFT JOIN organizations o ON o.id = ic.organization_id
      LEFT JOIN users u ON u.id = ic.created_by
      ORDER BY ic.created_at DESC
    `);
        res.json({ codes: rows });
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    },
  );

  // ======== API: 组织管理员端点 ========

  // 获取本组织信息
  app.get(
    "/api/enterprise/info",
    authMiddleware,
    requireEnterprise,
    async (req, res) => {
      try {
        const memberCount = await dbGet(
          "SELECT COUNT(*) as cnt FROM users WHERE enterprise_id = ?",
          [req.org.id],
        );
        res.json({
          organization: {
            id: req.org.id,
            name: req.org.name,
            description: req.org.description,
            maxMembers: req.org.max_members,
            currentMembers: memberCount.cnt,
            createdAt: req.org.created_at,
            validUntil: req.org.valid_until,
            status: req.org.status,
          },
        });
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    },
  );

  // 列出本组织成员
  app.get(
    "/api/enterprise/members",
    authMiddleware,
    requireEnterprise,
    async (req, res) => {
      try {
        const members = await dbAll(
          `
      SELECT u.id, u.username, u.phone, u.real_name, u.guardian_name, u.watcher_level, u.created_at,
        (SELECT MAX(gs.started_at) FROM game_sessions gs WHERE gs.user_id = u.id AND gs.organization_id = ? AND gs.ownership_kind = 'organization') as last_active,
        (SELECT COUNT(*) FROM game_sessions gs WHERE gs.user_id = u.id AND gs.organization_id = ? AND gs.ownership_kind = 'organization') as total_games
      FROM users u
      WHERE u.enterprise_id = ? AND u.id != ?
      ORDER BY u.created_at DESC
    `,
          [req.org.id, req.org.id, req.org.id, req.user.uid],
        );
        const memberCount = await dbGet(
          "SELECT COUNT(*) as cnt FROM users WHERE enterprise_id = ?",
          [req.org.id],
        );
        res.json({
          members,
          quota: { max: req.org.max_members, used: memberCount.cnt },
        });
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    },
  );

  // 创建成员账号
  app.post(
    "/api/enterprise/members",
    authMiddleware,
    requireEnterprise,
    async (req, res) => {
      const { phone, guardianName, realName, password } = req.body || {};
      if (!phone) return res.status(400).json({ error: "手机号不能为空" });
      const cleanPhone = normalizePhone(phone);

      try {
        // 检查配额
        const memberCount = await dbGet(
          "SELECT COUNT(*) as cnt FROM users WHERE enterprise_id = ?",
          [req.org.id],
        );
        if (memberCount.cnt >= req.org.max_members)
          return res.status(400).json({ error: "成员已达上限" });

        const exists = await dbGet(
          "SELECT id, enterprise_id FROM users WHERE phone = ?",
          [cleanPhone],
        );
        if (exists && exists.enterprise_id)
          return res.status(409).json({ error: "该手机号已关联组织" });
        if (exists) {
          await dbRun("UPDATE users SET enterprise_id=? WHERE id=?", [
            req.org.id,
            exists.id,
          ]);
          return res.json({
            ok: true,
            user: { id: exists.id, phone: cleanPhone },
          });
        }

        const defaultPwd = password || cleanPhone.slice(-6);
        const hash = bcrypt.hashSync(defaultPwd, 10);
        const r = await dbRun(
          "INSERT INTO users(phone, guardian_name, real_name, password_hash, role, enterprise_id, is_profile_complete) VALUES(?,?,?,?,'watcher',?,1)",
          [
            cleanPhone,
            guardianName || null,
            realName || null,
            hash,
            req.org.id,
          ],
        );
        res.json({ ok: true, user: { id: r.lastID, phone: cleanPhone } });
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    },
  );

  // 修改成员
  app.put(
    "/api/enterprise/members/:id",
    authMiddleware,
    requireEnterprise,
    async (req, res) => {
      const memberId = req.params.id;
      const { guardianName, realName, password } = req.body || {};
      try {
        const member = await dbGet(
          "SELECT * FROM users WHERE id = ? AND enterprise_id = ?",
          [memberId, req.org.id],
        );
        if (!member)
          return res.status(404).json({ error: "成员不存在或不属于本组织" });

        const updates = [];
        const params = [];
        if (guardianName !== undefined) {
          updates.push("guardian_name=?");
          params.push(guardianName);
        }
        if (realName !== undefined) {
          updates.push("real_name=?");
          params.push(realName);
        }
        if (password) {
          updates.push("password_hash=?");
          params.push(bcrypt.hashSync(password, 10));
        }
        if (updates.length === 0)
          return res.status(400).json({ error: "无更新内容" });

        params.push(memberId);
        await dbRun(`UPDATE users SET ${updates.join(",")} WHERE id=?`, params);
        res.json({ ok: true });
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    },
  );

  // 移除成员
  app.delete(
    "/api/enterprise/members/:id",
    authMiddleware,
    requireEnterprise,
    async (req, res) => {
      try {
        const member = await dbGet(
          "SELECT * FROM users WHERE id = ? AND enterprise_id = ?",
          [req.params.id, req.org.id],
        );
        if (!member)
          return res.status(404).json({ error: "成员不存在或不属于本组织" });
        await dbRun("UPDATE users SET enterprise_id = NULL WHERE id = ?", [
          req.params.id,
        ]);
        res.json({ ok: true });
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    },
  );

  // 单个成员统计
  app.get(
    "/api/enterprise/members/:id/stats",
    authMiddleware,
    requireEnterprise,
    async (req, res) => {
      const memberId = req.params.id;
      try {
        const member = await dbGet(
          "SELECT id, guardian_name, phone FROM users WHERE id = ? AND enterprise_id = ?",
          [memberId, req.org.id],
        );
        if (!member) return res.status(403).json({ error: "非本组织成员" });

        const sessions = await dbAll(
          "SELECT id, started_at, ended_at, final_score, game_mode FROM game_sessions WHERE user_id = ? AND organization_id = ? AND ownership_kind = 'organization' ORDER BY started_at DESC",
          [memberId, req.org.id],
        );
        const totalGames = sessions.length;
        const avgScore = totalGames
          ? Math.round(
              sessions.reduce((s, r) => s + (r.final_score || 0), 0) /
                totalGames,
            )
          : 0;
        res.json({ member, stats: { totalGames, avgScore, sessions } });
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    },
  );

  // 组织级统计
  app.get(
    "/api/enterprise/dashboard",
    authMiddleware,
    requireEnterprise,
    async (req, res) => {
      try {
        const orgId = req.org.id;
        const totalMembers = await dbGet(
          "SELECT COUNT(*) as cnt FROM users WHERE enterprise_id = ?",
          [orgId],
        );
        const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
        const activeMembers = await dbGet(
          `
      SELECT COUNT(DISTINCT gs.user_id) as cnt FROM game_sessions gs
      WHERE gs.organization_id = ? AND gs.ownership_kind = 'organization' AND gs.started_at > ?
    `,
          [orgId, thirtyDaysAgo],
        );
        const sessionStats = await dbGet(
          `
      SELECT COUNT(*) as total, ROUND(AVG(gs.final_score), 1) as avg_score
      FROM game_sessions gs
      WHERE gs.organization_id = ? AND gs.ownership_kind = 'organization'
    `,
          [orgId],
        );
        const recentSessions = await dbAll(
          `
      SELECT gs.id, gs.started_at, gs.ended_at, gs.final_score, gs.game_mode,
             u.guardian_name, u.phone
      FROM game_sessions gs LEFT JOIN users u ON u.id = gs.user_id
      WHERE gs.organization_id = ? AND gs.ownership_kind = 'organization'
      ORDER BY gs.started_at DESC LIMIT 10
    `,
          [orgId],
        );
        const membersByLevel = await dbAll(
          `
      SELECT watcher_level, COUNT(*) as cnt FROM users WHERE enterprise_id = ? GROUP BY watcher_level
    `,
          [orgId],
        );

        res.json({
          totalMembers: totalMembers.cnt,
          activeMembers: activeMembers.cnt,
          totalSessions: sessionStats.total,
          avgScore: sessionStats.avg_score,
          recentSessions,
          membersByLevel: Object.fromEntries(
            membersByLevel.map((r) => [r.watcher_level, r.cnt]),
          ),
        });
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    },
  );

  // 组织的游戏场次列表
  app.get(
    "/api/enterprise/sessions",
    authMiddleware,
    requireEnterprise,
    async (req, res) => {
      const { page = 1, limit = 20, memberId, activityId } = req.query;
      try {
        let sql = `
      SELECT gs.id, gs.user_id, gs.started_at, gs.ended_at, gs.final_score, gs.game_mode,
             u.guardian_name, u.phone
      FROM game_sessions gs LEFT JOIN users u ON u.id = gs.user_id
      WHERE gs.organization_id = ? AND gs.ownership_kind = 'organization'
    `;
        const params = [req.org.id];
        if (memberId) {
          sql += " AND gs.user_id = ?";
          params.push(Number(memberId));
        }
        if (activityId) {
          sql +=
            " AND gs.id IN (SELECT session_id FROM activity_sessions WHERE activity_id = ?)";
          params.push(Number(activityId));
        }

        // 总数
        const countSql = `SELECT COUNT(*) AS total FROM (${sql}) visible_sessions`;
        const total = await dbGet(countSql, params);

        sql += " ORDER BY gs.started_at DESC LIMIT ? OFFSET ?";
        params.push(Number(limit), (Number(page) - 1) * Number(limit));
        const sessions = await dbAll(sql, params);

        res.json({
          sessions,
          total: total.total,
          page: Number(page),
          limit: Number(limit),
        });
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    },
  );

  // ======== 组织管理员：活动管理 ========

  app.get(
    "/api/enterprise/activities",
    authMiddleware,
    requireEnterprise,
    async (req, res) => {
      try {
        const rows = await dbAll(
          `
      SELECT a.*,
        COUNT(DISTINCT gs.id) as table_count,
        COUNT(DISTINCT gs.user_id) as participant_count,
        ROUND(AVG(gs.final_score), 1) as avg_score
      FROM activities a
      LEFT JOIN activity_sessions as2 ON as2.activity_id = a.id
      LEFT JOIN game_sessions gs ON gs.id = as2.session_id
        AND gs.organization_id = ? AND gs.ownership_kind = 'organization'
      WHERE a.enterprise_id = ?
      GROUP BY a.id
      ORDER BY a.created_at DESC
    `,
          [req.org.id, req.org.id],
        );
        res.json({ activities: rows });
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    },
  );

  app.post(
    "/api/enterprise/activities",
    authMiddleware,
    requireEnterprise,
    async (req, res) => {
      const { name, organizer, started_at, ended_at } = req.body || {};
      if (!name) return res.status(400).json({ error: "活动名称不能为空" });
      try {
        const code = await generateActivityCode("enterprise");
        const result = await dbRun(
          "INSERT INTO activities(name, organizer, activity_code, started_at, ended_at, created_by, enterprise_id) VALUES(?,?,?,?,?,?,?)",
          [
            name,
            organizer || null,
            code,
            started_at || null,
            ended_at || null,
            req.user.uid,
            req.org.id,
          ],
        );
        res.json({ ok: true, id: result.lastID, activity_code: code });
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    },
  );

  app.put(
    "/api/enterprise/activities/:id",
    authMiddleware,
    requireEnterprise,
    async (req, res) => {
      const { name, organizer, started_at, ended_at, status } = req.body || {};
      try {
        const existing = await dbGet(
          "SELECT * FROM activities WHERE id = ? AND enterprise_id = ?",
          [req.params.id, req.org.id],
        );
        if (!existing)
          return res.status(404).json({ error: "活动不存在或不属于本组织" });
        await dbRun(
          "UPDATE activities SET name=?, organizer=?, started_at=?, ended_at=?, status=? WHERE id=?",
          [
            name || existing.name,
            organizer ?? existing.organizer,
            started_at ?? existing.started_at,
            ended_at ?? existing.ended_at,
            status || existing.status,
            req.params.id,
          ],
        );
        res.json({ ok: true });
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    },
  );

  app.get(
    "/api/enterprise/activities/:id/sessions",
    authMiddleware,
    requireEnterprise,
    async (req, res) => {
      try {
        const activity = await dbGet(
          "SELECT * FROM activities WHERE id = ? AND enterprise_id = ?",
          [req.params.id, req.org.id],
        );
        if (!activity)
          return res.status(404).json({ error: "活动不存在或不属于本组织" });
        const rows = await dbAll(
          `
      SELECT gs.id, gs.started_at, gs.ended_at, gs.final_score, gs.game_mode,
             u.guardian_name, u.phone, as2.table_no
      FROM activity_sessions as2
      JOIN game_sessions gs ON gs.id = as2.session_id
      LEFT JOIN users u ON u.id = gs.user_id
      WHERE as2.activity_id = ?
        AND gs.organization_id = ? AND gs.ownership_kind = 'organization'
      ORDER BY as2.table_no ASC
    `,
          [req.params.id, req.org.id],
        );
        res.json({ activity, sessions: rows });
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    },
  );

  // 组织管理员：邀请码管理
  app.post(
    "/api/enterprise/invite-codes",
    authMiddleware,
    requireEnterprise,
    async (req, res) => {
      const { maxUses, expiresInDays } = req.body || {};
      try {
        const code = await generateInviteCode();
        const expiresAt =
          Date.now() + (expiresInDays || 3) * 24 * 60 * 60 * 1000;
        const result = await dbRun(
          "INSERT INTO invite_codes(code, type, organization_id, created_by, max_uses, expires_at) VALUES(?,?,?,?,?,?)",
          [
            code,
            "organization",
            req.org.id,
            req.user.uid,
            maxUses || 1,
            expiresAt,
          ],
        );
        res.json({ ok: true, id: result.lastID, code, expiresAt });
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    },
  );

  app.get(
    "/api/enterprise/invite-codes",
    authMiddleware,
    requireEnterprise,
    async (req, res) => {
      try {
        const rows = await dbAll(
          "SELECT * FROM invite_codes WHERE organization_id = ? ORDER BY created_at DESC",
          [req.org.id],
        );
        res.json({ codes: rows });
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    },
  );
}
