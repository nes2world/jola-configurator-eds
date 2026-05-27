/*
 * EDS Block: furniture-viewer
 *
 * Headless 3D viewer — renders ONLY the canvas.
 * Listens to pdp/data and pdp/values events from the product-details
 * sidebar to update the 3D scene when the user selects options.
 *
 * Mapping from Commerce to 3D:
 *   fashion_color swatch hex → material color on the 3D model
 *   fashion_size             → ignored (no 3D impact)
 *
 * When custom attributes exist (jola_model, jola_texture), those
 * take precedence. Otherwise falls back to fashion_color.
 */

const WIDGET_SRC = `${window.hlx.codeBasePath}/widget/jola-configurator.js`;

function buildViewerData(product) {
  const colorOpt = product.configurable_options?.find(
    (o) => o.attribute_code.includes('color'),
  );

  return {
    id: product.sku,
    defaultModel: 'chair',
    textures: colorOpt
      ? colorOpt.values.map((v) => ({
        sku: v.swatch_data?.value || v.label,
        name: v.label,
        color: v.swatch_data?.value || '#cccccc',
        roughness: 0.85,
        metalness: 0,
      }))
      : [],
  };
}

export default async function decorate(block) {
  block.textContent = '';

  const canvas = document.createElement('div');
  canvas.className = 'fv-canvas';
  block.append(canvas);

  await import(WIDGET_SRC);

  let viewer = null;

  document.addEventListener('pdp/data', async (e) => {
    const { product } = e.detail;
    if (!product) return;

    if (viewer) viewer.destroy();

    const viewerData = buildViewerData(product);

    viewer = await window.JolaConfigurator.create({
      el: canvas,
      productData: viewerData,
    });

    block.jolaViewer = viewer;

    // Set first color as default texture
    if (viewerData.textures[0]) {
      viewer.setTexture(viewerData.textures[0].sku);
    }
  });

  document.addEventListener('pdp/values', (e) => {
    if (!viewer) return;
    const { attribute, swatchValue } = e.detail;

    // Map color option changes to 3D texture
    if (attribute.includes('color') && swatchValue) {
      viewer.setTexture(swatchValue);
    }
  });
}
