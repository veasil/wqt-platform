import {dbAll,dbGet} from '../../db.js';
import {authMiddleware} from '../../middleware/auth.js';
import {requireRole,requireEnterprise} from '../../middleware/rbac.js';
import {sessionEndpoint} from '../../game/sessions/routes.js';
import {deliverSubscription,renewSubscription,bindAccount,createVerifiedIdentity,setStatus,changeIdentityPhone} from './service.js';
import {revokeIdentityCredentialSession} from '../../services/identity-sessions.js';
import {positiveId} from './context.js';
import {domainError} from '../../game/activities/link.js';
import {sessionScope} from '../access/session-scope.js';
import {registerOperationsRoutes} from './operations.routes.js';
import {operationsSnapshot} from './operations-view.js';
import {updateOrganizationEntitlements} from './organization-entitlements.js';

const membersSql=`SELECT a.id,a.id AS account_id,a.name,a.role,a.status,a.organization_id,a.subscription_id,
  b.identity_id,i.phone,i.guardian_name,i.real_name,i.watcher_level,COALESCE(s.valid_until,CASE WHEN o.entitlement_plan IS NOT NULL THEN o.valid_until END,a.valid_until) AS valid_until
  FROM accounts a JOIN organizations o ON o.id=a.organization_id LEFT JOIN account_bindings b ON b.account_id=a.id AND b.ended_at IS NULL
  LEFT JOIN identities i ON i.id=b.identity_id LEFT JOIN subscriptions s ON s.id=a.subscription_id`;

