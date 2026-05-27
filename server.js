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

function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => resolve(body));
  });
}

async function handleGraphQL(req, res) {
  const body = JSON.parse(await readBody(req));
  const { query = '' } = body;
  const products = await getCatalog();

  // Parse SKU filter from query: filter: { sku: { eq: "..." } }
  const skuMatch = query.match(/sku\s*:\s*\{\s*eq\s*:\s*"([^"]+)"/);
  // Parse search term: search: "..."
  const searchMatch = query.match(/search\s*:\s*"([^"]*)"/);

  let items = [];

  if (skuMatch) {
    const product = products[skuMatch[1]];
    if (product) items = [product];
  } else if (searchMatch) {
    const term = searchMatch[1].toLowerCase();
    items = Object.values(products).filter((p) => p.name.toLowerCase().includes(term) || p.sku.includes(term));
  } else {
    items = Object.values(products);
  }

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    data: {
      products: {
        items,
        total_count: items.length,
      },
    },
  }));
}

const server = http.createServer(async (req, res) => {
  const [path] = req.url.split('?');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Store, Magento-Environment-Id');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Mock Adobe Commerce GraphQL endpoint
  if (path === '/graphql' && req.method === 'POST') {
    await handleGraphQL(req, res);
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
  console.log(`EDS local dev     → http://localhost:${PORT}`);
  console.log(`Commerce GraphQL  → http://localhost:${PORT}/graphql`);
});
