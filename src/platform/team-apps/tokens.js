import jwt from 'jsonwebtoken';
import { config } from '../../config.js';
import { domainError } from '../../game/activities/link.js';
import { accountModelEnabled } from '../accounts/model.js';
import { registeredApp, requireMember, allowedTeamRequest } from './registry.js';

export const TEAM_AUDIENCE = 'wqt:team-player';
export const TEAM_ISSUER = 'wqt:platform';
export const TEAM_SCOPE = 'player:session';
export function bearerToken(req) {
  return req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : null;
}
export function isTeamToken(token) {
  const decoded = token && jwt.decode(token);
  return decoded?.type === 'team_app' || decoded?.aud === TEAM_AUDIENCE;
}
export function verifyTeamRequest(req) {
  if (!accountModelEnabled()) throw domainError(403, '团队应用未启用');
  let payload;
  try { payload = jwt.verify(bearerToken(req), config.JWT_SECRET,
    { algorithms: ['HS256'], audience: TEAM_AUDIENCE, issuer: TEAM_ISSUER }); }
  catch { throw domainError(401, '应用登录已过期，请重新连接'); }
  if (payload.type !== 'team_app' || payload.scope !== TEAM_SCOPE || payload.env !== (config.SERVER_ENV || 'prod') ||
      !Number.isSafeInteger(payload.exp) || !Number.isSafeInteger(payload.iat) || payload.exp - payload.iat > 900 ||
      !Number.isSafeInteger(payload.identityId) || payload.identityId <= 0 ||
      !Number.isSafeInteger(payload.accountId) || payload.accountId <= 0 ||
      typeof payload.jti !== 'string') throw domainError(401, '应用凭证无效');
  const app = registeredApp(payload.clientId);
  requireMember(app, payload.identityId);
  if (!app.redirectUris.includes(payload.redirectUri) || req.headers.origin !== new URL(payload.redirectUri).origin)
    throw domainError(403, '应用来源不匹配');
  if (!allowedTeamRequest(req.method, req.path)) throw domainError(403, '应用没有此接口权限');
  return payload;
}
export function teamTokenBoundary(req, res, next) {
  // Applies before every route, including legacy and public handlers. Decode only classifies;
  // all claims are verified before granting any access.
  if (!isTeamToken(bearerToken(req))) return next();
  res.set('Cache-Control', 'no-store');
  try {
    req.teamAppPayload = verifyTeamRequest(req);
    res.set('Access-Control-Allow-Origin', req.headers.origin);
    res.vary('Origin');
    next();
  } catch (error) { next(error); }
}
export function signTeamToken(record, expiresAt) {
  return jwt.sign({ type: 'team_app', clientId: record.clientId, redirectUri: record.redirectUri,
    scope: TEAM_SCOPE, identityId: record.identityId, accountId: record.accountId,
    jti: record.jti, credentialVersion: record.credentialVersion,
    env: config.SERVER_ENV || 'prod', exp: Math.floor(expiresAt / 1000) }, config.JWT_SECRET,
    { algorithm: 'HS256', audience: TEAM_AUDIENCE, issuer: TEAM_ISSUER });
}
