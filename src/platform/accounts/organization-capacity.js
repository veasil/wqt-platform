import {domainError} from '../../game/activities/link.js';
export async function organizationCapacity(tx, organizationId) {
  const subscription=await tx.get('SELECT * FROM subscriptions WHERE organization_id=? FOR UPDATE',[organizationId]);
  const organization=await tx.get('SELECT * FROM organizations WHERE id=? FOR UPDATE',[organizationId]);
  if(!organization)throw domainError(404,'组织不存在');
  return {organization,subscription,enabled:!!subscription||!!organization.entitlement_plan,
    capacity:subscription?.account_count ?? organization.max_members,validUntil:subscription?.valid_until ?? organization.valid_until};
}
export async function assertAdditionalBinding(tx, organizationId) {
  const rights=await organizationCapacity(tx,organizationId);
  if(rights.enabled){
    const count=await tx.get(`SELECT COUNT(*)::int AS n FROM account_bindings b JOIN accounts a ON a.id=b.account_id WHERE a.organization_id=? AND b.ended_at IS NULL`,[organizationId]);
    if(count.n>=rights.capacity)throw domainError(409,'组织已达到容量上限，不能新增绑定');
  }
  return rights;
}
