/*
 * EDS Block: furniture-viewer (batteries-included)
 *
 * Drop-in block — author creates a table with one cell containing the
 * product SKU. This block fetches product data from EDS sheets, builds
 * the full PDP UI (pickers, price, cart), and wires it to the headless
 * Jola 3D configurator.
 *
 * Sheets used:
 *   /products.json   — product catalog
 *   /models.json     — model variants per product
 *   /textures.json   — textures per product
 */

const WIDGET_SRC = `${window.hlx.codeBasePath}/widget/jola-configurator.js`;

async function fetchSheet(path) {
  const resp = await fetch(path);
  if (!resp.ok) return [];
  const json = await resp.json();
  return json.data || json;
}

async function loadProductData(sku) {
  const [products, models, textures] = await Promise.all([
    fetchSheet('/products.json'),
    fetchSheet('/models.json'),
    fetchSheet('/textures.json'),
  ]);

  const product = products.find((p) => p.sku === sku);
  if (!product) throw new Error(`Product "${sku}" not found in /products.json`);

  return {
    ...product,
    price: Number(product.price),
    models: models
      .filter((m) => m.product === sku)
      .map((m) => ({ sku: m.sku, name: m.name })),
    textures: textures
      .filter((t) => t.product === sku)
      .map((t) => ({
        sku: t.sku,
        name: t.name,
        color: t.color,
        roughness: Number(t.roughness),
        metalness: Number(t.metalness),
      })),
  };
}

function buildPDP(block, product) {
  const root = document.createElement('div');
  root.className = 'fv-root';

  root.innerHTML = `
    <div class="fv-left">
      <div class="fv-canvas"></div>
      <div class="fv-toolbar">
        <button class="fv-btn" data-action="reset">Reset view</button>
        <button class="fv-btn" data-action="screenshot">Screenshot</button>
        <label class="fv-label"><input type="checkbox" data-action="rotate" checked> Auto-rotate</label>
      </div>
    </div>
    <div class="fv-right">
      <h2 class="fv-name">${product.name}</h2>
      <p class="fv-price">${new Intl.NumberFormat('en-US', { style: 'currency', currency: product.currency }).format(product.price)}</p>
      <p class="fv-desc">${product.description}</p>

      <div class="fv-picker">
        <h3>Style</h3>
        <div class="fv-models"></div>
      </div>

      <div class="fv-picker">
        <h3>Texture</h3>
        <div class="fv-textures"></div>
        <p class="fv-texture-name"></p>
      </div>

      <button class="fv-cta">Add to cart</button>
    </div>
  `;

  const modelsRow = root.querySelector('.fv-models');
  product.models.forEach((m) => {
    const btn = document.createElement('button');
    btn.className = 'fv-model-btn';
    btn.textContent = m.name;
    btn.dataset.sku = m.sku;
    btn.setAttribute('aria-pressed', m.sku === product.defaultModel);
    modelsRow.append(btn);
  });

  const texturesRow = root.querySelector('.fv-textures');
  const textureName = root.querySelector('.fv-texture-name');
  product.textures.forEach((t, i) => {
    const sw = document.createElement('button');
    sw.className = 'fv-swatch';
    sw.title = t.name;
    sw.dataset.sku = t.sku;
    sw.style.background = t.color;
    const isDefault = product.defaultTexture
      ? t.sku === product.defaultTexture
      : i === 0;
    sw.setAttribute('aria-pressed', isDefault);
    if (isDefault) textureName.textContent = t.name;
    texturesRow.append(sw);
  });

  block.append(root);
  return root;
}

export default async function decorate(block) {
  const sku = block.querySelector('div > div')?.textContent?.trim() || 'lounge-001';
  block.textContent = '';

  const product = await loadProductData(sku);
  const root = buildPDP(block, product);

  await import(WIDGET_SRC);

  const viewer = await window.JolaConfigurator.create({
    el: root.querySelector('.fv-canvas'),
    productData: product,
  });

  block.jolaViewer = viewer;

  // Wire model picker
  root.querySelector('.fv-models').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-sku]');
    if (btn) viewer.setModel(btn.dataset.sku);
  });

  // Wire texture picker
  root.querySelector('.fv-textures').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-sku]');
    if (btn) viewer.setTexture(btn.dataset.sku);
  });

  // Sync UI on every change event
  viewer.on('change', (config) => {
    root.querySelectorAll('.fv-model-btn').forEach((btn) => {
      btn.setAttribute('aria-pressed', btn.dataset.sku === config.modelSku);
    });
    root.querySelectorAll('.fv-swatch').forEach((sw) => {
      sw.setAttribute('aria-pressed', sw.dataset.sku === config.textureSku);
    });
    const tex = product.textures.find((t) => t.sku === config.textureSku);
    if (tex) root.querySelector('.fv-texture-name').textContent = tex.name;

    document.dispatchEvent(new CustomEvent('jola:change', { detail: config }));
  });

  // Toolbar
  root.querySelector('[data-action="reset"]').addEventListener('click', () => viewer.resetCamera());
  root.querySelector('[data-action="screenshot"]').addEventListener('click', () => {
    const url = viewer.screenshot();
    const a = document.createElement('a');
    a.href = url; a.download = 'furniture.png'; a.click();
  });
  root.querySelector('[data-action="rotate"]').addEventListener('change', (e) => {
    viewer.setAutoRotate(e.target.checked);
  });

  // Cart
  root.querySelector('.fv-cta').addEventListener('click', () => {
    const config = viewer.getConfiguration();
    document.dispatchEvent(new CustomEvent('jola:add-to-cart', { detail: config }));
  });

  document.dispatchEvent(new CustomEvent('jola:ready', { detail: viewer.getConfiguration() }));
}
