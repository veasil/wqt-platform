import {dbAll} from '../../db.js';
import {identitySessionRecords} from '../../services/identity-sessions.js';

export function describeAccount(row,now=Date.now()) {
  const available=row.status==='active' && row.organization_status==='active';
  const paid=available && row.valid_until!=null && Number(row.valid_until)>now;
  const trial=available && row.identity_status==='active' && Number(row.trial_until)>now;
  const pending=available && Number(row.trial_granted_at||0)>Number(row.trial_grant_consumed_at||0);
  return {...row,available,paid_valid:paid,trial_valid:trial,trial_pending:pending,
    entitlement:!available ? '已停用':paid ? '有权益':trial ? '体验中':pending?'体验待激活':'免费',
    entitlement_until:paid ? row.valid_until:trial ? row.trial_until:row.valid_until ?? null};
}
export function describeUser(identity,accounts,session,now=Date.now()) {
  const usable=identity.status==='active' ? accounts.filter(a=>a.available):[];
  const categories=[];
  if(usable.some(a=>a.paid_valid)) categories.push('entitled');
  if(usable.some(a=>a.trial_valid)) categories.push('trial');
  if(identity.status==='active' && !categories.length) categories.push('free');
  if(usable.some(a=>a.role==='enterprise' && a.plan==='city')) categories.push('organization_admin');
  if(usable.some(a=>a.role==='boss')) categories.push('platform_admin');
  const online=identity.status==='active' && !!session && session.expiresAt>now && Number(session.credentialVersion ?? 0)===Number(identity.credential_version);
  return {...identity,credential_version:undefined,accounts,categories,online,
    session:online ? {createdAt:session.createdAt,expiresAt:session.expiresAt}:null};
}
export async function operationsSnapshot() {
  const [identities,rows,orgs,sessionStats]=await Promise.all([
    dbAll('SELECT id,phone,username,real_name,guardian_name,watcher_level,status,credential_version,trial_activated_at,trial_granted_at,trial_grant_consumed_at,trial_started_at,trial_until,created_at FROM identities ORDER BY id DESC'),
    dbAll(`SELECT a.*,o.name AS organization_name,o.status AS organization_status,o.location,
      COALESCE(s.plan,o.entitlement_plan) AS plan,s.rebind_count,COALESCE(s.valid_until,CASE WHEN o.entitlement_plan IS NOT NULL THEN o.valid_until END,a.valid_until) AS valid_until,
      b.identity_id,i.guardian_name,i.real_name,i.phone,i.status AS identity_status,i.trial_until,i.trial_granted_at,i.trial_grant_consumed_at
      FROM accounts a JOIN organizations o ON o.id=a.organization_id
      LEFT JOIN subscriptions s ON s.id=a.subscription_id
      LEFT JOIN account_bindings b ON b.account_id=a.id AND b.ended_at IS NULL
      LEFT JOIN identities i ON i.id=b.identity_id ORDER BY a.id`),
    dbAll(`SELECT o.*,s.id AS subscription_id,COALESCE(s.plan,o.entitlement_plan) AS plan,COALESCE(s.account_count,o.max_members) AS account_count,COALESCE(s.valid_until,CASE WHEN o.entitlement_plan IS NOT NULL THEN o.valid_until END) AS subscription_until,s.rebind_count
      FROM organizations o LEFT JOIN subscriptions s ON s.organization_id=o.id ORDER BY o.id`),
    dbAll(`SELECT organization_id,COUNT(*)::int AS total_sessions,COUNT(*) FILTER(WHERE status='active')::int AS active_sessions,
      ROUND(AVG(final_score),1) AS avg_score FROM game_sessions WHERE account_id IS NOT NULL AND status!='abandoned' GROUP BY organization_id`)
  ]);
  const now=Date.now(),accounts=rows.map(row=>describeAccount(row,now));
  const sessions=await identitySessionRecords(identities.map(i=>i.id));
  const users=identities.map(i=>describeUser(i,accounts.filter(a=>a.identity_id===i.id),sessions.get(i.id),now));
  const organizations=orgs.map(org=>{
    const members=accounts.filter(a=>a.organization_id===org.id),ids=new Set(members.map(a=>a.identity_id).filter(id=>id!=null));
    return {...org,current_members:members.length,bound_accounts:members.filter(a=>a.identity_id!=null).length,
      user_count:ids.size,online_users:users.filter(u=>ids.has(u.id) && u.online).length,
      entitled:org.id!==0 && members.some(a=>a.paid_valid),
      ...(sessionStats.find(s=>s.organization_id===org.id) || {total_sessions:0,active_sessions:0,avg_score:null})};
  });
  return {users,accounts,organizations,stats:{totalUsers:users.length,totalAccounts:accounts.length,
    entitledOrganizations:organizations.filter(o=>o.entitled).length,
    onlineUsers:users.filter(u=>u.online).length,entitledUsers:users.filter(u=>u.categories.includes('entitled')).length}};
}
