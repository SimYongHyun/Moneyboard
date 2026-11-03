import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const files = new Set(['/index.html', '/firebase-config.js', '/src/app.js', '/src/model.js']);
const port = Number(process.env.PORT || 4173);
createServer(async (request, response) => {
  const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
  const file = pathname === '/' ? '/index.html' : pathname;
  if (!files.has(file)) { response.writeHead(404).end(); return; }
  try {
    const content = await readFile(resolve('.' + file));
    response.writeHead(200, { 'content-type': file.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8', 'cache-control': 'no-store' }).end(content);
  } catch { response.writeHead(404).end(); }
}).listen(port, '127.0.0.1', () => console.log(`http://127.0.0.1:${port}`));
