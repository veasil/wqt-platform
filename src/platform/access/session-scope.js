import { dbGet } from "../../db.js";

export async function currentActor(userId, get = dbGet, { lock = false } = {}) {
  return get(
    `SELECT id, role, enterprise_id, valid_until FROM users WHERE id = ?${lock ? " FOR UPDATE" : ""}`,
    [userId],
  );
}

// Identifiers are chosen by backend callers, never supplied by requests.
export function sessionScope(actor, alias = "s", { managed = false } = {}) {
  if (!/^[a-z][a-z0-9_]*$/i.test(alias))
    throw new Error("Invalid session alias");
  if (!actor) return { sql: "FALSE", params: [] };
  const organizationId = actor.enterprise_id || null;
  const own = `${alias}.user_id = ? AND (${alias}.ownership_kind = 'personal' OR (${alias}.ownership_kind = 'organization' AND ${alias}.organization_id = ?))`;
  if (managed && actor.role === "enterprise" && organizationId) {
    return {
      sql: `((${own}) OR (${alias}.ownership_kind = 'organization' AND ${alias}.organization_id = ?))`,
      params: [actor.id, organizationId, organizationId],
    };
  }
  return { sql: `(${own})`, params: [actor.id, organizationId] };
}

export async function accessibleSession(
  userId,
  sessionId,
  { write = false, get = dbGet, lock = false } = {},
) {
  if (!Number.isSafeInteger(Number(sessionId)) || Number(sessionId) <= 0)
    return null;
  const actor = await currentActor(userId, get, { lock });
  const scope = sessionScope(actor, "s", { managed: !write });
  return get(
    `SELECT s.* FROM game_sessions s WHERE s.id = ? AND ${scope.sql}${lock ? " FOR UPDATE" : ""}`,
    [sessionId, ...scope.params],
  );
}
