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
  if (
    activity.enterprise_id &&
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
