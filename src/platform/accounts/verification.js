import bcrypt from 'bcryptjs';
import {verifyCode} from '../../services/sms.js';
import {domainError} from '../../game/activities/link.js';
import {identityProofAttempt} from '../../services/identity-sessions.js';
import {CAPTCHA_ENABLED} from '../../services/captcha.js';

// Proofs authenticate a person; an invitation only identifies the destination account.
export async function verifyIdentityProof(identity,input) {
  if (!identity || identity.status!=='active') throw domainError(401,'手机号未注册或用户已停用');
  const method=input.verificationMethod || (input.password ? (input.code || input.smsCode ? 'legacy':'password'):'sms');
  if (method==='wechat') throw domainError(503,'微信身份验证待接入，请选择密码或短信');
  if (!['password','sms','legacy'].includes(method)) throw domainError(400,'请选择有效的身份验证方式');
  if (method==='sms' && !CAPTCHA_ENABLED && !['test','development'].includes(process.env.NODE_ENV))
    throw domainError(503,'短信身份验证需先配置人机验证通道，请使用密码验证');
  await identityProofAttempt(identity.id);
  if (method!=='sms' && (!input.password || !identity.password_hash || !await bcrypt.compare(String(input.password),identity.password_hash)))
    throw domainError(401,'手机号或密码错误');
  if (method!=='password') {
    const code=String(input.smsCode || input.code || '').trim();
    if (!code) throw domainError(400,'请填写短信验证码');
    const checked=await verifyCode(identity.phone,code,{consume:true});
    if (!checked.ok) throw domainError(400,checked.error || '验证码错误');
  }
  return method;
}
