import {accountActor} from './context.js';
import {accountOperation} from './service.js';
import {domainError} from '../../game/activities/link.js';
import {generateActivityCode} from '../../game/activities/codes.js';
import {cardsDbGet} from '../../cards-db.js';
import {validateGameConfiguration} from '../../../shared/browser/game-configuration.js';

export async function activityConfiguration(input) {
  const configuration=validateGameConfiguration(input);
  if(!await cardsDbGet('SELECT id FROM card_groups WHERE id=?',[configuration.cardGroupId])) throw domainError(400,'请选择有效卡牌组');
  return configuration;
}

async function authorizeApplication(tx, context) {
  const actor = await accountActor(context, tx.get, {lock:true});
  if (!actor) throw domainError(403,'账号绑定已失效或已停用');
  if (!actor.paid_valid) throw domainError(403,'当前账号无有效权益，暂不能申请活动');
  return actor;
}

export async function applyActivity(context, input = {}) {
  const name = String(input.name || '').trim();
  const location = String(input.location || '').trim();
  if (!name || name.length > 120 || !location || location.length > 200)
    throw domainError(400,'请填写活动名称（最多120字）与地点（最多200字）');
  const startedAt=input.started_at==null?null:Number(input.started_at);
  if(startedAt!=null&&(!Number.isSafeInteger(startedAt)||startedAt<0||startedAt>8640000000000000))throw domainError(400,'活动时间无效');
  const configuration=await activityConfiguration(input.configuration);
  return accountOperation(context,input.requestId,'create-player-activity',{name,location,startedAt,configuration},async tx => {
    const actor = await authorizeApplication(tx,context);
    const code = await generateActivityCode('apply');
    const row = await tx.run(`INSERT INTO activities(name,organizer,activity_code,created_by_identity_id,created_by_account_id,enterprise_id,status,started_at,game_config_json)
      VALUES(?,?,?,?,?,?,?,?,?)`,[name,location,code,context.identityId,actor.id,actor.organization_id,'active',startedAt??Date.now(),JSON.stringify(configuration)]);
    await tx.run('INSERT INTO activity_creation_notifications(activity_id,created_at) VALUES(?,?) RETURNING activity_id',[row.lastID,Date.now()]);
    return {targetAccountId:actor.id,result:{ok:true,id:row.lastID,activity_code:code,status:'active'}};
  },authorizeApplication);
}
