import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { dbGet,dbRun } from '../../db.js';
import { normalizePhone,verifyCode } from '../../services/sms.js';
import { createIdentitySession,revokeIdentitySession } from '../../services/identity-sessions.js';
import { authenticateIdentity,signIdentityToken } from './auth.js';
import { identityAccounts,accountActor,positiveId } from './context.js';
import { sessionEndpoint } from '../../game/sessions/routes.js';
import { registerWithInvite } from './invitation.js';
import {verifyIdentityProof} from './verification.js';
import {CAPTCHA_ENABLED,verifyCaptcha} from '../../services/captcha.js';

export function identityUser(identity,account=null) {
  return {id:identity.id,identityId:identity.id,accountId:account?.id ?? null,
    username:identity.username || identity.phone,phone:identity.phone,realName:identity.real_name,
    guardianName:identity.guardian_name,isProfileComplete:!!identity.guardian_name,
    watcherLevel:identity.watcher_level,role:account?.role ?? null,enterpriseId:account?.organization_id ?? null,
    plan:account?.plan ?? null,
    validUntil:account?.valid_until ?? null,validityValid:account?.paid_valid ?? false,
    validitySource:'subscription',trialUntil:identity.trial_until};
}

const router=Router();
for (const [path,adminOnly] of [['/api/auth/login',false],['/api/auth/admin-login',true]]) {
  router.post(path,sessionEndpoint(async(req,res) => {
    const phone=normalizePhone(req.body?.phone || req.body?.username || '');
    if (!phone) return res.status(400).json({error:'请填写手机号'});
    const input=req.body || {};
    if(['password','legacy'].includes(input.verificationMethod) || (!input.verificationMethod && input.password)){
      if(!CAPTCHA_ENABLED && !['test','development'].includes(process.env.NODE_ENV))
        return res.status(503).json({error:'人机验证尚未配置，请稍后重试'});
      const checked=await verifyCaptcha({ticket:input.captchaTicket,randstr:input.captchaRandstr,captchaVerifyParam:input.captchaVerifyParam,ip:req.ip});
      if(!checked.ok)return res.status(400).json({error:checked.error || '请先完成人机验证'});
    }
    const identity=await dbGet('SELECT * FROM identities WHERE phone=?',[phone]);
    await verifyIdentityProof(identity,req.body || {});
    let accounts=await identityAccounts(identity.id);
    if (adminOnly) {
      accounts=accounts.filter(account=>['boss','operator'].includes(account.role));
      if (!accounts.length) return res.status(403).json({error:'没有可用的平台管理账号'});
    }
    const session=await createIdentitySession(identity.id,identity.credential_version);
    const selected=accounts.length===1 ? await accountActor({identityId:identity.id,accountId:accounts[0].id}):null;
    res.json({user:identityUser(identity,selected),accounts,requiresAccountSelection:!selected,
      token:signIdentityToken(identity,session,selected?.id ?? null),expiresAt:session.expiresAt});
  }));
}
router.get('/api/auth/session',authenticateIdentity,sessionEndpoint(async(req,res)=>{
 const accounts=await identityAccounts(req.identity.id);
 const selected=req.identityPayload.accountId?await accountActor({identityId:req.identity.id,accountId:req.identityPayload.accountId}):null;
 res.set('Cache-Control','no-store').json({user:identityUser(req.identity,selected),accounts,requiresAccountSelection:!selected,session:{createdAt:req.identitySession.createdAt,expiresAt:req.identitySession.expiresAt}});
}));
router.get('/api/auth/accounts',authenticateIdentity,sessionEndpoint(async(req,res)=>res.json({accounts:await identityAccounts(req.identity.id)})));
// Resolve through the authenticated person's live bindings. The activity code never grants membership.
router.get('/api/auth/activity-account/:code',authenticateIdentity,sessionEndpoint(async(req,res)=>{
  const code=String(req.params.code || '').trim().toUpperCase();
  if (!/^[A-Z0-9_-]{1,80}$/.test(code)) return res.status(400).json({error:'活动码无效'});
  const activity=await dbGet('SELECT id,name,activity_code,enterprise_id,status FROM activities WHERE activity_code=?',[code]);
  if (!activity) return res.status(404).json({error:'活动码无效'});
  if (activity.status!=='active') return res.status(410).json({error:'活动尚未开放或已结束'});
  if (activity.enterprise_id==null) return res.status(409).json({error:'该活动未指定组织，请明确选择本次使用的组织账号',code:'ACTIVITY_ORGANIZATION_REQUIRED'});
  const accounts=(await identityAccounts(req.identity.id)).filter(a=>Number(a.organization_id)===Number(activity.enterprise_id) && ['watcher','enterprise','boss'].includes(a.role));
  res.set('Cache-Control','no-store').json({activity:{id:activity.id,name:activity.name,activity_code:activity.activity_code},accounts});
}));
router.post('/api/auth/join-with-invite',authenticateIdentity,sessionEndpoint(async(req,res)=>{
  await verifyIdentityProof(req.identity,req.body || {});
  const {result}=await registerWithInvite({...req.body,phone:req.identity.phone},{verifiedIdentity:req.identity});
  const account=await accountActor({identityId:req.identity.id,accountId:result.accountId});
  if (!account) return res.status(403).json({error:'绑定账号已停用或已撤销'});
  res.json({...result,accounts:await identityAccounts(req.identity.id)});
}));
router.post('/api/auth/select-account',authenticateIdentity,sessionEndpoint(async(req,res)=>{
  const accountId=positiveId(req.body?.accountId);
  const account=accountId && await accountActor({identityId:req.identity.id,accountId});
  if (!account) return res.status(403).json({error:'账号未绑定给当前身份或已停用'});
  res.json({user:identityUser(req.identity,account),token:signIdentityToken(req.identity,req.identitySession,accountId),expiresAt:req.identitySession.expiresAt});
}));
router.post('/api/auth/logout',authenticateIdentity,sessionEndpoint(async(req,res)=>{
  await revokeIdentitySession(req.identity.id,req.identitySession.jti);
  res.json({ok:true});
}));
router.post('/api/auth/reset-password',sessionEndpoint(async(req,res)=>{
  const phone=normalizePhone(req.body?.phone || '');
  const {password,code}=req.body || {};
  if (!phone || !code || typeof password!=='string' || password.length<6) return res.status(400).json({error:'需要手机号、验证码及至少6位密码'});
  const identity=await dbGet("SELECT id FROM identities WHERE phone=? AND status='active'",[phone]);
  if (!identity) return res.status(400).json({error:'手机号未注册或已停用'});
  const checked=await verifyCode(phone,String(code),{consume:true});
  if (!checked.ok) return res.status(400).json({error:checked.error});
  await dbRun('UPDATE identities SET password_hash=?,credential_version=credential_version+1 WHERE id=?',[bcrypt.hashSync(password,10),identity.id]);
  await revokeIdentitySession(identity.id);
  res.json({ok:true,message:'密码已重置，请重新登录'});
}));
router.post('/api/auth/register',(_req,res)=>res.status(403).json({error:'请使用邀请码或由平台交付账号'}));
router.post('/api/auth/dev-login',(_req,res)=>res.status(404).json({error:'新账号模型不开放开发密钥登录'}));
router.post('/api/auth/register-with-invite',sessionEndpoint(async(req,res)=>{
  const {identity,result}=await registerWithInvite(req.body || {});
  const session=await createIdentitySession(identity.id,identity.credential_version);
  const account=await accountActor({identityId:identity.id,accountId:result.accountId});
  if (!account) return res.status(403).json({error:'账号绑定已撤销或已停用；请重新登录选择其他账号'});
  res.json({...result,user:identityUser(identity,account),token:signIdentityToken(identity,session,account.id),expiresAt:session.expiresAt,accounts:await identityAccounts(identity.id)});
}));
router.post('/api/auth/complete-profile',authenticateIdentity,sessionEndpoint(async(req,res)=>{
  const guardianName=String(req.body?.guardianName || '').trim();
  const realName=String(req.body?.realName || '').trim();
  if (!guardianName || req.body?.password) return res.status(400).json({error:'请输入守望师名；密码请通过修改密码或重置密码流程处理'});
  await dbRun('UPDATE identities SET guardian_name=?,real_name=? WHERE id=?',[guardianName,realName || req.identity.real_name,req.identity.id]);
  const identity=await dbGet('SELECT * FROM identities WHERE id=?',[req.identity.id]);
  res.json({user:identityUser(identity)});
}));
export default router;
