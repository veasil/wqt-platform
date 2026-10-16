// Reviewed fixture names/activity ownership only; never transfers a historical activity/session.
import pg from 'pg';
const url=new URL(process.env.WQT_MIGRATION_DATABASE_URL || 'invalid:');
if(url.hostname!=='127.0.0.1' || url.port!=='55447' || !/^\/wqt_r1_[a-f0-9]{20}$/.test(url.pathname)) throw new Error('Explicit dedicated owned UAT database required');
const client=new pg.Client({connectionString:url.toString()});await client.connect();
try {
  await client.query('BEGIN');
  for(const [id,oldName,name] of [[7,'三端验收组织','云州市妇联（虚构）'],[8,'自动验证城市组织','澄州市妇联（虚构）']]) {
    const org=(await client.query('SELECT o.name,s.plan FROM organizations o JOIN subscriptions s ON s.organization_id=o.id WHERE o.id=$1 AND o.owner_user_id=0 FOR UPDATE OF o',[id])).rows[0];
    if(!org || ![oldName,name].includes(org.name) || org.plan!=='city') throw new Error('Reviewed fixture organization differs');
    await client.query('UPDATE organizations SET name=$1 WHERE id=$2',[name,id]);
  }
  // WQTUAT already has historical session links and remains unchanged.
  for(const [code,id,name,organizer] of [['WQTCITY',7,'云州市妇联 · 数智安全体验','云州市妇联（虚构）'],['WQTSOCIAL',8,'澄州市妇联 · 社区体验','澄州市妇联（虚构）']]) {
    await client.query('INSERT INTO activities(name,organizer,activity_code,enterprise_id,status) VALUES($1,$2,$3,$4,\'active\') ON CONFLICT(activity_code) DO NOTHING',[name,organizer,code,id]);
    const activity=(await client.query('SELECT enterprise_id FROM activities WHERE activity_code=$1',[code])).rows[0];
    if(Number(activity.enterprise_id)!==id)throw new Error('Activity code already belongs to another organization');
  }
  await client.query('COMMIT');
  console.log(JSON.stringify({fictionalCityNames:true,activityOrganizations:{WQTCITY:7,WQTSOCIAL:8},historicalOwnershipChanged:false}));
}catch(error){await client.query('ROLLBACK');throw error;}finally{await client.end();}