export function registerAccountAdminRoutes(app) {
  registerOperationsRoutes(app);
  const boss=[authMiddleware,requireRole('boss')];
  const city=[authMiddleware,requireEnterprise];
  app.post('/api/admin/organizations/update-entitlements',...boss,sessionEndpoint(async(req,res)=>res.json(await updateOrganizationEntitlements(req.actor,req.body))));
  for (const [path,service] of [['/api/admin/subscriptions',deliverSubscription],['/api/admin/subscriptions/renew',renewSubscription],['/api/admin/account-bindings',bindAccount],['/api/admin/identities',createVerifiedIdentity],['/api/admin/status',setStatus]])
    app.post(path,...boss,sessionEndpoint(async(req,res)=>res.json(await service(req.actor,req.body || {}))));
  app.post('/api/enterprise/account-bindings',...city,sessionEndpoint(async(req,res)=>res.json(await bindAccount(req.actor,req.body || {}))));
  app.post('/api/admin/identities/change-phone',...boss,sessionEndpoint(async(req,res)=>{
    const result=await changeIdentityPhone(req.actor,req.body || {});
    if(result.changed) await revokeIdentityCredentialSession(result.identityId,result.previousCredentialVersion);
    res.json({...result,requiresLogin:true});
  }));
  app.get('/api/admin/identities',...boss,sessionEndpoint(async(_req,res)=>{
    res.json({identities:await dbAll('SELECT id,phone,guardian_name,real_name,watcher_level,status,trial_activated_at,trial_started_at,trial_until,created_at FROM identities ORDER BY id DESC')});
  }));
  app.get('/api/admin/accounts',...boss,sessionEndpoint(async(_req,res)=>res.json({accounts:await dbAll(`${membersSql} ORDER BY a.id`)})));
  app.get('/api/admin/organizations',...boss,sessionEndpoint(async(_req,res)=>res.json({organizations:await dbAll(`SELECT o.*,s.id AS subscription_id,COALESCE(s.plan,o.entitlement_plan) AS plan,COALESCE(s.account_count,o.max_members) AS account_count,COALESCE(s.valid_until,CASE WHEN o.entitlement_plan IS NOT NULL THEN o.valid_until END) AS subscription_until,s.rebind_count,
    (SELECT COUNT(*) FROM accounts a WHERE a.organization_id=o.id) AS current_members FROM organizations o LEFT JOIN subscriptions s ON s.organization_id=o.id ORDER BY o.id`)})));
  app.get('/api/admin/organizations/:id/members',...boss,sessionEndpoint(async(req,res)=>{
    const id=positiveId(req.params.id);
    if (!id && Number(req.params.id)!==0) throw domainError(400,'组织ID不正确');
    res.json({members:await dbAll(`${membersSql} WHERE a.organization_id=? ORDER BY a.id`,[Number(req.params.id)])});
  }));
  app.get('/api/enterprise/info',...city,sessionEndpoint(async(req,res)=>{
    const organization=await dbGet('SELECT o.*,s.id AS subscription_id,COALESCE(s.plan,o.entitlement_plan) AS plan,COALESCE(s.account_count,o.max_members) AS account_count,COALESCE(s.valid_until,CASE WHEN o.entitlement_plan IS NOT NULL THEN o.valid_until END) AS subscription_until,s.rebind_count FROM organizations o LEFT JOIN subscriptions s ON s.organization_id=o.id WHERE o.id=?',[req.account.organization_id]);
    const count=await dbGet('SELECT COUNT(*)::int AS count FROM accounts WHERE organization_id=?',[req.account.organization_id]);
    res.json({organization:{...organization,maxMembers:organization.account_count,currentMembers:count.count,validUntil:organization.subscription_until}});
  }));
  app.get('/api/enterprise/members',...city,sessionEndpoint(async(req,res)=>res.json({members:await dbAll(`${membersSql} WHERE a.organization_id=? ORDER BY a.id`,[req.account.organization_id])})));
  app.get('/api/enterprise/sessions',...city,sessionEndpoint(async(req,res)=>{
    const scope=sessionScope(req.account,'s',{managed:true});
    res.json({sessions:await dbAll(`SELECT s.*,a.name AS account_name,i.guardian_name FROM game_sessions s JOIN accounts a ON a.id=s.account_id LEFT JOIN identities i ON i.id=s.created_by_identity_id WHERE ${scope.sql} ORDER BY s.started_at DESC`,scope.params)});
  }));
  app.get('/api/enterprise/dashboard',...city,sessionEndpoint(async(req,res)=>{
    const scope=sessionScope(req.account,'s',{managed:true});
    const stats=await dbGet(`SELECT COUNT(*)::int AS total_sessions,ROUND(AVG(s.final_score),1) AS avg_score,
      COUNT(DISTINCT CASE WHEN s.started_at>? THEN s.account_id END)::int AS active_members FROM game_sessions s WHERE ${scope.sql}`,[Date.now()-30*86400000,...scope.params]);
    const members=await dbGet('SELECT COUNT(*)::int AS count FROM accounts WHERE organization_id=?',[req.account.organization_id]);
    const recent=await dbAll(`SELECT s.*,a.name AS account_name,i.guardian_name FROM game_sessions s JOIN accounts a ON a.id=s.account_id LEFT JOIN identities i ON i.id=s.created_by_identity_id WHERE ${scope.sql} ORDER BY s.started_at DESC LIMIT 10`,scope.params);
    res.json({totalMembers:members.count,activeMembers:stats.active_members,totalSessions:stats.total_sessions,avgScore:stats.avg_score,recentSessions:recent});
  }));
  app.get('/api/admin/stats/overview',...boss,sessionEndpoint(async(_req,res)=>{
    const identities=await dbGet('SELECT COUNT(*)::int AS count FROM identities');
    const accounts=await dbGet('SELECT COUNT(*)::int AS count FROM accounts');
    const orgs=await dbGet('SELECT COUNT(*)::int AS count FROM organizations');
    const sessions=await dbGet('SELECT COUNT(*)::int AS count FROM game_sessions WHERE account_id IS NOT NULL');
    const usersByRole=await dbAll('SELECT role,COUNT(*)::int AS c FROM accounts GROUP BY role');
    const sessionsByStatus=await dbAll('SELECT status,COUNT(*)::int AS c FROM game_sessions WHERE account_id IS NOT NULL GROUP BY status');
    const dailySignups=await dbAll("SELECT to_char(to_timestamp(created_at/1000.0),'YYYY-MM-DD') AS d,COUNT(*)::int AS c FROM identities WHERE created_at>? GROUP BY d ORDER BY d",[Date.now()-14*86400000]);
    const dailySessions=await dbAll("SELECT to_char(to_timestamp(started_at/1000.0),'YYYY-MM-DD') AS d,COUNT(*)::int AS c FROM game_sessions WHERE account_id IS NOT NULL AND started_at>? GROUP BY d ORDER BY d",[Date.now()-14*86400000]);
    const {stats}=await operationsSnapshot();
    res.json({totalUsers:identities.count,totalAccounts:accounts.count,totalOrganizations:orgs.count,totalOrgs:orgs.count,totalSessions:sessions.count,usersByRole,sessionsByStatus,dailySignups,dailySessions,...stats});
  }));
  app.get('/api/admin/account-operations',...boss,sessionEndpoint(async(_req,res)=>res.json({operations:await dbAll("SELECT id,request_id,operation,actor_identity_id,actor_account_id,target_account_id,subscription_id,CASE WHEN operation='revoke-session' THEN NULL ELSE result_json END AS result_json,created_at FROM account_operations ORDER BY id DESC LIMIT 200")})));
}
