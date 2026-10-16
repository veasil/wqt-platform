import {operationHash} from '../../services/operation-hash.js';
import { withTransaction } from '../../db.js';
import { accountActor, positiveId } from './context.js';
import { domainError } from '../../game/activities/link.js';
import bcrypt from 'bcryptjs';
import {normalizePhone,verifyCode} from '../../services/sms.js';

export function addCalendarYear(timestamp) {
  const date = new Date(timestamp);
  const month = date.getUTCMonth();
  date.setUTCFullYear(date.getUTCFullYear() + 1);
  // Feb 29 renews to Feb 28 instead of silently spilling into March.
  if (date.getUTCMonth() !== month) date.setUTCDate(0);
  return date.getTime();
}

export async function lockAccounts(tx, ids) {
  const sorted = [...new Set(ids.map(positiveId))].filter(Boolean).sort((a,b) => a-b);
  await tx.all('SELECT id FROM accounts WHERE id=ANY(?::bigint[]) ORDER BY id FOR UPDATE', [sorted]);
}

export async function authorizeOperation(tx, context, { organizationId, city = false } = {}) {
  const actor = await accountActor(context, tx.get);
  if (!actor) throw domainError(403, '账号绑定已失效或已停用');
  if (actor.role === 'boss') return actor;
  if (city && actor.role === 'enterprise' && actor.plan === 'city' && actor.paid_valid && actor.organization_id === organizationId) return actor;
  throw domainError(403, '无权执行该账号管理操作');
}

// Persisted results and a unique request ID prevent duplicate delivery even after a lost response.
// Lock order: request key -> subscription -> sorted accounts -> binding/identity/organization.
async function operation(context, requestId, kind, input, work) {
  if (typeof requestId !== 'string' || !/^[a-zA-Z0-9_.:-]{8,120}$/.test(requestId)) throw domainError(400, '需要8至120位唯一requestId');
  const hash = operationHash([kind,context.identityId,context.accountId,input]);
  return withTransaction(async tx => {
    await tx.get('SELECT pg_advisory_xact_lock(hashtextextended(?,0))', [`wqt-account-operation:${requestId}`]);
    const previous = await tx.get('SELECT * FROM account_operations WHERE request_id=?', [requestId]);
    if (previous) {
      if (previous.input_hash !== hash || previous.operation !== kind) throw domainError(409, 'requestId已用于不同操作');
      const target = previous.target_account_id == null ? null : await tx.get('SELECT organization_id FROM accounts WHERE id=?', [previous.target_account_id]);
      await authorizeOperation(tx,context,{ city:kind === 'bind',organizationId:target?.organization_id });
      return JSON.parse(previous.result_json);
    }
    const { result, subscriptionId = null, targetAccountId = null } = await work(tx);
    await tx.run(`INSERT INTO account_operations(request_id,operation,actor_identity_id,actor_account_id,target_account_id,subscription_id,input_hash,result_json,created_at)
      VALUES(?,?,?,?,?,?,?,?,?)`, [requestId,kind,context.identityId,context.accountId,targetAccountId,subscriptionId,hash,JSON.stringify(result),Date.now()]);
    return result;
  });
}
export {operation as accountOperation};

export async function deliverSubscription(context, input) {
  if (input.organizationId!=null || input.subscriptionId!=null) throw domainError(409,'已有组织只允许续费，升级及重复购买暂不开放');
  const name = String(input.organizationName || '').trim();
  const plan = input.plan;
  const location=String(input.location || '').trim();
  if(location.length>200) throw domainError(400,'组织地点最多200字');
  const count = { personal:1, group:5, city:20 }[plan];
  if (!name || name.length > 120 || !count) throw domainError(400, '需要组织名称和合法套餐');
  const cityUntil = plan === 'city' ? Number(input.validUntil) : null;
  if (plan === 'city' && (!Number.isSafeInteger(cityUntil) || cityUntil <= Date.now())) throw domainError(400, '城市级必须明确首次到期时间');
  return operation(context,input.requestId,'deliver',{name,plan,cityUntil,...(location ? {location}:{})},async tx => {
    await lockAccounts(tx,[context.accountId]);
    await authorizeOperation(tx,context);
    const now = Date.now();
    const until = plan === 'city' ? cityUntil : addCalendarYear(now);
    const org = await tx.run('INSERT INTO organizations(name,owner_user_id,max_members,valid_until,location) VALUES(?,0,?,?,?)', [name,count,until,location || null]);
    const subscription = await tx.run('INSERT INTO subscriptions(organization_id,plan,account_count,starts_at,valid_until,created_at) VALUES(?,?,?,?,?,?)', [org.lastID,plan,count,now,until,now]);
    const accounts = [];
    for (let index=0; index<count; index++) {
      const account = await tx.run('INSERT INTO accounts(organization_id,subscription_id,name,created_at) VALUES(?,?,?,?)', [org.lastID,subscription.lastID,`${name}-${index+1}`,now]);
      accounts.push(account.lastID);
    }
    return { subscriptionId:subscription.lastID, result:{ ok:true, organizationId:org.lastID, subscriptionId:subscription.lastID, accountIds:accounts, validUntil:until } };
  });
}

