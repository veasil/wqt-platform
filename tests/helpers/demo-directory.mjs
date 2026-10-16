import bcrypt from 'bcryptjs';

// Used only by owned local UAT launchers; these are fictional names and test phones.
export async function seedDemoDirectory({dbGet,dbRun,deliverSubscription,bindAccount,phones,password}) {
  const target=new URL(process.env.DATABASE_URL || 'invalid:');
  if(!['127.0.0.1','localhost','[::1]'].includes(target.hostname)) throw new Error('Owned loopback UAT database required');
  const database=await dbGet('SELECT current_database() AS name');
  if(process.env.WQT_RUNTIME_TEST_CHILD!=='1' || !/^wqt_r1_[a-f0-9]{20}$/.test(database.name) || decodeURIComponent(target.pathname.slice(1))!==database.name) throw new Error('Owned UAT database required');
  if(phones.length!==6 || new Set(phones).size!==6) throw new Error('Six distinct synthetic UAT phones required');
  if(await dbGet('SELECT id FROM identities WHERE phone=?',[phones[0]])) return;
  const now=Date.now(),people=[];
  for(const [index,name] of ['林知夏咨询师','周禾社工','陈晓老师','许宁项目专员','沈悦老师','顾青体验用户'].entries()) {
    people.push((await dbRun('INSERT INTO identities(phone,password_hash,guardian_name,real_name,created_at) VALUES(?,?,?,?,?)',[phones[index],bcrypt.hashSync(password,10),name,name,now])).lastID);
  }
  const platform=(await dbRun("INSERT INTO organizations(name,owner_user_id) VALUES('伍仟天演示运营（虚构）',0)")).lastID;
  const bosses=[];
  for(const index of [0,1]) {
    const id=(await dbRun("INSERT INTO accounts(organization_id,name,role,valid_until,created_at) VALUES(?,?,'boss',?,?)",[platform,index===0?'林知夏 · 平台管理':'周禾 · 平台管理',now+365*86400000,now])).lastID;
    await dbRun('INSERT INTO account_bindings(account_id,identity_id,started_at) VALUES(?,?,?)',[id,people[index],now]);bosses.push(id);
  }
  const actor={identityId:people[0],accountId:bosses[0]};
  const scenarios=[
    {key:'personal',name:'林知夏咨询师（虚构）',location:'云州市 · 个人咨询',plan:'personal',person:0},
    {key:'social',name:'暖禾社工室（虚构）',location:'云州市 · 青禾社区',plan:'group',person:1},
    {key:'school',name:'青禾学校（虚构）',location:'云州市 · 青禾校区',plan:'group',person:2},
    {key:'city',name:'云州市妇联（虚构）',location:'云州市',plan:'city',person:3},
    {key:'expired',name:'星桥学校（虚构·已到期）',location:'云州市 · 星桥校区',plan:'group',person:4}
  ];
  for(const sample of scenarios) {
    const result=await deliverSubscription(actor,{requestId:`demo-directory-${sample.key}`,organizationName:sample.name,location:sample.location,plan:sample.plan,...(sample.plan==='city'?{validUntil:now+365*86400000}:{})});
    // Retain a clear example with both organization-wide rebindings consumed.
    const owners=sample.key==='school'?[people[2],people[4],people[2]]:[people[sample.person]];
    for(const [index,identityId] of owners.entries()) await bindAccount(actor,{requestId:`demo-directory-bind-${sample.key}-${index}`,accountId:result.accountIds[0],identityId});
    if(sample.key==='expired') {
      await dbRun('UPDATE subscriptions SET starts_at=?,valid_until=? WHERE id=?',[now-370*86400000,now-86400000,result.subscriptionId]);
      await dbRun('UPDATE organizations SET valid_until=? WHERE id=?',[now-86400000,result.organizationId]);
    }
  }
  // Keep free fallback and a free-only person for trial and account-choice checks.
  for(const index of [0,1,5]) {
    const id=(await dbRun("INSERT INTO accounts(organization_id,name,created_at) VALUES(0,?,?)",[index===5?'顾青 · 免费体验':'免费体验账号',now])).lastID;
    await dbRun('INSERT INTO account_bindings(account_id,identity_id,started_at) VALUES(?,?,?)',[id,people[index],now]);
  }
}
