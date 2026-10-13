import crypto from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { dbAll, dbGet, dbRun, withTransaction } from '../../db.js';
import { authMiddleware } from '../../middleware/auth.js';
import { requireRole } from '../../middleware/rbac.js';
const sessionEndpoint = handler => async (req,res,next) => { try { await handler(req,res); } catch(error) { next(error); } };
const safeMiddleware = handler => (req,res,next) => Promise.resolve(handler(req,res,next)).catch(next);

function downloadFilename(original) {
  let filename = original;
  // Multipart parsers default to latin1 for filename parameters sent as UTF-8.
  if ([...filename].every(char => char.charCodeAt(0) <= 255)) {
    try { filename = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(filename, 'latin1')); }
    catch { /* Preserve filenames that were actually encoded as latin1. */ }
  }
  return filename.replace(/[\\/\r\n\x00-\x1f]/g, '_').slice(0, 180) || 'materials.zip';
}

export function hasDownloadEntitlement(req, now = Date.now()) {
  return req.accountValidity?.valid === true && req.accountValidity.until != null && req.accountValidity.until > now;
}

export function registerDownloadRoutes(app, { ossClient, upload,
  authenticate = safeMiddleware(authMiddleware), boss = safeMiddleware(requireRole('boss')),
  store = { all: dbAll, get: dbGet, run: dbRun, transaction: withTransaction } } = {}) {
  const fields = 'id,title,version,filename,size,sha256,created_at';
  const latest = () => store.get(`SELECT * FROM download_releases ORDER BY created_at DESC,id DESC LIMIT 1`);
  const audit = (req, event, status, run = store.run, releaseId = req.params.id || null) => run(
    `INSERT INTO download_events(id,request_id,release_id,user_id,organization_id,event,status,created_at) VALUES(?,?,?,?,?,?,?,?)`,
    [crypto.randomUUID(), req.downloadRequestId, releaseId, req.user?.uid || null,
      req.downloadUser?.enterprise_id || req.userRow?.enterprise_id || null, event, status, Date.now()]);
  const identify = (req, _res, next) => { req.downloadRequestId = crypto.randomUUID(); next(); };
  // Record auth rejection before returning it, without trusting claims from rejected tokens.
  const guardedAuth = (req, res, next) => {
    const json = res.json.bind(res);
    res.json = function(body) {
      if (res.statusCode < 400) return json(body);
      res.json = json;
      audit(req, 'denied', res.statusCode).then(() => json(body)).catch(next);
      return res;
    };
    authenticate(req, res, error => { res.json = json; next(error); });
  };
  const entitled = async (req, res, next) => { try {
    req.downloadUser = await store.get('SELECT id,enterprise_id FROM users WHERE id=?',[req.user.uid]);
    if (hasDownloadEntitlement(req)) return next();
    await audit(req, 'denied', 403);
    res.status(403).json({ error: '下载资料需要有效的付费权益', code: 'NO_PAID_ENTITLEMENT' });
  } catch (error) { next(error); } };
  app.get('/api/downloads', identify, guardedAuth, entitled, sessionEndpoint(async (_req, res) => {
    res.set('Cache-Control', 'no-store');
    const row = await latest();
    res.json({ releases: row ? [Object.fromEntries(fields.split(',').map(key => [key, row[key]]))] : [] });
  }));
  app.get('/api/downloads/:id/file', identify, guardedAuth, entitled, sessionEndpoint(async (req, res) => {
    const row = await latest();
    if (!row || row.id !== req.params.id) {
      await audit(req, 'unavailable', 404);
      return res.status(404).json({ error: '资料已更新或不存在，请刷新下载中心' });
    }
    await audit(req, 'requested', 200);
    let stream;
    try {
      if (!ossClient) throw new Error('OSS unavailable');
      ({ stream } = await ossClient.getStream(row.object_key));
      // The response stays private and downloads as an attachment even for HTML uploads.
      res.set('Cache-Control', 'private, no-store');
      res.set('Content-Type', 'application/octet-stream');
      res.attachment(row.filename);
      res.set('Content-Length', String(row.size));
      let bytes = 0;
      const counter = new Transform({
        transform(chunk, _encoding, done) { bytes += chunk.length; done(null, chunk); },
        flush(done) { done(bytes === Number(row.size) ? null : new Error('Stored file length does not match release metadata')); },
      });
      await pipeline(stream, counter, res);
    } catch (error) {
      stream?.destroy();
      await audit(req, 'failed', error.code === 'ERR_STREAM_PREMATURE_CLOSE' ? 499 : 502);
      if (res.headersSent) return;
      res.removeHeader('Content-Length');
      res.status(502).json({ error: '文件传输失败，请重试' });
      return;
    }
    // An audit failure after sending is not a file transfer failure.
    // Keep requested unresolved and expose the failure in server logs.
    try { await audit(req, 'server_sent', 200); }
    catch (error) { console.error('Download completion audit failed', req.downloadRequestId, error.message); }
  }));
  app.get('/api/admin/downloads', authenticate, boss, sessionEndpoint(async (_req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ releases: await store.all(`SELECT ${fields} FROM download_releases ORDER BY created_at DESC,id DESC LIMIT 100`) });
  }));
  app.get('/api/admin/downloads/events', authenticate, boss, sessionEndpoint(async (_req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ events: await store.all(`SELECT e.*,r.title,r.version FROM download_events e LEFT JOIN download_releases r ON r.id=e.release_id ORDER BY e.created_at DESC,e.id DESC LIMIT 200`) });
  }));
  app.post('/api/admin/downloads', identify, authenticate, boss, upload.single('file'), sessionEndpoint(async (req, res) => {
    const title = String(req.body?.title || '').trim();
    const version = String(req.body?.version || '').trim();
    if (!title || title.length > 120 || !version || version.length > 80 || !req.file?.size)
      return res.status(400).json({ error: '请提供资料名称、版本和非空文件' });
    if (!ossClient) return res.status(503).json({ error: '服务器未配置文件存储' });
    const id = crypto.randomUUID();
    const key = `download-center/${id}`;
    const filename = downloadFilename(req.file.originalname);
    const sha256 = crypto.createHash('sha256').update(req.file.buffer).digest('hex');
    let uploaded = false;
    try {
      await ossClient.put(key, req.file.buffer, { headers: { 'x-oss-object-acl': 'private' } });
      uploaded = true;
      await store.transaction(async tx => {
        await tx.run(`INSERT INTO download_releases(id,title,version,filename,object_key,size,sha256,created_at) VALUES(?,?,?,?,?,?,?,?)`,
          [id, title, version, filename, key, req.file.size, sha256, Date.now()]);
        await audit(req, 'published', 201, tx.run, id);
      });
      res.status(201).json({ ok: true, id });
    } catch (error) {
      if (uploaded) await ossClient.delete(key).catch(cleanup => console.error('Download upload cleanup failed', id, cleanup.message));
      throw error;
    }
  }));
  // Keep errors in the added APIs JSON without altering legacy routes.
  app.use(['/api/downloads', '/api/admin/downloads'], (error, _req, res, next) => {
    if (res.headersSent) return next(error);
    const status = error.code === 'LIMIT_FILE_SIZE' ? 413 : error.status || 500;
    if (status >= 500) console.error('Download center request failed', error.message);
    res.status(status).json({ error: status === 413 ? '文件不能超过 50 MB' : status >= 500 ? '下载中心暂不可用，请重试' : error.message });
  });
}
