// Pure planning analysis. Never assign an unknown historical owner from current membership.
export function auditLegacyAccounts(users, sessions, organizationIds) {
  const organizations = new Set(organizationIds.map(Number));
  const usersById = new Map(users.map(user => [Number(user.id), user]));
  const phoneCounts = new Map();
  for (const user of users) {
    const phone = String(user.phone || '').trim().replace(/\s/g, '');
    if (phone) phoneCounts.set(phone, (phoneCounts.get(phone) || 0) + 1);
  }
  const counts = {
    users: users.length, sessions: sessions.length,
    missingPhone: 0, duplicatePhoneIdentities: 0, nullOrganization: 0,
    missingOrganization: 0, operatorAccounts: 0, unexpectedRoles: 0,
    orphanSessions: 0, unknownHistoricalOwnership: 0,
    conflictingHistoricalOrganization: 0,
  };
  for (const user of users) {
    const phone = String(user.phone || '').trim().replace(/\s/g, '');
    if (!phone) counts.missingPhone++;
    else if (phoneCounts.get(phone) > 1) counts.duplicatePhoneIdentities++;
    if (user.enterprise_id == null) counts.nullOrganization++;
    else if (!organizations.has(Number(user.enterprise_id))) counts.missingOrganization++;
    if (user.role === 'operator') counts.operatorAccounts++;
    if (!['watcher', 'enterprise', 'boss', 'operator'].includes(user.role)) counts.unexpectedRoles++;
  }
  for (const session of sessions) {
    const user = usersById.get(Number(session.user_id));
    if (!user) { counts.orphanSessions++; continue; }
    if (session.ownership_kind == null || session.ownership_kind === 'legacy_unknown') {
      counts.unknownHistoricalOwnership++;
    } else if (session.ownership_kind === 'organization' &&
      (session.organization_id == null || user.enterprise_id == null ||
       Number(session.organization_id) !== Number(user.enterprise_id))) {
      counts.conflictingHistoricalOrganization++;
    }
  }
  return {
    counts,
    freeOrganizationExists: organizations.has(0),
    // Even a clean scan requires explicit NULL classification and operator handling.
    mappingReady: !Object.entries(counts).some(([key, value]) =>
      !['users', 'sessions'].includes(key) && value > 0),
    policy: 'one legacy user -> one account; exceptions require reviewed mapping; no automatic writes',
  };
}
