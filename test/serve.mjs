// 정적 파일 서버. 테스트 사이트용 특수 경로: /admin → 401, /slow → 응답 지연, /api/* → 기록(폼 제출 감지용)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml' };

export function serve(root, port, { slowMs = 0 } = {}) {
  const hits = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    hits.push(`${req.method} ${url.pathname}`);
    if (url.pathname.startsWith('/api/')) { res.writeHead(200); return res.end('ok'); }
    if (url.pathname === '/admin') { res.writeHead(401); return res.end('login required'); }
    if (url.pathname === '/slow') { return setTimeout(() => { res.writeHead(200, { 'content-type': TYPES['.html'] }); res.end('<h1>slow</h1>'); }, slowMs); }
    let p = path.join(root, decodeURIComponent(url.pathname));
    if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, 'index.html');
    if (!fs.existsSync(p)) { res.writeHead(404, { 'content-type': TYPES['.html'] }); return res.end('<h1>404</h1>'); }
    res.writeHead(200, { 'content-type': TYPES[path.extname(p)] || 'application/octet-stream' });
    fs.createReadStream(p).pipe(res);
  });
  return new Promise((r) => server.listen(port, () => r({ server, hits })));
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('serve.mjs')) {
  const [root = 'web', port = '5173'] = process.argv.slice(2);
  serve(path.resolve(root), Number(port)).then(() => console.log(`http://localhost:${port} ← ${root}`));
}
