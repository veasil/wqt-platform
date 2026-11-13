import {accountOperation,lockAccounts,authorizeOperation} from './service.js';
import {positiveId} from './context.js';
import {domainError} from '../../game/activities/link.js';

export async function reviewLevelApplication(context,input) {
  const applicationId=positiveId(input.applicationId);
  const {action}=input;
  const note=String(input.note || '').trim();
  if (!applicationId || !['approve','reject'].includes(action)) throw domainError(400,'申请ID或审批动作无效');
  return accountOperation(context,input.requestId,'review-level',{applicationId,action,note},async tx=>{
    await lockAccounts(tx,[context.accountId]);
    await authorizeOperation(tx,context);
    const snapshot=await tx.get('SELECT identity_id FROM watcher_level_applications WHERE id=?',[applicationId]);
    if (!snapshot?.identity_id) throw domainError(404,'新身份模型申请不存在');
    // Match application creation's identity -> application lock order.
    const identity=await tx.get('SELECT * FROM identities WHERE id=? FOR UPDATE',[snapshot.identity_id]);
    const application=await tx.get('SELECT * FROM watcher_level_applications WHERE id=? FOR UPDATE',[applicationId]);
    if (application.status!=='pending') throw domainError(409,'申请已处理');
    if (action==='approve' && identity.watcher_level!==application.from_level) throw domainError(409,'当前等级已变化，请重新申请');
    const newStatus=action==='approve' ? 'approved':'rejected';
    await tx.run('UPDATE watcher_level_applications SET status=?,reviewed_by_identity_id=?,reviewed_at=?,note=? WHERE id=?',[newStatus,context.identityId,Date.now(),note,applicationId]);
    if (action==='approve') {
      await tx.run('UPDATE identities SET watcher_level=? WHERE id=?',[application.to_level,identity.id]);
      await tx.run("INSERT INTO watcher_level_logs(identity_id,old_level,new_level,source,changed_by_identity_id,note) VALUES(?,?,?,'application',?,?)",[identity.id,identity.watcher_level,application.to_level,context.identityId,note]);
    }
    return {result:{ok:true,applicationId,identityId:identity.id,newStatus}};
  });
}

export async function setIdentityLevel(context,input) {
  const identityId=positiveId(input.identityId);
  const {level}=input;
  const note=String(input.note || '').trim();
  if (!identityId || !['initial','advanced','mentor'].includes(level) || !note) throw domainError(400,'需要合法身份、等级及审计说明');
  return accountOperation(context,input.requestId,'set-level',{identityId,level,note},async tx=>{
    await lockAccounts(tx,[context.accountId]);
    await authorizeOperation(tx,context);
    const identity=await tx.get('SELECT watcher_level FROM identities WHERE id=? FOR UPDATE',[identityId]);
    if (!identity) throw domainError(404,'身份不存在');
    await tx.run('UPDATE identities SET watcher_level=? WHERE id=?',[level,identityId]);
    await tx.run("INSERT INTO watcher_level_logs(identity_id,old_level,new_level,source,changed_by_identity_id,note) VALUES(?,?,?,'manual',?,?)",[identityId,identity.watcher_level,level,context.identityId,note]);
    return {result:{ok:true,identityId,level,note}};
  });
}
