import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

const MIME = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.glb': 'model/gltf-binary', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.webp': 'image/webp',
};

let catalog = null;
async function getCatalog() {
  if (!catalog) {
    const raw = await readFile(join(__dirname, 'data', 'products.json'), 'utf-8');
    catalog = JSON.parse(raw);
  }
  return catalog;
}

const server = http.createServer(async (req, res) => {
  const [path] = req.url.split('?');

  // API: /api/v1/products/:sku — the endpoint the widget calls
  const apiMatch = path.match(/^\/api\/v1\/products\/([^/]+)$/);
  if (apiMatch) {
    // In production: validate the API key from query param or Authorization header
    const sku = decodeURIComponent(apiMatch[1]);
    const products = await getCatalog();
    const product = products[sku];
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (!product) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'product_not_found' }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(product));
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
  console.log(`Widget API    → http://localhost:${PORT}/api/v1/products/lounge-001`);
});
