import http from 'node:http';
import https from 'node:https';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const VENIA_GRAPHQL = 'https://venia.magento.com/graphql';

const MIME = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.glb': 'model/gltf-binary', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.webp': 'image/webp',
};

function proxyToVenia(req, res) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      const proxyReq = https.request(VENIA_GRAPHQL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }, (proxyRes) => {
        let data = '';
        proxyRes.on('data', (chunk) => { data += chunk; });
        proxyRes.on('end', () => {
          res.writeHead(proxyRes.statusCode, { 'Content-Type': 'application/json' });
          res.end(data);
          resolve();
        });
      });
      proxyReq.on('error', (err) => {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
        resolve();
      });
      proxyReq.end(body);
    });
  });
}

const server = http.createServer(async (req, res) => {
  const [path] = req.url.split('?');

  // Proxy GraphQL to Venia (avoids CORS)
  if (path === '/graphql' && req.method === 'POST') {
    await proxyToVenia(req, res);
    return;
  }

  // Static files
  let filePath = path;
  if (filePath === '/') filePath = '/index.html';
  const fullPath = join(__dirname, filePath);

  try {
    const data = await readFile(fullPath);
    const ext = extname(fullPath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  }
});

server.listen(PORT, () => {
  console.log(`EDS local dev → http://localhost:${PORT}`);
  console.log(`GraphQL proxy → http://localhost:${PORT}/graphql → ${VENIA_GRAPHQL}`);
});
