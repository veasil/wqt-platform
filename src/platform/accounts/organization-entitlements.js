import {accountOperation,lockAccounts,authorizeOperation} from './service.js';
import {positiveId} from './context.js';
import {domainError} from '../../game/activities/link.js';

export async function updateOrganizationEntitlements(context,input={}) {
  const organizationId=positiveId(input.organizationId),capacity=Number(input.capacity),validUntil=Number(input.validUntil),plan=input.plan,reason=String(input.reason||'').trim();
  if(!organizationId||!['personal','group','city'].includes(plan)||!Number.isSafeInteger(capacity)||capacity<1||capacity>10000||!Number.isSafeInteger(validUntil)||validUntil<1||validUntil>8640000000000000||!reason||reason.length>1000)
    throw domainError(400,'需要组织、权益级别、1至10000容量、到期时间及调整原因');
  return accountOperation(context,input.requestId,'organization-entitlements',{organizationId,capacity,validUntil,plan,reason},async tx=>{
    const subscription=await tx.get('SELECT * FROM subscriptions WHERE organization_id=? FOR UPDATE',[organizationId]);
    await lockAccounts(tx,[context.accountId]);await authorizeOperation(tx,context);
    const organization=await tx.get('SELECT * FROM organizations WHERE id=? FOR UPDATE',[organizationId]);
    if(!organization)throw domainError(404,'组织不存在');
    if(subscription&&validUntil<=subscription.starts_at)throw domainError(400,'到期时间必须晚于原权益开始时间');
    const before={plan:subscription?.plan??organization.entitlement_plan,capacity:subscription?.account_count??organization.max_members,validUntil:subscription?.valid_until??organization.valid_until};
    if(subscription)await tx.run('UPDATE subscriptions SET plan=?,account_count=?,valid_until=? WHERE id=?',[plan,capacity,validUntil,subscription.id]);
    await tx.run('UPDATE organizations SET entitlement_plan=?,max_members=?,valid_until=?,updated_at=? WHERE id=?',[subscription?null:plan,capacity,validUntil,Date.now(),organizationId]);
    const count=await tx.get('SELECT COUNT(*)::int AS n FROM accounts WHERE organization_id=?',[organizationId]);
    for(let index=count.n;index<capacity;index++)await tx.run('INSERT INTO accounts(organization_id,subscription_id,name,created_at) VALUES(?,?,?,?)',[organizationId,subscription?.id??null,`${organization.name}-${index+1}`,Date.now()]);
    return {subscriptionId:subscription?.id??null,result:{ok:true,organizationId,before,after:{plan,capacity,validUntil},preservedAccounts:Math.max(count.n,capacity),overCapacity:count.n>capacity,reason}};
  });
}
