import { createReadStream, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.WQT_EMBEDDED_API = 'true';
const { default: apiHandler } = await import('./scripts/real-cards-api.mjs');

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(rootDir, 'dist');
const publicDir = path.join(rootDir, 'public');
const port = Number(process.env.PORT || 8080);

const contentTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.js', 'application/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.map', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.webp', 'image/webp'],
]);

function safeFile(root, pathname) {
  const relative = decodeURIComponent(pathname).replace(/^\/+/, '');
  const candidate = path.resolve(root, relative);
  return candidate === root || candidate.startsWith(`${root}${path.sep}`) ? candidate : null;
}

async function sendFile(request, response, filePath, cacheControl) {
  const info = await stat(filePath).catch(() => null);
  if (!info?.isFile()) return false;
  response.writeHead(200, {
    'Content-Type': contentTypes.get(path.extname(filePath).toLowerCase()) || 'application/octet-stream',
    'Content-Length': info.size,
    'Cache-Control': cacheControl,
  });
  if (request.method === 'HEAD') response.end();
  else createReadStream(filePath).pipe(response);
  return true;
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
    if (url.pathname === '/health' || url.pathname.startsWith('/api/')) {
      await apiHandler(request, response);
      return;
    }

    const publicFile = safeFile(publicDir, url.pathname);
    if (publicFile && existsSync(publicFile) && await sendFile(request, response, publicFile, 'public, max-age=3600')) return;

    const distFile = safeFile(distDir, url.pathname === '/' ? '/index.html' : url.pathname);
    if (distFile && existsSync(distFile)) {
      const immutable = url.pathname.startsWith('/assets/');
      if (await sendFile(request, response, distFile, immutable ? 'public, max-age=31536000, immutable' : 'no-store')) return;
    }

    if (request.method === 'GET' || request.method === 'HEAD') {
      await sendFile(request, response, path.join(distDir, 'index.html'), 'no-store');
      return;
    }
    response.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ error: 'Not found' }));
  } catch (error) {
    console.error('[server] request failed', { method: request.method, url: request.url, error: error.message });
    if (!response.headersSent) response.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ error: '服务暂时不可用' }));
  }
});

server.listen(port, '0.0.0.0', () => {
  console.log(`[server] WQT workbench listening on 0.0.0.0:${port}`);
});
