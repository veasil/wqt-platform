import crypto from "crypto";
import { dbGet, dbAll, withTransaction } from "../../db.js";
import {
  accessibleSession,
  currentActor,
  sessionScope,
} from "../../platform/access/session-scope.js";

export function sessionFileObjectKey(sessionId, id) {
  return `session-files/${sessionId}/${id}`;
}

export async function createSessionFile({
  userId,
  sessionId,
  filename,
  mediaType,
  size,
  ossClient,
  content,
}) {
  const session = await accessibleSession(userId, sessionId, { write: true });
  if (!session) throw Object.assign(new Error("会话不可访问"), { status: 404 });
  const id = crypto.randomUUID();
  const objectKey = sessionFileObjectKey(sessionId, id);
  let uploaded = false;
  try {
    await ossClient.put(objectKey, content, {
      headers: { "x-oss-object-acl": "private" },
    });
    uploaded = true;
    await withTransaction(async (tx) => {
      const locked = await accessibleSession(userId, sessionId, {
        write: true,
        get: tx.get,
        lock: true,
      });
      if (!locked)
        throw Object.assign(new Error("会话不可访问"), { status: 404 });
      await tx.run(
        "INSERT INTO session_files(id, session_id, user_id, object_key, filename, media_type, size, created_at) VALUES(?,?,?,?,?,?,?,?)",
        [
          id,
          sessionId,
          userId,
          objectKey,
          filename,
          mediaType,
          size,
          Date.now(),
        ],
      );
    });
    return { id, objectKey, filename, mediaType, size };
  } catch (error) {
    if (uploaded) {
      try {
        await ossClient.delete(objectKey);
      } catch (cleanupError) {
        console.error(
          "Private upload cleanup failed:",
          objectKey,
          cleanupError.message,
        );
      }
    }
    throw error;
  }
}

export async function listSessionFiles(userId) {
  const actor = await currentActor(userId);
  const scope = sessionScope(actor, "s", { managed: true });
  const rows = await dbAll(
    `SELECT sf.id, sf.filename, sf.media_type, sf.size, sf.created_at
     FROM session_files sf JOIN game_sessions s ON s.id = sf.session_id
     WHERE ${scope.sql} ORDER BY sf.created_at DESC`,
    scope.params,
  );
  return rows.map((row) => ({
    name: row.filename,
    type: row.media_type?.startsWith("audio/")
      ? "audio"
      : row.media_type === "text/html"
        ? "report_html"
        : "report_md",
    size: row.size,
    lastModified: row.created_at,
    url: `/api/session-files/${row.id}`,
  }));
}

export async function getSessionFile(userId, id) {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      String(id),
    )
  )
    return null;
  const row = await dbGet("SELECT sf.* FROM session_files sf WHERE sf.id = ?", [
    id,
  ]);
  if (!row) return null;
  const session = await accessibleSession(userId, row.session_id, {
    write: false,
  });
  return session ? row : null;
}
