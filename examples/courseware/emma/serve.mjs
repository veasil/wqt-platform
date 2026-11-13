import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
const directory = path.dirname(fileURLToPath(import.meta.url));
const files = new Map([
  ['/', ['index.html', 'text/html']], ['/index.html', ['index.html', 'text/html']],
  ['/app.js', ['app.js', 'text/javascript']], ['/config.js', ['config.js', 'text/javascript']],
  ['/style.css', ['style.css', 'text/css']],
  ['/sdk/team-client.js', ['../../../shared/browser/team-client.js', 'text/javascript']],
]);
export function createCoursewareServer({ config } = {}) {
  return createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('X-Content-Type-Options', 'nosniff');
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); res.end(); return; }
    let pathname;
    try { pathname = new URL(req.url, 'http://localhost').pathname; } catch { res.writeHead(400); res.end(); return; }
    const entry = files.get(pathname);
    if (!entry) { res.writeHead(404); res.end('Not found'); return; }
    try {
      const content = pathname === '/config.js' && config ? 'export const config = ' + JSON.stringify(config) + ';\n' : await readFile(path.resolve(directory, entry[0]));
      res.writeHead(200, { 'Content-Type': entry[1] + '; charset=utf-8' }); res.end(req.method === 'HEAD' ? undefined : content);
    } catch { res.writeHead(500); res.end('Unable to load courseware'); }
  });
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const port = Number(process.env.PORT || 8090);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
  const server = createCoursewareServer();
  server.listen(port, 'localhost', () => console.log('Emma courseware: http://localhost:' + port + '/'));
}
