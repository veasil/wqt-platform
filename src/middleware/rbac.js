import { dbGet } from "../db.js";
import { accountActor } from "../platform/accounts/context.js";

// 角色校验：要求当前用户的 role 在给定集合内
export function requireRole(...roles) {
  return async (req, res, next) => {
    if (req.actor) {
      try {
        const account=await accountActor(req.actor);
        if (!account || !roles.includes(account.role)) return res.status(403).json({error:'无权限'});
        req.account=account;
        req.userRow=account;
        return next();
      } catch (error) { return next(error); }
    }
    const user = await dbGet("SELECT id, role, enterprise_id FROM users WHERE id = ?", [req.user.uid]);
    if (!user || !roles.includes(user.role)) {
      return res.status(403).json({ error: "无权限" });
    }
    req.userRow = user;
    next();
  };
}

// 组织管理员校验：解析 enterprise_id 对应的组织，挂到 req.org
export async function requireEnterprise(req, res, next) {
  if (req.actor) {
    try {
      const account=await accountActor(req.actor);
      if (!account || account.role!=='enterprise' || account.plan!=='city') return res.status(403).json({error:'仅城市级组织管理员可访问'});
      req.userRow=account;
      req.account=account;
      req.org=await dbGet('SELECT * FROM organizations WHERE id=?',[account.organization_id]);
      return next();
    } catch (error) { return next(error); }
  }
  const user = await dbGet("SELECT id, role, enterprise_id FROM users WHERE id = ?", [req.user.uid]);
  if (!user || user.role !== "enterprise" || !user.enterprise_id) {
    return res.status(403).json({ error: "仅组织管理员可访问" });
  }
  const org = await dbGet("SELECT * FROM organizations WHERE id = ? AND status = 'active'", [user.enterprise_id]);
  if (!org) {
    return res.status(403).json({ error: "组织不存在或已停用" });
  }
  req.userRow = user;
  req.org = org;
  next();
}
