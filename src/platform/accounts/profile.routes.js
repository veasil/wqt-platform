import bcrypt from 'bcryptjs';
import {trialStatus,activateTrial} from './trial-service.js';
import { dbGet,dbAll,dbRun,withTransaction } from '../../db.js';
import { authMiddleware } from '../../middleware/auth.js';
import { authenticateIdentity } from './auth.js';
import { identityUser } from './auth.routes.js';
import { accountActor } from './context.js';
import { sessionEndpoint } from '../../game/sessions/routes.js';
import { sessionScope,accessibleSession } from '../access/session-scope.js';
import {domainError} from '../../game/activities/link.js';
import { listSessionFiles } from '../../integrations/media/session-files.js';
import { revokeIdentitySession } from '../../services/identity-sessions.js';

export function registerAccountProfileRoutes(app) {
  app.get('/api/me/entitlements',authMiddleware,sessionEndpoint(async(req,res)=>{
   const experience=trialStatus(req.identity);
   const paid=req.account.paid_valid;
   res.set('Cache-Control','no-store').json({account:{id:req.account.id,name:req.account.name,role:req.account.role,organizationId:req.account.organization_id,plan:req.account.plan,paidValid:paid,validUntil:req.account.valid_until},experience:{...experience,canActivate:experience.pending&&!experience.active&&!paid&&req.account.role==='watcher'},capabilities:{startGame:paid||experience.active,requiresActivityCode:false,downloads:paid,aiFeedback:paid,learningStatus:'separate_platform'}});
  }));
  app.post('/api/me/trial/activate',authMiddleware,sessionEndpoint(async(req,res)=>res.json(await activateTrial(req.actor,req.body?.requestId))));
  app.get('/api/me',authMiddleware,sessionEndpoint(async(req,res)=>res.json({user:identityUser(req.identity,req.account)})));
  app.put('/api/me/profile',authenticateIdentity,sessionEndpoint(async(req,res)=>{
    const name=String(req.body?.guardianName || '').trim();
    const realName=String(req.body?.realName || '').trim();
    if (!name && !realName) return res.status(400).json({error:'没有要更新的字段'});
    await dbRun('UPDATE identities SET guardian_name=?,real_name=? WHERE id=?',[name || req.identity.guardian_name,realName || req.identity.real_name,req.identity.id]);
    const identity=await dbGet('SELECT * FROM identities WHERE id=?',[req.identity.id]);
    const account=await accountActor({identityId:identity.id,accountId:req.identityPayload.accountId});
    res.json({user:identityUser(identity,account)});
  }));
  app.put('/api/me/password',authenticateIdentity,sessionEndpoint(async(req,res)=>{
    const {oldPassword,newPassword}=req.body || {};
    if (typeof newPassword!=='string' || newPassword.length<6) return res.status(400).json({error:'新密码至少6位'});
    if (!req.identity.password_hash || !bcrypt.compareSync(String(oldPassword || ''),req.identity.password_hash)) return res.status(401).json({error:'旧密码错误'});
    await dbRun('UPDATE identities SET password_hash=?,credential_version=credential_version+1 WHERE id=?',[bcrypt.hashSync(newPassword,10),req.identity.id]);
    await revokeIdentitySession(req.identity.id);
    res.json({ok:true,requiresLogin:true});
  }));
  app.get('/api/me/sessions',authMiddleware,sessionEndpoint(async(req,res)=>{
    const scope=sessionScope(req.account,'s');
    const limit=Math.max(1,Math.min(Number(req.query.limit) || 50,200));
    const offset=Math.max(0,Number(req.query.offset) || 0);
    const sessions=await dbAll(`SELECT s.*,
      (SELECT a.name FROM activity_sessions link JOIN activities a ON a.id=link.activity_id WHERE link.session_id=s.id ORDER BY a.id LIMIT 1) AS activity_name,
      EXISTS(SELECT 1 FROM player_feedback f WHERE f.session_id=s.id AND f.identity_id=? AND f.account_id=s.account_id) AS has_feedback
      FROM game_sessions s WHERE ${scope.sql} AND status!='abandoned' ORDER BY started_at DESC LIMIT ? OFFSET ?`,[req.identity.id,...scope.params,limit,offset]);
    const total=await dbGet(`SELECT COUNT(*) AS count FROM game_sessions s WHERE ${scope.sql} AND status!='abandoned'`,scope.params);
    res.json({sessions,total:total.count});
  }));
  app.get('/api/me/files',authMiddleware,sessionEndpoint(async(req,res)=>res.json({files:await listSessionFiles(req.actor)})));
  app.get('/api/me/activities',authMiddleware,sessionEndpoint(async(req,res)=>{
    const scope=sessionScope(req.account,'gs');
    const activities=await dbAll(`SELECT a.*,gs.id AS session_id,gs.final_score,gs.started_at AS session_started,gs.ended_at AS session_ended,link.table_no
      FROM activity_sessions link JOIN activities a ON a.id=link.activity_id JOIN game_sessions gs ON gs.id=link.session_id
      WHERE ${scope.sql} ORDER BY gs.started_at DESC`,scope.params);
    res.json({activities});
  }));
  app.get('/api/me/activities/created',authMiddleware,sessionEndpoint(async(req,res)=>{
    res.json({activities:await dbAll('SELECT * FROM activities WHERE created_by_account_id=? AND enterprise_id=? ORDER BY created_at DESC',[req.account.id,req.account.organization_id])});
  }));
  app.post('/api/me/feedback',authMiddleware,sessionEndpoint(async(req,res)=>{
    const {type='reflection',content,activity_id:activityId,session_id:sessionId}=req.body || {};
    if (!String(content || '').trim()) throw domainError(400,'内容不能为空');
    const result=await withTransaction(async tx=>{
      const actor=await accountActor(req.actor,tx.get,{lock:true});
      if (!actor) throw domainError(403,'账号绑定已撤销');
      if (sessionId && !await accessibleSession(req.actor,sessionId,{get:tx.get})) throw domainError(404,'场次不存在');
      if (activityId) {
        const permitted=await tx.get(`SELECT a.id FROM activities a WHERE a.id=? AND (a.created_by_account_id=? OR EXISTS(
          SELECT 1 FROM activity_sessions link JOIN game_sessions s ON s.id=link.session_id WHERE link.activity_id=a.id AND s.account_id=?))`,[activityId,actor.id,actor.id]);
        if (!permitted) throw domainError(404,'活动不存在');
      }
      return tx.run('INSERT INTO user_feedback(identity_id,account_id,type,content,activity_id,session_id) VALUES(?,?,?,?,?,?)',[req.identity.id,actor.id,type,String(content).trim(),activityId || null,sessionId || null]);
    });
    res.json({ok:true,id:result.lastID});
  }));
  app.get('/api/me/feedback',authMiddleware,sessionEndpoint(async(req,res)=>{
    // Feedback remains private to the submitting identity and the current account.
    // Joining session scope also removes access after leaving the original organization.
    const scope=sessionScope(req.account,'s');
    const feedback=await dbAll(`SELECT f.id,f.type,f.content,f.created_at,f.reviewed,f.session_id
      FROM user_feedback f LEFT JOIN game_sessions s ON s.id=f.session_id
      WHERE f.identity_id=? AND f.account_id=? AND (f.session_id IS NULL OR (${scope.sql}))
      ORDER BY f.created_at DESC,f.id DESC LIMIT 200`,[req.identity.id,req.account.id,...scope.params]);
    const surveys=await dbAll(`SELECT f.session_id,f.questionnaire_json,f.answers_json,f.created_at,s.location
      FROM player_feedback f JOIN game_sessions s ON s.id=f.session_id
      WHERE f.identity_id=? AND f.account_id=? AND ${scope.sql}
      ORDER BY f.created_at DESC,f.session_id DESC LIMIT 200`,[req.identity.id,req.account.id,...scope.params]);
    res.set('Cache-Control','no-store').json({feedback,surveys});
  }));
  app.post('/api/me/level-application',authenticateIdentity,sessionEndpoint(async(req,res)=>{
    const result=await withTransaction(async tx=>{
      const identity=await tx.get("SELECT watcher_level FROM identities WHERE id=? AND status='active' FOR UPDATE",[req.identity.id]);
      if (!identity) throw domainError(403,'身份已停用');
      if (await tx.get("SELECT id FROM watcher_level_applications WHERE identity_id=? AND status='pending'",[req.identity.id])) throw domainError(409,'已有待审核的申请');
      const toLevel={initial:'advanced',advanced:'mentor'}[identity.watcher_level];
      if (!toLevel) throw domainError(400,'已是最高等级，无需申请');
      const row=await tx.run('INSERT INTO watcher_level_applications(identity_id,from_level,to_level,reason) VALUES(?,?,?,?)',[req.identity.id,identity.watcher_level,toLevel,req.body?.reason || null]);
      return {ok:true,id:row.lastID,fromLevel:identity.watcher_level,toLevel};
    });
    res.json(result);
  }));
  app.get('/api/me/level-application',authenticateIdentity,sessionEndpoint(async(req,res)=>{
    res.json({application:await dbGet('SELECT * FROM watcher_level_applications WHERE identity_id=? ORDER BY created_at DESC,id DESC LIMIT 1',[req.identity.id]) || null});
  }));
}
