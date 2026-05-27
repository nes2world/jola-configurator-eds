/*
 * EDS Block: furniture-viewer
 *
 * Thin adapter — loads the Jola headless configurator and mounts the
 * 3D canvas. The block dispatches custom events so the client's page
 * can wire their own pickers, cart, and product info to the viewer.
 *
 * The viewer instance is stored on the block element so page-level
 * scripts can access it: block.jolaViewer
 */

// Production: 'https://cdn.jola.com/configurator/v1/jola-configurator.js'
const WIDGET_SRC = `${window.hlx.codeBasePath}/widget/jola-configurator.js`;
const API_KEY = 'demo-key-001';

export default async function decorate(block) {
  const sku = block.querySelector('div > div')?.textContent?.trim() || 'lounge-001';
  block.textContent = '';

  await import(WIDGET_SRC);

  const viewer = await window.JolaConfigurator.create({
    el: block,
    apiKey: API_KEY,
    product: sku,
  });

  block.jolaViewer = viewer;

  viewer.on('ready', (config) => {
    document.dispatchEvent(new CustomEvent('jola:ready', { detail: config }));
  });

  viewer.on('change', (config) => {
    document.dispatchEvent(new CustomEvent('jola:change', { detail: config }));
  });

  viewer.on('error', (err) => {
    document.dispatchEvent(new CustomEvent('jola:error', { detail: err }));
  });
}