export async function renewSubscription(context, input) {
  const subscriptionId = positiveId(input.subscriptionId);
  if (!subscriptionId) throw domainError(400, 'subscriptionId不正确');
  return operation(context,input.requestId,'renew',{subscriptionId},async tx => {
    const subscription = await tx.get('SELECT * FROM subscriptions WHERE id=? FOR UPDATE', [subscriptionId]);
    if (!subscription) throw domainError(404, '套餐不存在');
    await lockAccounts(tx,[context.accountId]);
    await authorizeOperation(tx,context);
    const until = addCalendarYear(Math.max(subscription.valid_until,Date.now()));
    await tx.run('UPDATE subscriptions SET valid_until=? WHERE id=?', [until,subscriptionId]);
    await tx.run('UPDATE organizations SET valid_until=?,updated_at=? WHERE id=?', [until,Date.now(),subscription.organization_id]);
    return { subscriptionId, result:{ ok:true,subscriptionId,validUntil:until,rebindCount:subscription.rebind_count } };
  });
}

export async function bindAccount(context, input) {
  const accountId = positiveId(input.accountId);
  const identityId = positiveId(input.identityId);
  if (!accountId || !identityId) throw domainError(400, '账号或身份ID不正确');
  return operation(context,input.requestId,'bind',{accountId,identityId},async tx => {
    let target = await tx.get('SELECT * FROM accounts WHERE id=?', [accountId]);
    if (!target) throw domainError(404, '账号不存在');
    await authorizeOperation(tx,context,{organizationId:target.organization_id,city:true});
    // Identity first, then subscription/accounts: invite binding uses the same order.
    // Different requests for two slots must serialize before either checks membership.
    const identity = await tx.get("SELECT id FROM identities WHERE id=? AND status='active' FOR UPDATE", [identityId]);
    if (!identity) throw domainError(400, '新使用者身份不存在或已停用');
    const subscription = target.subscription_id == null ? null : await tx.get('SELECT * FROM subscriptions WHERE id=? FOR UPDATE', [target.subscription_id]);
    await lockAccounts(tx,[context.accountId,accountId]);
    target = await tx.get('SELECT * FROM accounts WHERE id=?', [accountId]);
    const actor = await authorizeOperation(tx,context,{ organizationId:target.organization_id,city:true });
    if (target.role === 'boss' || target.role === 'operator') {
      if (actor.role !== 'boss') throw domainError(403, '平台账号只能由boss处理');
    }
    // Admin-account rebind authorization is a separate pending gate.
    if (target.role === 'enterprise' && actor.role !== 'boss') throw domainError(403, '管理员账号换绑需boss批准');
    const current = await tx.get('SELECT * FROM account_bindings WHERE account_id=? AND ended_at IS NULL FOR UPDATE', [accountId]);
    if (current?.identity_id === identityId) return { subscriptionId:target.subscription_id, targetAccountId:accountId, result:{ ok:true,accountId,identityId,rebindCount:subscription?.rebind_count ?? 0,changed:false } };
    const occupied=await tx.get(`SELECT b.account_id FROM account_bindings b JOIN accounts a ON a.id=b.account_id
      WHERE b.identity_id=? AND a.organization_id=? AND b.ended_at IS NULL AND b.account_id<>? LIMIT 1`,[identityId,target.organization_id,accountId]);
    if (occupied) throw domainError(409,'该手机号在此组织已绑定一个账号，请使用原账号');
    if (current) {
      if (!subscription) throw domainError(409, '非商业账号换绑规则尚未开放');
      if (subscription.rebind_count >= 2) throw domainError(409, '整份套餐终身两次换绑已用完');
      await tx.run('UPDATE subscriptions SET rebind_count=rebind_count+1 WHERE id=?', [subscription.id]);
      await tx.run('UPDATE account_bindings SET ended_at=? WHERE id=?', [Date.now(),current.id]);
    }
    await tx.run('INSERT INTO account_bindings(account_id,identity_id,started_at) VALUES(?,?,?)', [accountId,identityId,Date.now()]);
    return { subscriptionId:target.subscription_id, targetAccountId:accountId, result:{ ok:true,accountId,identityId,rebindCount:(subscription?.rebind_count ?? 0)+(current ? 1:0),changed:true } };
  });
}

