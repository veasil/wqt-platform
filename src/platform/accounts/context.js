import { dbGet, dbAll } from '../../db.js';

export function positiveId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

// The selected account is only a claim. Resolve status and binding from PG on every access.
export async function accountActor(context, get = dbGet, { lock = false } = {}) {
  const identityId = positiveId(context?.identityId);
  const accountId = positiveId(context?.accountId);
  if (!identityId || !accountId) return null;
  const account = await get(`SELECT a.*, COALESCE(s.plan,o.entitlement_plan) AS plan, s.valid_until AS subscription_until, CASE WHEN o.entitlement_plan IS NOT NULL THEN o.valid_until END AS organization_until
    FROM accounts a LEFT JOIN subscriptions s ON s.id=a.subscription_id JOIN organizations o ON o.id=a.organization_id
    WHERE a.id=?${lock ? ' FOR UPDATE OF a' : ''}`, [accountId]);
  if (!account || account.status !== 'active') return null;
  const binding = await get(`SELECT b.id, i.trial_started_at, i.trial_until FROM account_bindings b
    JOIN identities i ON i.id=b.identity_id
    JOIN organizations o ON o.id=?
    WHERE b.account_id=? AND b.identity_id=? AND b.ended_at IS NULL AND i.status='active' AND o.status='active'
    ${lock ? 'FOR SHARE OF b,i,o' : ''}`, [account.organization_id, accountId, identityId]);
  if (!binding) return null;
  const until = account.subscription_until ?? account.organization_until ?? account.valid_until ?? null;
  return { ...account, identity_id: identityId, enterprise_id: account.organization_id,
    valid_until: until, paid_valid: until != null && Date.now() < until,
    trial_valid: binding.trial_until != null && Date.now() < binding.trial_until,
    binding_id: binding.id, trial_until: binding.trial_until };
}

export async function identityAccounts(identityId) {
  return dbAll(`SELECT a.id, a.name, a.organization_id, o.name AS organization_name, a.role, a.status,
      COALESCE(s.valid_until,CASE WHEN o.entitlement_plan IS NOT NULL THEN o.valid_until END,a.valid_until) AS valid_until, COALESCE(s.plan,o.entitlement_plan) AS plan
    FROM account_bindings b JOIN accounts a ON a.id=b.account_id
    JOIN organizations o ON o.id=a.organization_id
    LEFT JOIN subscriptions s ON s.id=a.subscription_id
    WHERE b.identity_id=? AND b.ended_at IS NULL AND a.status='active' AND o.status='active'
    ORDER BY a.id`, [identityId]);
}
