import bcrypt from 'bcryptjs';

// Test fixture only. Never call against an application or production database.
export async function provisionUatReviewer(client,{phone,password}) {
 const database=(await client.query('SELECT current_database() AS name')).rows[0].name;
 if(!/^wqt_r1_[a-f0-9]{20}$/.test(database) || !['127.0.0.1','localhost','::1'].includes(client.connectionParameters.host))throw new Error('Owned loopback UAT database required');
 if(!/^1[3-9]\d{9}$/.test(phone || '') || !password || password.length<12)throw new Error('Reviewer configuration required');
 await client.query('BEGIN');
 try{
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',['uat-reviewer:'+phone]);
  const now=Date.now(),until=now+30*86400000;
  await client.query('INSERT INTO identities(phone,password_hash,guardian_name,created_at) VALUES($1,$2,$3,$4) ON CONFLICT(phone) DO NOTHING',[phone,bcrypt.hashSync(password,10),'三端验收守望者',now]);
  const identity=(await client.query('SELECT id FROM identities WHERE phone=$1',[phone])).rows[0].id;
  const orgName=phone==='16600000889'?'自动验证城市组织':'三端验收组织';
  let org=(await client.query('SELECT id FROM organizations WHERE name=$1 AND owner_user_id=0',[orgName])).rows[0]?.id;
  if(!org)org=(await client.query('INSERT INTO organizations(name,owner_user_id) VALUES($1,0) RETURNING id',[orgName])).rows[0].id;
  let subscription=(await client.query('SELECT id FROM subscriptions WHERE organization_id=$1',[org])).rows[0]?.id;
  if(!subscription)subscription=(await client.query("INSERT INTO subscriptions(organization_id,plan,account_count,starts_at,valid_until,created_at) VALUES($1,'city',20,$2,$3,$2) RETURNING id",[org,now,until])).rows[0].id;
  const ids={};
  for(const [name,role] of [[orgName+' · 平台管理验收账号','boss'],['城市级组织管理验收账号','enterprise'],...Array.from({length:19},(_,i)=>['组织守望者 '+String(i+1).padStart(2,'0'),'watcher'])]){
   let targetOrg=org;
   const targetSubscription=role==='boss'?null:subscription;
   // Preserve old platform bindings in place. New platform accounts get a dedicated organization.
   let account=role==='boss'?(await client.query("SELECT id FROM accounts WHERE name=$1 AND role='boss' ORDER BY id LIMIT 1",[name])).rows[0]?.id:null;
   if(role==='boss' && !account){
    const platformName=orgName+' · 平台运营（虚构）';
    targetOrg=(await client.query('SELECT id FROM organizations WHERE name=$1 AND owner_user_id=0',[platformName])).rows[0]?.id;
    if(!targetOrg)targetOrg=(await client.query('INSERT INTO organizations(name,owner_user_id) VALUES($1,0) RETURNING id',[platformName])).rows[0].id;
   }
   if(role!=='boss')account=(await client.query('SELECT id FROM accounts WHERE organization_id=$1 AND name=$2',[targetOrg,name])).rows[0]?.id;
   if(!account)account=(await client.query('INSERT INTO accounts(organization_id,subscription_id,name,role,valid_until,created_at) VALUES($1,$2,$3,$4,$5,$6) RETURNING id',[targetOrg,targetSubscription,name,role,until,now])).rows[0].id;
   if(role!=='watcher'){
    await client.query('INSERT INTO account_bindings(account_id,identity_id,started_at) SELECT $1,$2,$3 WHERE NOT EXISTS(SELECT 1 FROM account_bindings WHERE account_id=$1 AND ended_at IS NULL)',[account,identity,now]);
    const binding=(await client.query('SELECT identity_id FROM account_bindings WHERE account_id=$1 AND ended_at IS NULL',[account])).rows[0];
    if(String(binding.identity_id)!==String(identity))throw new Error('Reviewer fixture binding belongs to another identity');
    ids[role]=account;
   }
  }
  // City administrators use their own account for both organization management and play.
  ids.watcher=ids.enterprise;
  let free=(await client.query("SELECT a.id FROM accounts a JOIN account_bindings b ON b.account_id=a.id WHERE b.identity_id=$1 AND b.ended_at IS NULL AND a.role='watcher' AND a.organization_id=0 ORDER BY a.id LIMIT 1",[identity])).rows[0]?.id;
  if(!free){free=(await client.query("INSERT INTO accounts(organization_id,name,role,created_at) VALUES(0,'免费体验验收账号','watcher',$1) RETURNING id",[now])).rows[0].id;await client.query('INSERT INTO account_bindings(account_id,identity_id,started_at) VALUES($1,$2,$3)',[free,identity,now])}
  await client.query('COMMIT');
  return {identityId:identity,organizationId:org,accounts:ids,freeAccountId:free,plan:'city',accountCapacity:20};
 }catch(error){await client.query('ROLLBACK');throw error}
}