export async function createVerifiedIdentity(context,input) {
  const phone=normalizePhone(input.phone || '');
  const verificationNote=String(input.verificationNote || '').trim();
  const guardianName=String(input.guardianName || '').trim();
  const realName=String(input.realName || '').trim();
  const password=String(input.password || '');
  if (phone.length<6 || !verificationNote || !guardianName || !realName || password.length<6)
    throw domainError(400,'需要手机号、本人核验说明、姓名、守望师名及至少6位密码');
  return operation(context,input.requestId,'create-identity',{phone,verificationNote,guardianName,realName,password},async tx=>{
    await lockAccounts(tx,[context.accountId]);
    await authorizeOperation(tx,context);
    await tx.get('SELECT pg_advisory_xact_lock(hashtextextended(?,0))',[`wqt-identity-phone:${phone}`]);
    if (await tx.get('SELECT id FROM identities WHERE phone=?',[phone])) throw domainError(409,'手机号已存在，请复用原身份，不能覆盖资料');
    const row=await tx.run('INSERT INTO identities(phone,password_hash,guardian_name,real_name,created_at) VALUES(?,?,?,?,?)',[phone,bcrypt.hashSync(password,10),guardianName,realName,Date.now()]);
    return {result:{ok:true,identityId:row.lastID,verificationNote}};
  });
}

export async function setStatus(context,input) {
  const {type,status}=input;
  const id=type==='organization' && (input.id===0 || input.id==='0') ? 0:positiveId(input.id);
  const reason=String(input.reason || '').trim();
  const table={identity:'identities',account:'accounts',organization:'organizations'}[type];
  if (!table || id==null || !['active','suspended'].includes(status) || !reason) throw domainError(400,'需要合法对象、状态和审计原因');
  return operation(context,input.requestId,'set-status',{type,id,status,reason},async tx=>{
    await lockAccounts(tx,[context.accountId,...(type==='account' ? [id]:[])]);
    await authorizeOperation(tx,context);
    const target=await tx.get(`SELECT id,status FROM ${table} WHERE id=? FOR UPDATE`,[id]);
    if (!target) throw domainError(404,'目标不存在');
    if (type==='identity') await tx.run('UPDATE identities SET status=?,credential_version=credential_version+1 WHERE id=?',[status,id]);
    else await tx.run(`UPDATE ${table} SET status=? WHERE id=?`,[status,id]);
    return {targetAccountId:type==='account' ? id:null,result:{ok:true,type,id,status,previousStatus:target.status,reason}};
  });
}

export async function changeIdentityPhone(context,input) {
  const identityId=positiveId(input.identityId);
  const phone=normalizePhone(input.newPhone || '');
  const verificationNote=String(input.verificationNote || '').trim();
  if (!identityId || phone.length<6 || !verificationNote || !input.smsCode) throw domainError(400,'需要身份ID、新手机号、短信验证码和本人核验说明');
  const actor=await accountActor(context);
  if (!actor || actor.role!=='boss') throw domainError(403,'换号核验仅允许boss');
  return operation(context,input.requestId,'change-phone',{identityId,phone,verificationNote},async tx=>{
    await lockAccounts(tx,[context.accountId]);
    await authorizeOperation(tx,context);
    await tx.get('SELECT pg_advisory_xact_lock(hashtextextended(?,0))',[`wqt-identity-phone:${phone}`]);
    const identity=await tx.get('SELECT id,phone,credential_version FROM identities WHERE id=? FOR UPDATE',[identityId]);
    if (!identity) throw domainError(404,'身份不存在');
    const occupied=await tx.get('SELECT id FROM identities WHERE phone=?',[phone]);
    if (occupied && occupied.id!==identityId) throw domainError(409,'新号码已被其他身份占用，不能自动合并');
    // A committed request is replayed by operation() after live boss authorization.
    // Only a new change consumes SMS; a lost HTTP response must not need another code.
    const checked=await verifyCode(phone,String(input.smsCode).trim(),{consume:true});
    if (!checked.ok) throw domainError(400,checked.error || '新号码验证码错误');
    if (identity.phone===phone) return {result:{ok:true,identityId,changed:false,verificationNote}};
    await tx.run('UPDATE identities SET phone=?,credential_version=credential_version+1 WHERE id=?',[phone,identityId]);
    return {result:{ok:true,identityId,oldPhone:identity.phone,newPhone:phone,changed:true,verificationNote,previousCredentialVersion:identity.credential_version}};
  });
}
