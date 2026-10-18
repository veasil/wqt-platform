import {organizationCapacity} from './organization-capacity.js';
import {validatePlayerSetting} from '../../game/player/config.js';
import {dbAll} from '../../db.js';
import {authMiddleware} from '../../middleware/auth.js';
import {requireRole} from '../../middleware/rbac.js';
import {sessionEndpoint} from '../../game/sessions/routes.js';
import {domainError} from '../../game/activities/link.js';
import {positiveId} from './context.js';
import {accountOperation,lockAccounts,authorizeOperation} from './service.js';
import {operationsSnapshot} from './operations-view.js';
import {generateInviteCode} from '../../game/activities/codes.js';
import {identitySessionRecords,revokeIdentitySession} from '../../services/identity-sessions.js';
import {encryptVal,decryptVal} from '../../config.js';
import {protectedKeys} from '../../startup-guards.js';

const environmentKeys=new Set([...protectedKeys,'CAPTCHA_ENABLED','CAPTCHA_APP_ID','CAPTCHA_APP_SECRET_KEY','TENCENT_SECRET_ID','TENCENT_SECRET_KEY']);
const sensitive=key=>/(KEY|SECRET|TOKEN|PASSWORD)/i.test(key) || ['BMOB_APP_ID','OSS_BUCKET_NAME','OSS_REGION','OSS_ENDPOINT'].includes(key);
const orgId=value=>value===0 || value==='0' ? 0:positiveId(value);
function audited(req,kind,input,work) {
  return accountOperation(req.actor,req.body?.requestId,kind,input,async tx=>{
    // Invitation creation and entitlement edits share subscription -> actor -> organization order.
    if(kind==='create-invite' && input.organizationId!==0)
      await tx.get('SELECT id FROM subscriptions WHERE organization_id=? FOR UPDATE',[input.organizationId]);
    await lockAccounts(tx,[req.actor.accountId]);
    await authorizeOperation(tx,req.actor);
    return {result:await work(tx)};
  });
}
export function registerOperationsRoutes(app) {
  const boss=[authMiddleware,requireRole('boss')];
  app.get('/api/admin/operations-snapshot',...boss,sessionEndpoint(async(_req,res)=>res.json(await operationsSnapshot())));
  app.get('/api/admin/organizations/:id',...boss,sessionEndpoint(async(req,res)=>{
    const id=orgId(req.params.id),snapshot=await operationsSnapshot(),organization=snapshot.organizations.find(o=>o.id===id);
    if(!organization) throw domainError(404,'组织不存在');
    res.json({organization,accounts:snapshot.accounts.filter(a=>a.organization_id===id),users:snapshot.users.filter(u=>u.accounts.some(a=>a.organization_id===id))});
  }));
  app.post('/api/admin/organizations/update-info',...boss,sessionEndpoint(async(req,res)=>{
    const id=orgId(req.body?.organizationId),name=String(req.body?.name || '').trim(),location=String(req.body?.location || '').trim(),description=String(req.body?.description || '').trim();
    if(id==null || !name || name.length>120 || location.length>200 || description.length>2000) throw domainError(400,'请填写合法组织名称、地点及说明');
    res.json(await audited(req,'organization-info',{id,name,location,description},async tx=>{
      if(!await tx.get('SELECT id FROM organizations WHERE id=? FOR UPDATE',[id])) throw domainError(404,'组织不存在');
      await tx.run('UPDATE organizations SET name=?,location=?,description=?,updated_at=? WHERE id=?',[name,location || null,description || null,Date.now(),id]);
      return {ok:true,organizationId:id};
    }));
  }));
  app.post('/api/admin/identities/update-profile',...boss,sessionEndpoint(async(req,res)=>{
    const identityId=positiveId(req.body?.identityId),guardianName=String(req.body?.guardianName || '').trim(),realName=String(req.body?.realName || '').trim();
    if(!identityId || !guardianName || guardianName.length>80 || realName.length>80) throw domainError(400,'请填写守望师名，姓名最多80字');
    res.json(await audited(req,'identity-profile',{identityId,guardianName,realName},async tx=>{
      if(!await tx.get('SELECT id FROM identities WHERE id=? FOR UPDATE',[identityId])) throw domainError(404,'用户不存在');
      await tx.run('UPDATE identities SET guardian_name=?,real_name=? WHERE id=?',[guardianName,realName || null,identityId]);return {ok:true,identityId};
    }));
  }));
  app.post('/api/admin/trials/activate',...boss,sessionEndpoint(async(req,res)=>{
    const accountId=positiveId(req.body?.accountId),reason=String(req.body?.reason || '').trim();
    if(!accountId || !reason) throw domainError(400,'请选择免费守望者账号并填写开启原因');
    res.json(await accountOperation(req.actor,req.body.requestId,'grant-trial',{accountId,reason},async tx=>{
      await lockAccounts(tx,[req.actor.accountId,accountId]);await authorizeOperation(tx,req.actor);
      const target=await tx.get(`SELECT a.*,o.status AS organization_status,COALESCE(s.valid_until,CASE WHEN o.entitlement_plan IS NOT NULL THEN o.valid_until END,a.valid_until) AS until,b.identity_id
        FROM accounts a JOIN organizations o ON o.id=a.organization_id LEFT JOIN subscriptions s ON s.id=a.subscription_id
        JOIN account_bindings b ON b.account_id=a.id AND b.ended_at IS NULL WHERE a.id=?`,[accountId]);
      const now=Date.now();
      if(!target || target.role!=='watcher' || target.status!=='active' || target.organization_status!=='active' || target.until>now) throw domainError(403,'仅当前可用的免费守望者账号可开启体验');
      const user=await tx.get("SELECT id,trial_until,trial_granted_at,trial_grant_consumed_at FROM identities WHERE id=? AND status='active' FOR UPDATE",[target.identity_id]);
      if(!user) throw domainError(403,'用户已停用');
      if(user.trial_until>now) throw domainError(409,'用户仍在体验中，不重复延长期限');
      if(Number(user.trial_granted_at||0)>Number(user.trial_grant_consumed_at||0))throw domainError(409,'用户已有待激活的体验权益');
      const trialGrantedAt=Math.max(now,Number(user.trial_grant_consumed_at||0)+1);
      await tx.run('UPDATE identities SET trial_granted_at=? WHERE id=?',[trialGrantedAt,user.id]);
      return {targetAccountId:accountId,result:{ok:true,identityId:user.id,accountId,trialGrantedAt,trialStatus:'pending_activation',reason}};
    }));
  }));
  app.get('/api/admin/invite-codes',...boss,sessionEndpoint(async(req,res)=>{
    const id=req.query.organizationId==null ? null:orgId(req.query.organizationId);
    if(req.query.organizationId!=null && id==null) throw domainError(400,'组织ID不正确');
    res.json({codes:await dbAll(`SELECT ic.*,o.name AS org_name,i.guardian_name AS creator_name FROM invite_codes ic
      LEFT JOIN organizations o ON o.id=ic.organization_id LEFT JOIN identities i ON i.id=ic.created_by_identity_id
      ${id==null ? '':'WHERE ic.organization_id=?'} ORDER BY ic.created_at DESC`,id==null ? []:[id])});
  }));
  app.post('/api/admin/invite-codes',...boss,sessionEndpoint(async(req,res)=>{
    const organizationId=orgId(req.body?.organizationId ?? 0),maxUses=Number(req.body?.maxUses ?? 1),days=Number(req.body?.expiresInDays ?? 7);
    if(organizationId==null || !Number.isSafeInteger(maxUses) || maxUses<1 || maxUses>10000 || !Number.isSafeInteger(days) || days<1 || days>365) throw domainError(400,'请填写合法组织、次数及1至365天有效期');
    res.json(await audited(req,'create-invite',{organizationId,maxUses,days},async tx=>{
      const org=await tx.get("SELECT id FROM organizations WHERE id=? AND status='active' FOR SHARE",[organizationId]);
      if(!org) throw domainError(403,'组织已停用或不存在');
      if(organizationId!==0) {
        const rights=await organizationCapacity(tx,organizationId);
        if(!rights.enabled || rights.validUntil<=Date.now()) throw domainError(403,'组织权益未开启或已到期');
        const vacant=await tx.get(`SELECT COUNT(*)::int AS count FROM accounts a WHERE a.organization_id=? AND a.status='active' AND a.role='watcher' AND NOT EXISTS(SELECT 1 FROM account_bindings b WHERE b.account_id=a.id)`,[organizationId]);
        const occupied=await tx.get('SELECT COUNT(*)::int AS n FROM account_bindings b JOIN accounts a ON a.id=b.account_id WHERE a.organization_id=? AND b.ended_at IS NULL',[organizationId]);
        vacant.count=Math.min(vacant.count,Math.max(0,rights.capacity-occupied.n));
        if(!vacant.count) throw domainError(409,'组织没有可首次绑定的空闲守望者账号，或已达到容量上限');
        if(maxUses>vacant.count) throw domainError(400,`当前只有${vacant.count}个首次绑定空位，请减少邀请码使用次数`);
      }
      const code=await generateInviteCode(),expiresAt=Date.now()+days*86400000;
      const row=await tx.run('INSERT INTO invite_codes(code,type,organization_id,created_by,created_by_identity_id,created_by_account_id,max_uses,expires_at) VALUES(?,?,?,0,?,?,?,?)',[code,organizationId===0 ? 'general':'organization',organizationId,req.actor.identityId,req.actor.accountId,maxUses,expiresAt]);
      return {ok:true,id:row.lastID,code,organizationId,expiresAt};
    }));
  }));
  app.post('/api/admin/identities/revoke-session',...boss,sessionEndpoint(async(req,res)=>{
    const identityId=positiveId(req.body?.identityId);
    if(!identityId) throw domainError(400,'用户ID不正确');
    const result=await audited(req,'revoke-session',{identityId},async tx=>{
      if(!await tx.get('SELECT id FROM identities WHERE id=?',[identityId])) throw domainError(404,'用户不存在');
      const record=(await identitySessionRecords([identityId])).get(identityId);return {ok:true,identityId,jti:record?.jti ?? null};
    });
    if(result.jti) await revokeIdentitySession(identityId,result.jti);
    res.json({ok:true,identityId});
  }));
  app.get('/api/admin/settings',...boss,sessionEndpoint(async(_req,res)=>{
    const rows=await dbAll('SELECT key,value,description,updated_at FROM system_settings ORDER BY key');
    const encryptionReady=/^[a-f0-9]{64}$/i.test(process.env.SETTINGS_ENCRYPTION_KEY || '');
    res.json({settings:rows.map(row=>({...row,value:sensitive(row.key) || environmentKeys.has(row.key) ? null:decryptVal(row.value),
      configured:!!row.value,sensitive:sensitive(row.key),editable:!environmentKeys.has(row.key) && (!sensitive(row.key) || encryptionReady),
      editReason:environmentKeys.has(row.key) ? '由部署环境管理':sensitive(row.key) && !encryptionReady ? '需先配置安全保存密钥':''}))});
  }));
  app.put('/api/admin/settings',...boss,sessionEndpoint(async(req,res)=>{
    const key=String(req.body?.key || '').trim(),value=String(req.body?.value ?? ''),description=String(req.body?.description || ''),keepExisting=req.body?.keepExisting===true;
    if(!/^[A-Z][A-Z0-9_]{0,127}$/.test(key) || environmentKeys.has(key)) throw domainError(400,'该配置须由部署环境管理，或键名不合法');
    if(!keepExisting) validatePlayerSetting(key,value);
    let stored=value;
    if(sensitive(key) && value) {
      if(!/^[a-f0-9]{64}$/i.test(process.env.SETTINGS_ENCRYPTION_KEY || '')) throw domainError(503,'未配置安全保存密钥，不能保存敏感值');
      stored=encryptVal(value);if(!stored?.startsWith('enc:')) throw domainError(503,'敏感配置加密失败');
    }
    res.json(await audited(req,'update-setting',{key,value,description,keepExisting},async tx=>{
      const existing=await tx.get('SELECT key FROM system_settings WHERE key=? FOR UPDATE',[key]);
      if(keepExisting && !existing) throw domainError(400,'配置不存在，请填写新值');
      if(keepExisting) await tx.run('UPDATE system_settings SET description=?,updated_at=CURRENT_TIMESTAMP WHERE key=?',[description,key]);
      else await tx.run('INSERT INTO system_settings(key,value,description,updated_at) VALUES(?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value=excluded.value,description=excluded.description,updated_at=excluded.updated_at',[key,stored,description]);
      return {ok:true,key};
    }));
  }));
  app.get('/api/admin/operators',...boss,sessionEndpoint(async(_req,res)=>res.json({operators:await dbAll(`SELECT a.id,a.name,i.guardian_name,i.phone,i.username,a.created_at FROM accounts a LEFT JOIN account_bindings b ON b.account_id=a.id AND b.ended_at IS NULL LEFT JOIN identities i ON i.id=b.identity_id WHERE a.role='operator' ORDER BY a.id`)})));
}
