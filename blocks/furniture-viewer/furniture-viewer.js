/*
 * EDS Block: furniture-viewer (batteries-included)
 *
 * Fetches product data from Adobe Commerce GraphQL, builds the full
 * PDP UI, and wires it to the headless Jola 3D configurator.
 *
 * Commerce custom attributes used:
 *   - jola_model   (configurable option) — maps to 3D model variant
 *   - jola_texture  (configurable option) — maps to 3D texture/material
 *   - jola_default_model   (custom attribute) — initial model to show
 *   - jola_default_texture  (custom attribute) — initial texture to show
 *   - jola_3d.textures     — 3D material properties per texture value
 */

const WIDGET_SRC = `${window.hlx.codeBasePath}/widget/jola-configurator.js`;

// In production, this comes from configs.js or site metadata
const COMMERCE_ENDPOINT = window.JOLA_COMMERCE_ENDPOINT || '/graphql';

const PRODUCT_QUERY = `
  query ProductBySku($sku: String!) {
    products(filter: { sku: { eq: $sku } }) {
      items {
        id
        sku
        name
        description { html }
        price_range {
          minimum_price {
            regular_price { value currency }
          }
        }
        media_gallery { url label }
        custom_attributes { attribute_code value }
        ... on ConfigurableProduct {
          configurable_options {
            attribute_code
            label
            values {
              value_index
              label
              swatch_data { value type }
            }
          }
          variants {
            product {
              sku
              name
              price_range {
                minimum_price {
                  regular_price { value currency }
                }
              }
            }
            attributes {
              code
              value_index
              label
            }
          }
        }
        jola_3d
      }
    }
  }
`;

async function fetchFromCommerce(sku) {
  const resp = await fetch(COMMERCE_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: PRODUCT_QUERY,
      variables: { sku },
    }),
  });
  if (!resp.ok) throw new Error(`Commerce API error (${resp.status})`);
  const { data } = await resp.json();
  const item = data?.products?.items?.[0];
  if (!item) throw new Error(`Product "${sku}" not found in Commerce`);
  return item;
}

function getCustomAttr(product, code) {
  return product.custom_attributes?.find((a) => a.attribute_code === code)?.value;
}

function getOption(product, code) {
  return product.configurable_options?.find((o) => o.attribute_code === code);
}

function findVariant(product, modelIndex, textureIndex) {
  return product.variants?.find((v) => {
    const model = v.attributes.find((a) => a.code === 'jola_model');
    const texture = v.attributes.find((a) => a.code === 'jola_texture');
    return model?.value_index === modelIndex && texture?.value_index === textureIndex;
  });
}

function formatPrice(value, currency) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(value);
}

