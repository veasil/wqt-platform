import { randomUUID } from 'node:crypto';
import { createClient } from 'redis';
import { config } from '../config.js';
import { domainError } from '../game/activities/link.js';

export const IDENTITY_SESSION_MS = 24 * 60 * 60 * 1000;
let client;

export async function initIdentitySessions() {
  if (client) throw new Error('Identity session client already initialized');
  if (!process.env.REDIS_URL || !/^rediss?:\/\//.test(process.env.REDIS_URL)) throw new Error('REDIS_URL required for accounts model');
  const next = createClient({ url:process.env.REDIS_URL,disableOfflineQueue:true,
    socket:{connectTimeout:5000,reconnectStrategy:retries=>Math.min(100*2**Math.min(retries,5),3000)} });
  // Do not emit URLs, credentials, phones or tokens in errors.
  next.on('error',() => console.warn('Redis identity session connection unavailable'));
  let startupTimer;
  try {
    await Promise.race([next.connect(),new Promise((_,reject)=>{startupTimer=setTimeout(()=>reject(new Error('connect timeout')),6000)})]);
    client=next;
  }
  catch { if (next.isOpen) next.destroy(); throw new Error('Redis identity sessions unavailable'); }
  finally {clearTimeout(startupTimer)}
}

export async function closeIdentitySessions() {
  const previous=client; client=undefined;
  if (previous?.isOpen) previous.destroy();
}

function sessionClient() {
  if (!client?.isReady) throw domainError(503,'登录会话校验暂不可用，请稍后重试');
  return client;
}
function key(identityId) {
  const namespace=process.env.WQT_REDIS_NAMESPACE || `wqt:${config.SERVER_ENV || 'prod'}`;
  if (!/^[a-zA-Z0-9:_-]{1,100}$/.test(namespace)) throw domainError(503,'会话命名空间配置无效');
  return `${namespace}:identity-session:${identityId}`;
}
async function guarded(work) {
  try { return await work(sessionClient()); }
  catch (error) { if (error.status) throw error; throw domainError(503,'登录会话校验暂不可用，请稍后重试'); }
}

// Read only the explicit identities in this environment; never scan other namespaces.
export async function identitySessionRecords(identityIds) {
  if(!identityIds.length) return new Map();
  const values=await guarded(c=>c.mGet(identityIds.map(key)));
  const records=new Map();
  values.forEach((value,index)=>{
    try {const record=JSON.parse(value);if(record?.jti && record.expiresAt>Date.now()) records.set(identityIds[index],record)} catch { /* Malformed sessions are not online. */ }
  });
  return records;
}

// Password-only verification no longer benefits from SMS send quotas. Bound the
// expensive password checks across instances using the existing Redis namespace.
export async function identityProofAttempt(identityId) {
  const attempts=await guarded(c=>c.eval("local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('PEXPIRE',KEYS[1],900000) end; return n",{keys:[`${key(identityId)}:proof-attempts`],arguments:[]}));
  if (attempts>30) throw domainError(429,'身份验证次数过多，请15分钟后重试');
}

export async function createIdentitySession(identityId,credentialVersion=0) {
  const record={jti:randomUUID(),createdAt:Date.now(),credentialVersion};
  record.expiresAt=record.createdAt+IDENTITY_SESSION_MS;
  await guarded(c => c.set(key(identityId),JSON.stringify(record),{PXAT:record.expiresAt}));
  return record;
}

export async function identitySession(identityId,jti) {
  if (!jti) return null;
  const serialized=await guarded(c => c.get(key(identityId)));
  if (!serialized) return null;
  let record;
  try { record=JSON.parse(serialized); } catch { return null; }
  return record.jti===jti && Date.now()<record.expiresAt ? record:null;
}

export async function revokeIdentitySession(identityId,jti=null) {
  if (!jti) return guarded(c => c.del(key(identityId)));
  // Old-device logout must not delete the newer device's active session.
  return guarded(c => c.eval("local value=redis.call('GET',KEYS[1]); if not value then return 0 end; local record=cjson.decode(value); if record.jti==ARGV[1] then return redis.call('DEL',KEYS[1]) end; return 0",
    {keys:[key(identityId)],arguments:[jti]}));
}

// Replaying a phone change must revoke the old credentials, not a newer login.
export async function revokeIdentityCredentialSession(identityId,credentialVersion) {
  return guarded(c=>c.eval("local value=redis.call('GET',KEYS[1]); if not value then return 0 end; local record=cjson.decode(value); if record.credentialVersion==tonumber(ARGV[1]) then return redis.call('DEL',KEYS[1]) end; return 0",
    {keys:[key(identityId)],arguments:[String(credentialVersion)]}));
}
