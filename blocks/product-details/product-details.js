/*
 * EDS Block: product-details
 *
 * PDP sidebar — fetches a configurable product from Adobe Commerce
 * GraphQL and renders name, price, option pickers, and add-to-cart.
 *
 * Fires standard PDP events via DOM CustomEvents:
 *   pdp/data   — product loaded
 *   pdp/values — user changed an option
 *
 * Mirrors the pattern from @dropins/storefront-pdp so the
 * furniture-viewer block (and any other listener) works unchanged
 * when swapping in the real dropin later.
 */

const COMMERCE_ENDPOINT = 'https://venia.magento.com/graphql';

const PRODUCT_QUERY = `
  query ProductBySku($sku: String!) {
    products(filter: { sku: { eq: $sku } }) {
      items {
        sku
        name
        description { html }
        price_range {
          minimum_price {
            regular_price { value currency }
          }
        }
        ... on ConfigurableProduct {
          configurable_options {
            attribute_code
            label
            values {
              value_index
              label
              swatch_data { value }
            }
          }
          variants {
            product {
              sku
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
      }
    }
  }
`;

async function fetchProduct(sku) {
  const resp = await fetch(COMMERCE_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: PRODUCT_QUERY, variables: { sku } }),
  });
  if (!resp.ok) throw new Error(`Commerce API error (${resp.status})`);
  const { data } = await resp.json();
  return data?.products?.items?.[0];
}

function findVariant(product, selections) {
  return product.variants?.find((v) => v.attributes.every(
    (a) => selections[a.code] === a.value_index,
  ));
}

function formatPrice(value, currency) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(value);
}

function emit(name, detail) {
  document.dispatchEvent(new CustomEvent(name, { detail }));
}

export default async function decorate(block) {
  const sku = block.querySelector('div > div')?.textContent?.trim();
  if (!sku) return;
  block.textContent = '';

  const product = await fetchProduct(sku);
  if (!product) {
    block.textContent = 'Product not found.';
    return;
  }

  const basePrice = product.price_range.minimum_price.regular_price;
  const selections = {};

  block.innerHTML = `
    <h1 class="pd-name">${product.name}</h1>
    <p class="pd-price">${formatPrice(basePrice.value, basePrice.currency)}</p>
    <div class="pd-desc">${product.description?.html || ''}</div>
    <div class="pd-options"></div>
    <p class="pd-sku">SKU: ${product.sku}</p>
    <button class="pd-cta">Add to cart</button>
  `;

  const optionsEl = block.querySelector('.pd-options');

  (product.configurable_options || []).forEach((opt) => {
    const isColor = opt.attribute_code.includes('color');

    const section = document.createElement('div');
    section.className = 'pd-option';
    section.innerHTML = `<h3>${opt.label}</h3><div class="pd-option-values ${isColor ? 'pd-swatches' : 'pd-pills'}"></div>${isColor ? '<p class="pd-option-name"></p>' : ''}`;

    const row = section.querySelector('.pd-option-values');
    const nameEl = section.querySelector('.pd-option-name');

    opt.values.forEach((v, i) => {
      const btn = document.createElement('button');
      const swatchValue = v.swatch_data?.value || '';

      if (isColor) {
        btn.className = 'pd-swatch';
        btn.style.background = swatchValue;
        btn.title = v.label;
      } else {
        btn.className = 'pd-pill';
        btn.textContent = v.label;
      }

      btn.dataset.valueIndex = v.value_index;
      btn.dataset.attrCode = opt.attribute_code;
      btn.dataset.swatchValue = swatchValue;
      btn.dataset.label = v.label;

      // Default to first value
      if (i === 0) {
        btn.setAttribute('aria-pressed', 'true');
        selections[opt.attribute_code] = v.value_index;
        if (nameEl) nameEl.textContent = v.label;
      } else {
        btn.setAttribute('aria-pressed', 'false');
      }

      btn.addEventListener('click', () => {
        row.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', 'false'));
        btn.setAttribute('aria-pressed', 'true');
        if (nameEl) nameEl.textContent = v.label;

        selections[opt.attribute_code] = v.value_index;

        const variant = findVariant(product, selections);
        if (variant) {
          const vp = variant.product.price_range.minimum_price.regular_price;
          block.querySelector('.pd-price').textContent = formatPrice(vp.value, vp.currency);
          block.querySelector('.pd-sku').textContent = `SKU: ${variant.product.sku}`;
        }

        emit('pdp/values', {
          parentSku: product.sku,
          variantSku: variant?.product?.sku || product.sku,
          attribute: opt.attribute_code,
          label: v.label,
          swatchValue,
          valueIndex: v.value_index,
          selections: { ...selections },
        });
      });

      row.append(btn);
    });

    optionsEl.append(section);
  });

  block.querySelector('.pd-cta').addEventListener('click', () => {
    const variant = findVariant(product, selections);
    emit('jola:add-to-cart', {
      parentSku: product.sku,
      variantSku: variant?.product?.sku || product.sku,
      selections,
    });
  });

  // Show initial variant
  const initial = findVariant(product, selections);
  if (initial) {
    block.querySelector('.pd-sku').textContent = `SKU: ${initial.product.sku}`;
  }

  // Fire pdp/data so the viewer block can initialize
  emit('pdp/data', { product, selections: { ...selections } });
}