function buildPDP(block, product) {
  const basePrice = product.price_range.minimum_price.regular_price;
  const modelOption = getOption(product, 'jola_model');
  const textureOption = getOption(product, 'jola_texture');
  const defaultModel = getCustomAttr(product, 'jola_default_model') || modelOption?.values[0]?.swatch_data?.value;
  const defaultTexture = getCustomAttr(product, 'jola_default_texture') || textureOption?.values[0]?.swatch_data?.value;

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
      <p class="fv-price">${formatPrice(basePrice.value, basePrice.currency)}</p>
      <div class="fv-desc">${product.description?.html || ''}</div>
      <div class="fv-pickers"></div>
      <p class="fv-variant-sku"></p>
      <button class="fv-cta">Add to cart</button>
    </div>
  `;

  const pickersEl = root.querySelector('.fv-pickers');

  // Model picker
  if (modelOption) {
    const picker = document.createElement('div');
    picker.className = 'fv-picker';
    picker.innerHTML = `<h3>${modelOption.label}</h3><div class="fv-models"></div>`;
    const row = picker.querySelector('.fv-models');
    modelOption.values.forEach((v) => {
      const btn = document.createElement('button');
      btn.className = 'fv-model-btn';
      btn.textContent = v.label;
      btn.dataset.valueIndex = v.value_index;
      btn.dataset.jolaId = v.swatch_data?.value || '';
      btn.setAttribute('aria-pressed', btn.dataset.jolaId === defaultModel);
      row.append(btn);
    });
    pickersEl.append(picker);
  }

  // Texture picker
  if (textureOption) {
    const picker = document.createElement('div');
    picker.className = 'fv-picker';
    picker.innerHTML = `<h3>${textureOption.label}</h3><div class="fv-textures"></div><p class="fv-texture-name"></p>`;
    const row = picker.querySelector('.fv-textures');
    const nameEl = picker.querySelector('.fv-texture-name');
    textureOption.values.forEach((v) => {
      const sw = document.createElement('button');
      sw.className = 'fv-swatch';
      sw.title = v.label;
      sw.dataset.valueIndex = v.value_index;
      sw.dataset.jolaId = v.swatch_data?.value || '';
      sw.style.background = v.swatch_data?.value || '#ccc';
      const isDefault = sw.dataset.jolaId === defaultTexture;
      sw.setAttribute('aria-pressed', isDefault);
      if (isDefault) nameEl.textContent = v.label;
      row.append(sw);
    });
    pickersEl.append(picker);
  }

  block.append(root);
  return { root, defaultModel, defaultTexture };
}

export default async function decorate(block) {
  const sku = block.querySelector('div > div')?.textContent?.trim() || 'lounge-001';
  block.textContent = '';

  const product = await fetchFromCommerce(sku);
  const { root, defaultModel, defaultTexture } = buildPDP(block, product);

  // Build viewer-compatible product data from Commerce response
  const jola3d = product.jola_3d || {};
  const textureOption = getOption(product, 'jola_texture');
  const viewerProduct = {
    id: product.sku,
    defaultModel,
    textures: textureOption
      ? textureOption.values.map((v) => {
        const jolaId = v.swatch_data?.value || '';
        const mat = jola3d.textures?.[jolaId] || {};
        return {
          sku: jolaId,
          name: v.label,
          color: mat.color || v.swatch_data?.value || '#cccccc',
          roughness: mat.roughness ?? 0.8,
          metalness: mat.metalness ?? 0,
        };
      })
      : [],
  };

  await import(WIDGET_SRC);

  const viewer = await window.JolaConfigurator.create({
    el: root.querySelector('.fv-canvas'),
    productData: viewerProduct,
  });

  block.jolaViewer = viewer;

  // Track current selections for variant lookup
  let currentModelIndex = null;
  let currentTextureIndex = null;

  const modelOption = getOption(product, 'jola_model');
  if (modelOption) {
    const defaultVal = modelOption.values.find((v) => v.swatch_data?.value === defaultModel);
    if (defaultVal) currentModelIndex = defaultVal.value_index;
  }
  if (textureOption) {
    const defaultVal = textureOption.values.find((v) => v.swatch_data?.value === defaultTexture);
    if (defaultVal) currentTextureIndex = defaultVal.value_index;
  }

  function updateVariantDisplay() {
    const variant = findVariant(product, currentModelIndex, currentTextureIndex);
    const skuEl = root.querySelector('.fv-variant-sku');
    const priceEl = root.querySelector('.fv-price');
    if (variant) {
      skuEl.textContent = `SKU: ${variant.product.sku}`;
      const vp = variant.product.price_range.minimum_price.regular_price;
      priceEl.textContent = formatPrice(vp.value, vp.currency);
    } else {
      skuEl.textContent = '';
    }
  }

  // Wire model picker
  root.querySelector('.fv-models')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-jola-id]');
    if (!btn) return;
    viewer.setModel(btn.dataset.jolaId);
    currentModelIndex = Number(btn.dataset.valueIndex);
    updateVariantDisplay();
  });

  // Wire texture picker
  root.querySelector('.fv-textures')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-jola-id]');
    if (!btn) return;
    viewer.setTexture(btn.dataset.jolaId);
    currentTextureIndex = Number(btn.dataset.valueIndex);
    updateVariantDisplay();
  });

  // Sync picker UI on viewer change events
  viewer.on('change', (config) => {
    root.querySelectorAll('.fv-model-btn').forEach((btn) => {
      btn.setAttribute('aria-pressed', btn.dataset.jolaId === config.modelSku);
    });
    root.querySelectorAll('.fv-swatch').forEach((sw) => {
      sw.setAttribute('aria-pressed', sw.dataset.jolaId === config.textureSku);
    });
    const tex = textureOption?.values.find((v) => v.swatch_data?.value === config.textureSku);
    const nameEl = root.querySelector('.fv-texture-name');
    if (tex && nameEl) nameEl.textContent = tex.label;

    document.dispatchEvent(new CustomEvent('jola:change', { detail: config }));
  });

  // Toolbar
  root.querySelector('[data-action="reset"]').addEventListener('click', () => viewer.resetCamera());
  root.querySelector('[data-action="screenshot"]').addEventListener('click', () => {
    const url = viewer.screenshot();
    const a = document.createElement('a');
    a.href = url; a.download = `${product.sku}.png`; a.click();
  });
  root.querySelector('[data-action="rotate"]').addEventListener('change', (e) => {
    viewer.setAutoRotate(e.target.checked);
  });

  // Cart — dispatches event with the Commerce variant SKU
  root.querySelector('.fv-cta').addEventListener('click', () => {
    const variant = findVariant(product, currentModelIndex, currentTextureIndex);
    document.dispatchEvent(new CustomEvent('jola:add-to-cart', {
      detail: {
        parentSku: product.sku,
        variantSku: variant?.product?.sku || product.sku,
        ...viewer.getConfiguration(),
      },
    }));
  });

  updateVariantDisplay();
  document.dispatchEvent(new CustomEvent('jola:ready', { detail: viewer.getConfiguration() }));
}
