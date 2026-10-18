import bcrypt from 'bcryptjs';
import { createHash } from 'node:crypto';
import { withTransaction,dbGet } from '../../db.js';
import { normalizePhone,verifyCode } from '../../services/sms.js';
import { domainError } from '../../game/activities/link.js';
import {verifyIdentityProof} from './verification.js';
import {assertAdditionalBinding} from './organization-capacity.js';

export async function registerWithInvite(input,{verifiedIdentity=null}={}) {
  const phone=normalizePhone(input.phone || '');
  const code=String(input.inviteCode || input.code || '').trim().toUpperCase();
  const password=String(input.password || '');
  const requestId=input.requestId;
  if (phone.length<6 || !code || typeof requestId!=='string' || !/^[a-zA-Z0-9_.:-]{8,120}$/.test(requestId))
    throw domainError(400,'需要邀请码、手机号及唯一requestId');
  let verifiedPerson=verifiedIdentity;
  if (!verifiedIdentity) {
    verifiedPerson=await dbGet('SELECT * FROM identities WHERE phone=?',[phone]);
    if (verifiedPerson) await verifyIdentityProof(verifiedPerson,{...input,code:undefined});
    else {
      if (password.length<6 || !input.smsCode) throw domainError(400,'新用户需验证手机号并设置至少6位密码');
      const checked=await verifyCode(phone,String(input.smsCode).trim(),{consume:true});
      if (!checked.ok) throw domainError(400,checked.error || '验证码错误');
    }
  }
  const hash=createHash('sha256').update(JSON.stringify([phone,code,verifiedIdentity ? 'authenticated-binding':password])).digest('hex');
  return withTransaction(async tx=>{
    await tx.get('SELECT pg_advisory_xact_lock(hashtextextended(?,0))',[`wqt-registration:${requestId}`]);
    await tx.get('SELECT pg_advisory_xact_lock(hashtextextended(?,0))',[`wqt-identity-phone:${phone}`]);
    let identity=await tx.get('SELECT * FROM identities WHERE phone=? FOR UPDATE',[phone]);
    if (verifiedPerson && (!identity || identity.id!==verifiedPerson.id || identity.credential_version!==verifiedPerson.credential_version || identity.status!=='active'))
      throw domainError(401,'用户身份已变更，请重新登录');
    if (!verifiedPerson && identity) throw domainError(409,'手机号已注册，请按已有用户重新验证');
    const previous=await tx.get('SELECT * FROM account_operations WHERE request_id=?',[requestId]);
    if (previous) {
      if (previous.operation!=='register' || previous.input_hash!==hash || previous.actor_identity_id!==identity?.id)
        throw domainError(409,'requestId已用于不同操作');
      const binding=await tx.get(`SELECT b.id FROM account_bindings b JOIN accounts a ON a.id=b.account_id
        JOIN organizations o ON o.id=a.organization_id WHERE b.account_id=? AND b.identity_id=? AND b.ended_at IS NULL
        AND a.status='active' AND o.status='active'`,[previous.target_account_id,identity.id]);
      if (!binding) throw domainError(403,'账号绑定已撤销或已停用');
      return {identity,result:JSON.parse(previous.result_json)};
    }
    const invite=await tx.get("SELECT * FROM invite_codes WHERE code=? AND status='active' FOR UPDATE",[code]);
    if (!invite || invite.expires_at<=Date.now() || invite.used_count>=invite.max_uses) throw domainError(400,'邀请码无效、已过期或已用完');
    const organizationId=invite.type==='general' ? 0:invite.organization_id;
    if (!Number.isSafeInteger(organizationId) || organizationId<0) throw domainError(400,'邀请码组织无效');
    let account;
    if (organizationId!==0) {
      const rights=await assertAdditionalBinding(tx,organizationId),subscription=rights.subscription;
      if (!rights.enabled || rights.validUntil<=Date.now()) throw domainError(403,'组织权益不存在或已到期');
      // Empty commercial slots are pre-delivered; registration never grows the purchased capacity.
      account=await tx.get(`SELECT a.* FROM accounts a WHERE a.organization_id=? AND a.subscription_id IS NOT DISTINCT FROM ? AND a.status='active' AND a.role='watcher'
        AND NOT EXISTS(SELECT 1 FROM account_bindings b WHERE b.account_id=a.id)
        ORDER BY a.id LIMIT 1 FOR UPDATE OF a`,[organizationId,subscription?.id??null]);
      if (!account) throw domainError(409,'组织没有首次绑定的空闲账号');
    }
    const org=await tx.get("SELECT id FROM organizations WHERE id=? AND status='active' FOR SHARE",[organizationId]);
    if (!org) throw domainError(403,'组织不存在或已停用');
    if (identity && await tx.get(`SELECT b.id FROM account_bindings b JOIN accounts a ON a.id=b.account_id
      WHERE b.identity_id=? AND a.organization_id=? AND b.ended_at IS NULL LIMIT 1`,[identity.id,organizationId]))
      throw domainError(409,'该手机号在此组织已绑定一个账号，请使用原账号');
    if (!identity) {
      const guardianName=String(input.nickname || input.guardianName || '').trim();
      const realName=String(input.realName || '').trim();
      if (!guardianName || !realName) throw domainError(400,'新身份需要真实姓名与守望师名');
      const inserted=await tx.run('INSERT INTO identities(phone,password_hash,guardian_name,real_name,created_at) VALUES(?,?,?,?,?)',[phone,bcrypt.hashSync(password,10),guardianName,realName,Date.now()]);
      identity=await tx.get('SELECT * FROM identities WHERE id=?',[inserted.lastID]);
    }
    if (organizationId===0) {
      const inserted=await tx.run("INSERT INTO accounts(organization_id,name,created_at) VALUES(0,?,?)",[`${identity.guardian_name || '守望师'}的免费账号`,Date.now()]);
      account={id:inserted.lastID};
    }
    await tx.run('INSERT INTO account_bindings(account_id,identity_id,started_at) VALUES(?,?,?)',[account.id,identity.id,Date.now()]);
    await tx.run('UPDATE invite_codes SET used_count=used_count+1 WHERE id=?',[invite.id]);
    const result={ok:true,accountId:account.id,identityId:identity.id};
    await tx.run(`INSERT INTO account_operations(request_id,operation,actor_identity_id,target_account_id,input_hash,result_json,created_at)
      VALUES(?,'register',?,?,?,?,?)`,[requestId,identity.id,account.id,hash,JSON.stringify(result),Date.now()]);
    return {identity,result};
  });
}
