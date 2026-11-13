import {withTransaction} from '../../db.js';
import {accountActor} from './context.js';
import {lockAccounts} from './service.js';
import {operationHash} from '../../services/operation-hash.js';
import {domainError} from '../../game/activities/link.js';
export function trialStatus(identity,now=Date.now()){
 const active=Number(identity.trial_until||0)>now;
 const pending=Number(identity.trial_granted_at||0)>Number(identity.trial_grant_consumed_at||0);
 return {status:active?'active':pending?'pending_activation':identity.trial_until?'expired':'not_granted',active,pending,startedAt:identity.trial_started_at,until:identity.trial_until,grantedAt:identity.trial_granted_at};
}
export async function activateTrial(context,requestId){
 if(typeof requestId!=='string'||!/^[a-zA-Z0-9_.:-]{8,120}$/.test(requestId))throw domainError(400,'体验激活需要唯一requestId');
 const kind='activate-player-trial',hash=operationHash([kind,context.identityId,context.accountId]);
 return withTransaction(async tx=>{
  await tx.get('SELECT pg_advisory_xact_lock(hashtextextended(?,0))',['wqt-account-operation:'+requestId]);
  await lockAccounts(tx,[context.accountId]);
  const identity=await tx.get("SELECT * FROM identities WHERE id=? AND status='active' FOR UPDATE",[context.identityId]);
  const actor=await accountActor(context,tx.get,{lock:true});
  if(!identity||!actor)throw domainError(403,'账号绑定已失效');
  const previous=await tx.get('SELECT * FROM account_operations WHERE request_id=?',[requestId]);
  if(previous){if(previous.input_hash!==hash||previous.operation!==kind)throw domainError(409,'requestId已用于其他操作');return JSON.parse(previous.result_json)}
  if(actor.role!=='watcher'||actor.paid_valid)throw domainError(403,'请使用免费守望者账号激活体验');
  const now=Date.now(),status=trialStatus(identity,now);
  if(status.active)throw domainError(409,'体验已激活，重复操作不会延长期限');
  if(!status.pending)throw domainError(403,'尚未获得待激活体验权益，请联系平台开通');
  const until=now+30*86400000;
  await tx.run('UPDATE identities SET trial_started_at=?,trial_until=?,trial_activated_at=COALESCE(trial_activated_at,?),trial_grant_consumed_at=trial_granted_at WHERE id=?',[now,until,now,identity.id]);
  const result={ok:true,startedAt:now,trialUntil:until};
  await tx.run('INSERT INTO account_operations(request_id,operation,actor_identity_id,actor_account_id,target_account_id,input_hash,result_json,created_at) VALUES(?,?,?,?,?,?,?,?)',[requestId,kind,context.identityId,context.accountId,context.accountId,hash,JSON.stringify(result),now]);
  return result;
 });
}
