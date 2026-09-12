import bcrypt from "bcryptjs";
import { PERMANENT_UNTIL } from "../account.js";

const SEED_LOCK_KEY = 20260912;

/**
 * Populate a fresh development database with a small, deterministic domain.
 * The caller owns the transaction; this function never initializes a database,
 * starts a runtime, or writes to an external service.
 */
export async function seedSyntheticData(tx, { password } = {}) {
  if (
    !tx ||
    typeof tx.get !== "function" ||
    typeof tx.run !== "function" ||
    typeof tx.all !== "function"
  ) {
    throw new TypeError("seedSyntheticData requires a transaction API");
  }
  if (typeof password !== "string" || password.length < 12) {
    throw new Error(
      "Synthetic seed password must be provided and contain at least 12 characters",
    );
  }

  // A transaction advisory lock makes the empty-check-and-seed operation one
  // critical section when two setup processes target the same database.
  await tx.get("SELECT pg_advisory_xact_lock(?)", [SEED_LOCK_KEY]);
  await tx.run(
    "LOCK TABLE users, organizations, game_sessions, activities, user_feedback, user_sessions, session_files, game_events, activity_sessions IN SHARE ROW EXCLUSIVE MODE",
  );
  const counts = await tx.all(
    `SELECT table_name, COUNT(*)::int AS count
       FROM (
         SELECT 'users' AS table_name, id::text AS row_id FROM users
         UNION ALL SELECT 'organizations', id::text FROM organizations
         UNION ALL SELECT 'game_sessions', id::text FROM game_sessions
         UNION ALL SELECT 'activities', id::text FROM activities
         UNION ALL SELECT 'user_feedback', id::text FROM user_feedback
         UNION ALL SELECT 'user_sessions', id::text FROM user_sessions
         UNION ALL SELECT 'session_files', id::text FROM session_files
         UNION ALL SELECT 'game_events', id::text FROM game_events
         UNION ALL SELECT 'activity_sessions', activity_id::text || ':' || session_id::text FROM activity_sessions
       ) existing
      GROUP BY table_name
      ORDER BY table_name`,
  );
  const nonEmpty = counts.filter((row) => Number(row.count) > 0);
  if (nonEmpty.length) {
    const details = nonEmpty
      .map((row) => `${row.table_name}=${row.count}`)
      .join(", ");
    throw new Error(`Synthetic seed requires empty domain tables: ${details}`);
  }

  const passwordHash = bcrypt.hashSync(password, 10);
  const now = Date.now();
  const ended = now - 60 * 60 * 1000;
  const active = now - 15 * 60 * 1000;

  const ids = { users: {}, organizations: {}, activities: {}, sessions: {} };
  ids.users.boss = await insertUser(tx, {
    username: "synthetic-boss",
    role: "boss",
    passwordHash,
    validUntil: PERMANENT_UNTIL,
    guardianName: "合成平台管理员",
  });
  ids.users.adminA = await insertUser(tx, {
    username: "synthetic-admin-a",
    role: "enterprise",
    passwordHash,
    enterpriseId: null,
    validUntil: PERMANENT_UNTIL,
    guardianName: "合成组织A管理员",
  });
  ids.users.memberA = await insertUser(tx, {
    username: "synthetic-member-a",
    role: "watcher",
    passwordHash,
    validUntil: PERMANENT_UNTIL,
    guardianName: "合成组织A成员",
  });
  ids.users.adminB = await insertUser(tx, {
    username: "synthetic-admin-b",
    role: "enterprise",
    passwordHash,
    validUntil: PERMANENT_UNTIL,
    guardianName: "合成组织B管理员",
  });
  ids.users.personal = await insertUser(tx, {
    username: "synthetic-personal",
    role: "watcher",
    passwordHash,
    validUntil: PERMANENT_UNTIL,
    guardianName: "合成个人玩家",
  });

  ids.organizations.orgA = await insertOrganization(
    tx,
    "Synthetic Organization A",
    ids.users.adminA,
  );
  ids.organizations.orgB = await insertOrganization(
    tx,
    "Synthetic Organization B",
    ids.users.adminB,
  );
  await tx.run("UPDATE users SET enterprise_id=? WHERE id IN (?,?)", [
    ids.organizations.orgA,
    ids.users.adminA,
    ids.users.memberA,
  ]);
  await tx.run("UPDATE users SET enterprise_id=? WHERE id=?", [
    ids.organizations.orgB,
    ids.users.adminB,
  ]);

  ids.sessions.orgAEnded = await insertSession(tx, {
    userId: ids.users.memberA,
    startedAt: ended - 45 * 60 * 1000,
    endedAt: ended,
    organizationId: ids.organizations.orgA,
    ownershipKind: "organization",
    finalScore: 8,
    status: "finished",
  });
  ids.sessions.personalEnded = await insertSession(tx, {
    userId: ids.users.personal,
    startedAt: ended - 30 * 60 * 1000,
    endedAt: ended - 15 * 60 * 1000,
    ownershipKind: "personal",
    finalScore: 6,
    status: "finished",
  });
  ids.sessions.legacyUnknown = await insertSession(tx, {
    userId: ids.users.boss,
    startedAt: ended - 90 * 60 * 1000,
    endedAt: ended - 80 * 60 * 1000,
    ownershipKind: "legacy_unknown",
    finalScore: 5,
    status: "finished",
  });
  ids.sessions.orgBActive = await insertSession(tx, {
    userId: ids.users.adminB,
    startedAt: active,
    organizationId: ids.organizations.orgB,
    ownershipKind: "organization",
    status: "active",
  });

  await tx.run(
    "INSERT INTO game_events(session_id, ts, type, payload) VALUES(?,?,?,?)",
    [
      ids.sessions.orgAEnded,
      ended - 40 * 60 * 1000,
      "card_choice",
      JSON.stringify({
        cardId: 1,
        choice: "synthetic-choice",
        source: "synthetic",
      }),
    ],
  );
  await tx.run(
    "INSERT INTO game_events(session_id, ts, type, payload) VALUES(?,?,?,?)",
    [
      ids.sessions.orgAEnded,
      ended - 5 * 60 * 1000,
      "card_choice",
      JSON.stringify({
        cardId: 2,
        choice: "synthetic-choice-2",
        source: "synthetic",
      }),
    ],
  );

  ids.activities.orgA = await insertActivity(
    tx,
    "Synthetic Activity A",
    "SYN-A",
    ids.users.adminA,
    ids.organizations.orgA,
    ended,
  );
  ids.activities.orgB = await insertActivity(
    tx,
    "Synthetic Activity B",
    "SYN-B",
    ids.users.adminB,
    ids.organizations.orgB,
    ended,
  );
  ids.activities.public = await insertActivity(
    tx,
    "Synthetic Public Activity",
    "SYN-PUBLIC",
    ids.users.boss,
    null,
    ended,
  );
  await tx.run(
    "INSERT INTO activity_sessions(activity_id, session_id, table_no) VALUES(?,?,?)",
    [ids.activities.orgA, ids.sessions.orgAEnded, 1],
  );
  await tx.run(
    "INSERT INTO activity_sessions(activity_id, session_id, table_no) VALUES(?,?,?)",
    [ids.activities.orgB, ids.sessions.orgBActive, 1],
  );
  await tx.run(
    "INSERT INTO activity_sessions(activity_id, session_id, table_no) VALUES(?,?,?)",
    [ids.activities.public, ids.sessions.personalEnded, 1],
  );

  await tx.run(
    "INSERT INTO user_feedback(user_id, type, content, activity_id, session_id) VALUES(?,?,?,?,?)",
    [
      ids.users.memberA,
      "reflection",
      "合成数据反馈：组织场次体验顺畅。",
      ids.activities.orgA,
      ids.sessions.orgAEnded,
    ],
  );
  return ids;
}

