// Reviewed local UAT repair only. Never infer a production merge policy from role names.
import pg from 'pg';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {installOrganizationBindingUniqueness} from '../src/db/migrations/organization-binding-uniqueness.js';

export const reviewedPlan = [
  {organization:0,identity:2,keep:29,end:50,binding:14,role:'boss'},
  {organization:0,identity:3,keep:7,end:28,binding:10,role:'boss'},
  {organization:7,identity:3,keep:8,end:9,binding:9,role:'enterprise'},
  {organization:8,identity:2,keep:30,end:31,binding:13,role:'enterprise'},
];

export async function repairLocalUatBindings(client, {apply=false}={}) {
  const {host,database}=client.connectionParameters;
  if(!['127.0.0.1','localhost','::1'].includes(host) || !/^wqt_r1_[a-f0-9]{20}$/.test(database)) throw new Error('Explicit owned loopback UAT database required');
  await client.query('BEGIN');
  try {
    await client.query("SET LOCAL lock_timeout='5s'");
    await client.query('LOCK TABLE accounts,account_bindings,game_sessions,session_files,game_events IN SHARE ROW EXCLUSIVE MODE');
    const snapshot=async()=>{
      const result={};
      for(const table of ['game_sessions','session_files','game_events']) result[table]=(await client.query(`SELECT * FROM ${table} ORDER BY id`)).rows;
      return createHash('sha256').update(JSON.stringify(result)).digest('hex');
    };
    const before=await snapshot();
    let ended=0;
    for(const item of reviewedPlan) {
      const rows=(await client.query(`SELECT a.id,a.role,a.organization_id,b.id AS binding_id,b.identity_id,b.ended_at
        FROM accounts a JOIN account_bindings b ON b.account_id=a.id
        WHERE (a.id=$1 AND b.identity_id=$3 AND b.ended_at IS NULL) OR b.id=$2 ORDER BY a.id`,[item.keep,item.binding,item.identity])).rows;
      const keep=rows.find(r=>Number(r.id)===item.keep);
      const end=rows.find(r=>Number(r.binding_id)===item.binding);
      if(!keep || !end || keep.role!==item.role || end.role!=='watcher' || Number(end.id)!==item.end || [keep,end].some(r=>Number(r.organization_id)!==item.organization || Number(r.identity_id)!==item.identity)) throw new Error('Reviewed mapping differs from inventory');
      if(end.ended_at!=null) continue;
      // An old selected-account token will become invalid. Do not strand any account-owned work.
      for(const [table,column] of [['game_sessions','account_id'],['activities','created_by_account_id'],['invite_codes','created_by_account_id'],['player_feedback','account_id'],['user_feedback','account_id'],['organizations','owner_account_id']]) {
        if(Number((await client.query(`SELECT COUNT(*) AS n FROM ${table} WHERE ${column}=$1`,[item.end])).rows[0].n)!==0) throw new Error('Discarded binding has owned work; manual review required');
      }
      await client.query('UPDATE account_bindings SET ended_at=GREATEST(started_at,$1) WHERE id=$2 AND ended_at IS NULL',[Date.now(),item.binding]);
      ended++;
    }
    const duplicates=Number((await client.query(`SELECT COUNT(*) AS n FROM (SELECT a.organization_id,b.identity_id
      FROM account_bindings b JOIN accounts a ON a.id=b.account_id WHERE b.ended_at IS NULL
      GROUP BY a.organization_id,b.identity_id HAVING COUNT(*)>1) d`)).rows[0].n);
    if(duplicates) throw new Error('Unreviewed duplicate groups remain');
    await installOrganizationBindingUniqueness({run:(sql)=>client.query(sql)});
    if(before!==await snapshot()) throw new Error('Historical data changed');
    const result={mode:apply?'applied':'rehearsal-rolled-back',endedBindings:ended,duplicateGroups:duplicates,historySha256:before};
    await client.query(apply?'COMMIT':'ROLLBACK');
    return result;
  }catch(error){await client.query('ROLLBACK');throw error;}
}

if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  if(!process.env.WQT_MIGRATION_DATABASE_URL) throw new Error('Explicit WQT_MIGRATION_DATABASE_URL required');
  const client=new pg.Client({connectionString:process.env.WQT_MIGRATION_DATABASE_URL});
  try {await client.connect();console.log(JSON.stringify(await repairLocalUatBindings(client,{apply:process.argv.includes('--apply')})));}
  finally {await client.end();}
}
