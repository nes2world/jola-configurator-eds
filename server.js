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

// EDS sheets format: { total, offset, limit, data: [...rows] }
function edsSheet(rows) {
  return { total: rows.length, offset: 0, limit: rows.length, data: rows };
}

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
  res.setHeader('Access-Control-Allow-Origin', '*');

  // Serve EDS-format sheet JSONs from product catalog
  if (path === '/products.json' || path === '/models.json' || path === '/textures.json') {
    const products = await getCatalog();
    let rows;

    if (path === '/products.json') {
      rows = Object.values(products).map((p) => ({
        sku: p.id,
        name: p.name,
        price: p.price,
        currency: p.currency,
        description: p.description,
        defaultModel: p.defaultModel,
        defaultTexture: p.textures?.[0]?.sku || '',
      }));
    } else if (path === '/models.json') {
      rows = Object.values(products).flatMap((p) => p.models.map((m) => ({
        product: p.id,
        sku: m.sku,
        name: m.name,
      })));
    } else {
      rows = Object.values(products).flatMap((p) => p.textures.map((t) => ({
        product: p.id,
        sku: t.sku,
        name: t.name,
        color: t.color,
        roughness: t.roughness,
        metalness: t.metalness,
      })));
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(edsSheet(rows)));
    return;
  }

  // Legacy API endpoint (still used by widget in API mode)
  const apiMatch = path.match(/^\/api\/v1\/products\/([^/]+)$/);
  if (apiMatch) {
    const sku = decodeURIComponent(apiMatch[1]);
    const products = await getCatalog();
    const product = products[sku];
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
  console.log(`EDS local dev  → http://localhost:${PORT}`);
  console.log(`Products sheet → http://localhost:${PORT}/products.json`);
  console.log(`Models sheet   → http://localhost:${PORT}/models.json`);
  console.log(`Textures sheet → http://localhost:${PORT}/textures.json`);
});