async function insertUser(
  tx,
  {
    username,
    role,
    passwordHash,
    enterpriseId = null,
    validUntil,
    guardianName,
  },
) {
  const result = await tx.run(
    "INSERT INTO users(username, phone, role, enterprise_id, valid_until, password_hash, guardian_name, is_profile_complete) VALUES(?,?,?,?,?,?,?,1)",
    [
      username,
      null,
      role,
      enterpriseId,
      validUntil,
      passwordHash,
      guardianName,
    ],
  );
  return result.lastID;
}

async function insertOrganization(tx, name, ownerUserId) {
  const result = await tx.run(
    "INSERT INTO organizations(name, owner_user_id, valid_until, description) VALUES(?,?,?,?)",
    [name, ownerUserId, PERMANENT_UNTIL, "Synthetic development organization"],
  );
  return result.lastID;
}

async function insertSession(
  tx,
  {
    userId,
    startedAt,
    endedAt = null,
    organizationId = null,
    ownershipKind,
    finalScore = null,
    status,
  },
) {
  const result = await tx.run(
    "INSERT INTO game_sessions(user_id, started_at, ended_at, final_score, payload_json, game_mode, status, organization_id, ownership_kind) VALUES(?,?,?,?,?,?,?,?,?)",
    [
      userId,
      startedAt,
      endedAt,
      finalScore,
      JSON.stringify({ source: "synthetic" }),
      "standard",
      status,
      organizationId,
      ownershipKind,
    ],
  );
  return result.lastID;
}

async function insertActivity(
  tx,
  name,
  code,
  createdBy,
  enterpriseId,
  endedAt,
) {
  const result = await tx.run(
    "INSERT INTO activities(name, organizer, activity_code, started_at, ended_at, created_by, enterprise_id, status) VALUES(?,?,?,?,?,?,?,?)",
    [
      name,
      "WQT synthetic fixtures",
      code,
      endedAt - 2 * 60 * 60 * 1000,
      endedAt,
      createdBy,
      enterpriseId,
      "ended",
    ],
  );
  return result.lastID;
}
