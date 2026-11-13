import { randomUUID } from 'node:crypto';

export function domainError(status, message) {
  return Object.assign(new Error(message), { status });
}

export async function linkActivity(tx, session, activityCode) {
  // Serialize numbering and duplicate checks on the activity, not on a process-local lock.
  const activity = await tx.get(
    "SELECT * FROM activities WHERE activity_code = ? AND status = 'active' FOR UPDATE",
    [String(activityCode).toUpperCase()],
  );
  if (!activity) throw domainError(404, "活动不存在或已结束");
  // Account-model activities may span organizations (WQT-010); session access stays scoped.
  // Legacy personal/organization linking retains its existing restriction.
  if (
    session.account_id == null &&
    activity.enterprise_id != null &&
    (session.ownership_kind !== "organization" ||
      session.organization_id !== activity.enterprise_id)
  ) {
    throw domainError(403, "场次与活动不属于同一组织");
  }
  const existing = await tx.get(
    "SELECT table_no FROM activity_sessions WHERE activity_id = ? AND session_id = ?",
    [activity.id, session.id],
  );
  let tableNo = existing?.table_no;
  if (tableNo == null) {
    const latest = await tx.get(
      "SELECT MAX(table_no) AS max FROM activity_sessions WHERE activity_id = ?",
      [activity.id],
    );
    tableNo = (latest?.max || 0) + 1;
    await tx.run(
      "INSERT INTO activity_sessions(activity_id, session_id, table_no) VALUES(?,?,?)",
      [activity.id, session.id, tableNo],
    );
  }
  return { id: activity.id, name: activity.name, table_no: tableNo };
}

export async function linkAutomaticActivity(tx, session, actor, location, now = Date.now()) {
  const place = typeof location === 'string' ? location.trim() : '';
  if (!place || place.length > 200) throw domainError(400, '请输入活动地点（最多200字）');
  // Business day is UTC+8, independent of the server's operating-system timezone.
  const day = new Date(now + 8 * 60 * 60 * 1000).toISOString().slice(0,10);
  await tx.get('SELECT pg_advisory_xact_lock(hashtextextended(?,0))', [JSON.stringify(['wqt-auto-activity',day,place])]);
  let activity = await tx.get('SELECT * FROM activities WHERE auto_day=? AND auto_location=? FOR UPDATE', [day,place]);
  if (!activity) {
    const code = 'G' + randomUUID().replaceAll('-','').toUpperCase();
    await tx.run(`INSERT INTO activities(name,organizer,activity_code,started_at,enterprise_id,created_by_identity_id,created_by_account_id,auto_day,auto_location)
      VALUES(?,?,?,?,?,?,?,?,?)`,[`${place} · ${day}`,place,code,now,actor.organization_id,actor.identity_id,actor.id,day,place]);
    activity = {activity_code:code};
  }
  // An ended activity is not reopened implicitly; a separate activity uses its own code.
  return linkActivity(tx,session,activity.activity_code);
}
