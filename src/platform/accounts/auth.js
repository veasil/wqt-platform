import jwt from 'jsonwebtoken';
import { config } from '../../config.js';
import { dbGet } from '../../db.js';
import { identitySession } from '../../services/identity-sessions.js';
import { accountActor, positiveId } from './context.js';

export function signIdentityToken(identity,session,accountId=null) {
  return jwt.sign({ type:'identity',identityId:identity.id,accountId,jti:session.jti,
    credentialVersion:identity.credential_version,env:config.SERVER_ENV || 'prod',exp:Math.floor(session.expiresAt/1000) },config.JWT_SECRET);
}

export async function authenticateIdentity(req,res,next) {
  const token=req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7):null;
  if (!token) return res.status(401).json({error:'未登录'});
  let payload;
  try { payload=jwt.verify(token,config.JWT_SECRET); }
  catch { return res.status(401).json({error:'登录已过期，请重新登录'}); }
  if (payload.type!=='identity' || !positiveId(payload.identityId) || payload.env!==(config.SERVER_ENV || 'prod')) return res.status(401).json({error:'登录凭证不适用于当前账号模型或环境'});
  try {
    const session=await identitySession(payload.identityId,payload.jti);
    if (!session) return res.status(401).json({error:'登录会话已失效，请重新登录',code:'SESSION_REVOKED'});
    const identity=await dbGet("SELECT * FROM identities WHERE id=? AND status='active'",[payload.identityId]);
    if (!identity) return res.status(403).json({error:'登录身份不存在或已停用'});
    if (payload.credentialVersion!==identity.credential_version) return res.status(401).json({error:'登录凭据已变更，请重新登录'});
    req.identity=identity;
    req.identitySession=session;
    req.identityPayload=payload;
    next();
  } catch (error) { next(error); }
}

export async function authenticateAccount(req,res,next) {
  return authenticateIdentity(req,res,async (authenticationError) => {
    if (authenticationError) return next(authenticationError);
    try {
      const context={identityId:req.identity.id,accountId:req.identityPayload.accountId};
      if (!positiveId(context.accountId)) return res.status(403).json({error:'请先选择使用账号',code:'ACCOUNT_REQUIRED'});
      const actor=await accountActor(context);
      if (!actor) return res.status(403).json({error:'账号绑定已撤销或账号/组织已停用',code:'ACCOUNT_UNAVAILABLE'});
      req.actor=context;
      req.account=actor;
      // uid continues to mean the authenticated person; resource code receives req.actor explicitly.
      req.user={uid:req.identity.id,identityId:req.identity.id,accountId:actor.id,role:actor.role,
        enterpriseId:actor.organization_id,username:req.identity.guardian_name || req.identity.phone,jti:req.identitySession.jti};
      req.accountValidity={valid:actor.paid_valid,until:actor.valid_until,reason:actor.paid_valid ? null:'NO_PAID_ENTITLEMENT'};
      next();
    } catch (error) { next(error); }
  });
}
