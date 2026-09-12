import { dbGet, getGameEvents } from "../../db.js";
import { authMiddleware } from "../../middleware/auth.js";
import {
  accessibleSession,
  currentActor,
  sessionScope,
} from "../../platform/access/session-scope.js";
import { startSession, finishSession, writeEvent } from "./service.js";

export const sessionEndpoint = (handler) => async (req, res, next) => {
  try {
    await handler(req, res);
  } catch (error) {
    next(error);
  }
};

export function registerSessionRoutes(app) {
  app.post(
    "/api/game/start",
    authMiddleware,
    sessionEndpoint(async (req, res) => {
      res.json(await startSession(req.user.uid, req.body || {}));
    }),
  );
  app.post(
    "/api/game/finish",
    authMiddleware,
    sessionEndpoint(async (req, res) => {
      res.json(await finishSession(req.user.uid, req.body || {}));
    }),
  );
  app.post(
    "/api/game/event",
    authMiddleware,
    sessionEndpoint(async (req, res) => {
      res.json(await writeEvent(req.user.uid, req.body || {}));
    }),
  );
  app.get(
    "/api/game/last-session",
    authMiddleware,
    sessionEndpoint(async (req, res) => {
      const scope = sessionScope(await currentActor(req.user.uid));
      const session = await dbGet(
        `SELECT s.* FROM game_sessions s WHERE ${scope.sql} ORDER BY started_at DESC LIMIT 1`,
        scope.params,
      );
      res.json({ session: session || null });
    }),
  );
  app.get(
    "/api/game/session/:id",
    authMiddleware,
    sessionEndpoint(async (req, res) => {
      const id = Number(req.params.id);
      if (!Number.isSafeInteger(id) || id <= 0)
        return res.status(400).json({ error: "sessionId 不正确" });
      const session = await accessibleSession(req.user.uid, id);
      if (!session) return res.status(404).json({ error: "游戏不存在" });
      res.json({ session, events: await getGameEvents(id) });
    }),
  );
}
