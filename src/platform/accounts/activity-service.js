import {accountActor} from './context.js';
import {accountOperation} from './service.js';
import {domainError} from '../../game/activities/link.js';
import {generateActivityCode} from '../../game/activities/codes.js';

async function authorizeApplication(tx, context) {
  const actor = await accountActor(context, tx.get, {lock:true});
  if (!actor) throw domainError(403,'账号绑定已失效或已停用');
  if (!actor.paid_valid) throw domainError(403,'当前账号无有效权益，暂不能申请活动');
  return actor;
}

export async function applyActivity(context, input = {}) {
  const name = String(input.name || '').trim();
  const location = String(input.location || '').trim();
  if (!name || name.length > 120 || location.length > 200)
    throw domainError(400,'请填写活动名称（最多120字），地点最多200字');
  return accountOperation(context,input.requestId,'apply-activity',{name,location},async tx => {
    const actor = await authorizeApplication(tx,context);
    const code = await generateActivityCode('apply');
    const row = await tx.run(`INSERT INTO activities(name,organizer,activity_code,created_by_identity_id,created_by_account_id,enterprise_id,status)
      VALUES(?,?,?,?,?,?,?)`,[name,location || null,code,context.identityId,actor.id,actor.organization_id,'pending']);
    return {targetAccountId:actor.id,result:{ok:true,id:row.lastID,activity_code:code,status:'pending'}};
  },authorizeApplication);
}
