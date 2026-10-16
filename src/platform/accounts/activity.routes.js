import {authMiddleware} from '../../middleware/auth.js';
import {requireRole} from '../../middleware/rbac.js';
import {dbGet,dbAll} from '../../db.js';
import {sessionEndpoint} from '../../game/sessions/routes.js';
import {joinActivity} from '../../game/sessions/service.js';
import {domainError} from '../../game/activities/link.js';
import {accountOperation,lockAccounts,authorizeOperation} from './service.js';
import {generateActivityCode} from '../../game/activities/codes.js';
import {reviewLevelApplication,setIdentityLevel} from './level-service.js';

export function registerAccountActivityRoutes(app) {
  const boss=[authMiddleware,requireRole('boss')];
  app.post('/api/game/join-activity',authMiddleware,sessionEndpoint(async(req,res)=>{
    const result=await joinActivity(req.actor,req.body || {});
    res.json({ok:true,activity_id:result.activity.id,activity_name:result.activity.name,table_no:result.activity.table_no});
  }));
  app.get('/api/activities/by-code/:code',sessionEndpoint(async(req,res)=>{
    const activity=await dbGet('SELECT id,name,organizer,activity_code,started_at,ended_at,status FROM activities WHERE activity_code=?',[String(req.params.code).toUpperCase()]);
    if (!activity) throw domainError(404,'活动码无效');
    if (activity.status!=='active') throw domainError(410,'活动尚未开放或已结束');
    res.json({activity});
  }));
  app.get('/api/admin/activities',...boss,sessionEndpoint(async(_req,res)=>{
    res.json({activities:await dbAll(`SELECT a.*,COUNT(DISTINCT link.session_id) AS table_count,COUNT(DISTINCT s.account_id) AS participant_count,ROUND(AVG(s.final_score),1) AS avg_score
      FROM activities a LEFT JOIN activity_sessions link ON link.activity_id=a.id LEFT JOIN game_sessions s ON s.id=link.session_id GROUP BY a.id ORDER BY a.created_at DESC`)});
  }));
  app.post('/api/admin/activities',...boss,sessionEndpoint(async(req,res)=>{
    const {requestId,name,organizer=null,started_at=null,ended_at=null,category='general'}=req.body || {};
    if (!String(name || '').trim()) throw domainError(400,'活动名称不能为空');
    const input={name:String(name).trim(),organizer,started_at,ended_at,category};
    const result=await accountOperation(req.actor,requestId,'create-activity',input,async tx=>{
      await lockAccounts(tx,[req.actor.accountId]);
      await authorizeOperation(tx,req.actor);
      const code=await generateActivityCode(category);
      const row=await tx.run('INSERT INTO activities(name,organizer,activity_code,started_at,ended_at,created_by_identity_id,created_by_account_id) VALUES(?,?,?,?,?,?,?)',[input.name,organizer,code,started_at,ended_at,req.identity.id,req.account.id]);
      return {result:{ok:true,id:row.lastID,activity_code:code}};
    });
    res.json(result);
  }));
  app.put('/api/admin/activities/:id',...boss,sessionEndpoint(async(req,res)=>{
    const id=Number(req.params.id);
    const {requestId,...fields}=req.body || {};
    if (fields.status && !['active','pending','ended','suspended','rejected'].includes(fields.status)) throw domainError(400,'活动状态无效');
    res.json(await accountOperation(req.actor,requestId,'update-activity',{id,fields},async tx=>{
      await lockAccounts(tx,[req.actor.accountId]);
      await authorizeOperation(tx,req.actor);
      const existing=await tx.get('SELECT * FROM activities WHERE id=? FOR UPDATE',[id]);
      if (!existing) throw domainError(404,'活动不存在');
      await tx.run('UPDATE activities SET name=?,organizer=?,started_at=?,ended_at=?,status=? WHERE id=?',[fields.name || existing.name,fields.organizer ?? existing.organizer,fields.started_at ?? existing.started_at,fields.ended_at ?? existing.ended_at,fields.status || existing.status,id]);
      return {result:{ok:true,id}};
    }));
  }));
  app.get('/api/admin/activities/:id/sessions',...boss,sessionEndpoint(async(req,res)=>{
    res.json({sessions:await dbAll(`SELECT s.*,i.guardian_name,i.phone,link.table_no FROM activity_sessions link JOIN game_sessions s ON s.id=link.session_id
      LEFT JOIN identities i ON i.id=s.created_by_identity_id WHERE link.activity_id=? ORDER BY link.table_no`,[req.params.id])});
  }));
  app.get('/api/admin/level-applications',...boss,sessionEndpoint(async(req,res)=>res.json({applications:await dbAll(`SELECT la.*,i.guardian_name,i.phone FROM watcher_level_applications la
    JOIN identities i ON i.id=la.identity_id WHERE la.status=? ORDER BY la.created_at DESC`,[req.query.status || 'pending'])})));
  app.put('/api/admin/level-applications/:id',...boss,sessionEndpoint(async(req,res)=>res.json(await reviewLevelApplication(req.actor,{...req.body,applicationId:req.params.id}))));
  app.put('/api/admin/identities/:id/level',...boss,sessionEndpoint(async(req,res)=>res.json(await setIdentityLevel(req.actor,{...req.body,identityId:req.params.id}))));
  app.get('/api/admin/feedback',...boss,sessionEndpoint(async(req,res)=>{
    const filter=req.query.reviewed===undefined ? '': ' WHERE f.reviewed=?';
    res.json({feedback:await dbAll(`SELECT f.*,i.guardian_name,i.phone FROM user_feedback f JOIN identities i ON i.id=f.identity_id${filter} ORDER BY f.created_at DESC`,filter ? [Number(req.query.reviewed)]:[])});
  }));
  app.put('/api/admin/feedback/:id/read',...boss,sessionEndpoint(async(req,res)=>{
    const id=Number(req.params.id);
    res.json(await accountOperation(req.actor,req.body?.requestId,'read-feedback',{id},async tx=>{
      await lockAccounts(tx,[req.actor.accountId]);
      await authorizeOperation(tx,req.actor);
      const feedback=await tx.get('SELECT id FROM user_feedback WHERE id=? AND identity_id IS NOT NULL FOR UPDATE',[id]);
      if (!feedback) throw domainError(404,'反馈不存在');
      await tx.run('UPDATE user_feedback SET reviewed=1 WHERE id=?',[id]);
      return {result:{ok:true,id}};
    }));
  }));
  // Personal activity applications and city management writes await their explicit business gate.
  for (const path of ['/api/activities','/api/activities/apply']) app.post(path,authMiddleware,(_req,res)=>res.status(503).json({error:'活动申请权限边界待确认'}));
}
