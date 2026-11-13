import { createHash, randomBytes } from 'node:crypto';
import { dbGet } from '../../db.js';
import { authenticateIdentity, authenticateAccount } from '../accounts/auth.js';
import { accountActor, positiveId } from '../accounts/context.js';
import { identitySession, storeTeamAuthorizationCode, consumeTeamAuthorizationCode } from '../../services/identity-sessions.js';
import { domainError } from '../../game/activities/link.js';
import { registeredApp, registeredRedirect, requireMember } from './registry.js';
import { signTeamToken } from './tokens.js';

export function pkceChallenge(verifier) {
  if (typeof verifier !== 'string' || !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) throw domainError(400, 'PKCE 校验参数无效');
  return createHash('sha256').update(verifier).digest('base64url');
}
export function authorizationInput(input) {
  const app = registeredApp(input.client_id);
  const redirect = registeredRedirect(app, input.redirect_uri);
  if (input.code_challenge_method !== 'S256' || typeof input.code_challenge !== 'string' ||
      !/^[A-Za-z0-9_-]{43}$/.test(input.code_challenge) || typeof input.state !== 'string' ||
      !/^[A-Za-z0-9._~-]{16,256}$/.test(input.state)) throw domainError(400, '授权请求参数无效');
  return { app, redirect };
}
const endpoint = handler => async (req, res, next) => { try { await handler(req, res); } catch (error) { next(error); } };
export function registerTeamAppRoutes(app) {
  app.use('/api/connect', (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  app.post('/api/connect/authorize', authenticateIdentity, endpoint(async (req, res) => {
    const input = req.body || {};
    const { app: registration, redirect } = authorizationInput(input);
    requireMember(registration, req.identity.id);
    const accountId = positiveId(input.accountId);
    const actor = accountId && await accountActor({ identityId: req.identity.id, accountId });
    if (!actor) throw domainError(403, '账号绑定已失效或账号不可用');
    const code = randomBytes(32).toString('base64url');
    await storeTeamAuthorizationCode(code, {
      clientId: registration.clientId, redirectUri: input.redirect_uri, challenge: input.code_challenge,
      identityId: req.identity.id, accountId, jti: req.identitySession.jti,
      credentialVersion: req.identity.credential_version, expiresAt: Math.min(Date.now() + 60_000, req.identitySession.expiresAt),
    });
    redirect.searchParams.set('code', code);
    redirect.searchParams.set('state', input.state);
    res.json({ redirectUrl: redirect.href });
  }));
  app.post('/api/connect/token', endpoint(async (req, res) => {
    const input = req.body || {};
    const registration = registeredApp(input.client_id);
    const redirect = registeredRedirect(registration, input.redirect_uri);
    if (req.headers.origin !== redirect.origin) throw domainError(403, '应用来源不匹配');
    if (input.grant_type !== 'authorization_code' || typeof input.code !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(input.code))
      throw domainError(400, '授权兑换参数无效');
    const challenge = pkceChallenge(input.code_verifier);
    const record = await consumeTeamAuthorizationCode(input.code, registration.clientId, input.redirect_uri, challenge);
    if (!record) throw domainError(400, '授权码无效、已使用或已过期');
    requireMember(registration, record.identityId);
    const session = await identitySession(record.identityId, record.jti);
    const identity = session && await dbGet("SELECT credential_version FROM identities WHERE id=? AND status='active'", [record.identityId]);
    const actor = identity && await accountActor(record);
    if (!session || !identity || !actor || identity.credential_version !== record.credentialVersion || session.credentialVersion !== record.credentialVersion)
      throw domainError(401, '原登录或账号已失效，请重新登录');
    const expiresAt = Math.min(Date.now() + 900_000, session.expiresAt);
    if (expiresAt - Date.now() < 1000) throw domainError(401, '原登录已到期，请重新登录');
    res.set('Access-Control-Allow-Origin', redirect.origin);
    res.vary('Origin');
    res.json({ access_token: signTeamToken(record, expiresAt), token_type: 'Bearer', expires_in: Math.max(0, Math.floor(expiresAt / 1000) - Math.floor(Date.now() / 1000)) });
  }));
  app.get('/api/connect/session', authenticateAccount, endpoint(async (req, res) => {
    if (!req.teamAppPayload) throw domainError(403, '请使用团队应用凭证');
    res.json({ account: { id: req.account.id, name: req.account.name, organizationId: req.account.organization_id }, expiresAt: req.teamAppPayload.exp * 1000 });
  }));
}
