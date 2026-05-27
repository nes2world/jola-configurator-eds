/*
 * Jola 3D Configurator — Headless Widget
 * https://cdn.jola.com/configurator/v1/jola-configurator.js
 *
 * Headless 3D viewer. No product UI — clients build their own PDP and
 * drive the viewer through the command API. Every state change fires a
 * `change` event carrying the active SKUs so the host page can update
 * price, cart, or anything else.
 *
 * Usage:
 *   const viewer = await JolaConfigurator.create({
 *     el: '#viewer',
 *     apiKey: 'your-key',
 *     product: 'lounge-001',
 *   });
 *
 *   viewer.setModel('armchair');
 *   viewer.setTexture('velvet-emerald');
 *   viewer.playAnimation('recline');
 *   viewer.enable('armrests');
 *   viewer.disable('headrest');
 *
 *   viewer.on('change', ({ productSku, modelSku, textureSku, features }) => {
 *     updatePrice(productSku, textureSku);
 *   });
 *
 *   viewer.on('ready', (config) => { ... });
 *   viewer.on('error', (err) => { ... });
 *
 *   viewer.getConfiguration();  // { productSku, modelSku, textureSku, features }
 *   viewer.screenshot();        // data URL (PNG)
 *   viewer.destroy();
 */

const THREE_CDN = 'https://esm.sh/three@0.160.0';
const THREE = await import(THREE_CDN);
const { OrbitControls } = await import(`${THREE_CDN}/examples/jsm/controls/OrbitControls.js`);

const API_BASE = window.JOLA_API_BASE || '';

async function fetchProduct(apiKey, sku) {
  const resp = await fetch(
    `${API_BASE}/api/v1/products/${encodeURIComponent(sku)}?key=${encodeURIComponent(apiKey)}`,
  );
  if (!resp.ok) throw new Error(`JolaConfigurator: product "${sku}" not found (${resp.status})`);
  return resp.json();
}

// --- Parametric furniture (placeholder until real GLBs) ---

function buildChair(mat) {
  const g = new THREE.Group();
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.14, 0.92), mat);
  seat.position.y = 0.55;
  const back = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.95, 0.12), mat);
  back.position.set(0, 1.05, -0.4);
  g.add(seat, back);
  addLegs(g, [[-0.4, -0.4], [0.4, -0.4], [-0.4, 0.4], [0.4, 0.4]], 0.5);
  return g;
}

function buildArmchair(mat) {
  const g = buildChair(mat);
  const geo = new THREE.BoxGeometry(0.12, 0.42, 0.92);
  const l = new THREE.Mesh(geo, mat); l.position.set(-0.52, 0.78, 0);
  const r = l.clone(); r.position.x = 0.52;
  g.add(l, r);
  return g;
}

function buildSofa(mat) {
  const g = new THREE.Group();
  const base = new THREE.Mesh(new THREE.BoxGeometry(1.92, 0.2, 0.96), mat);
  base.position.y = 0.55;
  const bk = new THREE.Mesh(new THREE.BoxGeometry(1.92, 0.72, 0.18), mat);
  bk.position.set(0, 0.98, -0.39);
  g.add(base, bk);
  for (let i = -1; i <= 1; i += 1) {
    const c = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.18, 0.84), mat);
    c.position.set(i * 0.62, 0.74, 0.02);
    g.add(c);
  }
  const armGeo = new THREE.BoxGeometry(0.18, 0.58, 0.96);
  const al = new THREE.Mesh(armGeo, mat); al.position.set(-1.05, 0.84, 0);
  const ar = al.clone(); ar.position.x = 1.05;
  g.add(al, ar);
  addLegs(g, [[-0.88, -0.42], [0.88, -0.42], [-0.88, 0.42], [0.88, 0.42]], 0.46);
  return g;
}

function addLegs(group, positions, height) {
  const legMat = new THREE.MeshStandardMaterial({ color: 0x4a2e1e, roughness: 0.7, metalness: 0.05 });
  const geo = new THREE.CylinderGeometry(0.045, 0.045, height);
  positions.forEach(([x, z]) => {
    const leg = new THREE.Mesh(geo, legMat);
    leg.position.set(x, height / 2, z);
    leg.castShadow = true;
    group.add(leg);
  });
}

const MODELS = { chair: buildChair, armchair: buildArmchair, sofa: buildSofa };

// --- Minimal shadow DOM styles (canvas only) ---

const STYLES = `
  :host { display: block; width: 100%; height: 100%; }
  .jola-viewer {
    width: 100%; height: 100%;
    border-radius: 10px;
    overflow: hidden;
    background: #f4f1ec;
  }
  .jola-viewer canvas { display: block; width: 100%; height: 100%; touch-action: none; }
`;

// --- Event emitter mixin ---

const EmitterMixin = {
  on(event, fn) {
    (this._listeners[event] ??= []).push(fn);
    return this;
  },
  off(event, fn) {
    const list = this._listeners[event];
    if (list) this._listeners[event] = list.filter((f) => f !== fn);
    return this;
  },
  _emit(event, data) {
    (this._listeners[event] || []).forEach((fn) => {
      try { fn(data); } catch (e) { console.error(`JolaConfigurator [${event}]:`, e); }
    });
  },
};

// --- Headless configurator ---

class Configurator {
  constructor(hostEl, product, options) {
    this._listeners = {};
    Object.assign(this, EmitterMixin);

    this._product = product;
    this._options = options;
    this._features = new Set();
    this._config = {
      productSku: product.id,
      modelSku: null,
      textureSku: null,
      features: [],
    };

    this._root = document.createElement('div');
    hostEl.appendChild(this._root);
    this._shadow = this._root.attachShadow({ mode: 'open' });
    this._shadow.innerHTML = `<style>${STYLES}</style>`;

    this._buildViewer();
    this._initScene();

    this._selectModel(product.defaultModel);
    if (product.textures?.[0]) this._selectTexture(product.textures[0].sku);

    this._loop();
    this._emit('ready', this.getConfiguration());
  }

  // ===== PUBLIC API =====

  setProduct(sku) {
    return fetchProduct(this._options.apiKey || '', sku).then((product) => {
      this._product = product;
      this._config.productSku = product.id;
      this._selectModel(product.defaultModel);
      if (product.textures?.[0]) this._selectTexture(product.textures[0].sku);
      this._emitChange();
    }).catch((err) => this._emit('error', err));
  }

  setModel(sku) {
    this._selectModel(sku);
  }

  setTexture(sku) {
    this._selectTexture(sku);
  }

  playAnimation(name) {
    // Placeholder — will drive real animations once GLBs with clips are loaded
    this._emit('animation', { name, status: 'not_implemented' });
  }

  enable(feature) {
    this._features.add(feature);
    this._config.features = [...this._features];
    this._emitChange();
  }

  disable(feature) {
    this._features.delete(feature);
    this._config.features = [...this._features];
    this._emitChange();
  }

  getConfiguration() {
    return { ...this._config, features: [...this._features] };
  }

  screenshot() {
    this._renderer.render(this._scene, this._camera);
    return this._renderer.domElement.toDataURL('image/png');
  }

  destroy() {
    cancelAnimationFrame(this._raf);
    this._resizeObserver?.disconnect();
    this._renderer?.dispose();
    this._root.remove();
  }

  // ===== Viewer controls (convenience for host pages) =====

  resetCamera() { this._controls?.reset(); }
  setAutoRotate(on) { this._controls.autoRotate = !!on; }

  // ===== PRIVATE =====

  _emitChange() {
    this._emit('change', this.getConfiguration());
  }

  _selectModel(modelId) {
    const builder = MODELS[modelId];
    if (!builder) return;

    if (this._currentGroup) {
      this._scene.remove(this._currentGroup);
      this._currentGroup.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
    }
    const group = builder(this._material);
    group.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    this._scene.add(group);
    this._currentGroup = group;
    this._config.modelSku = modelId;
    this._emitChange();
  }

  _selectTexture(sku) {
    const texture = this._product.textures?.find((t) => t.sku === sku);
    if (!texture) return;

    this._material.color.set(texture.color);
    this._material.roughness = texture.roughness;
    this._material.metalness = texture.metalness;
    this._config.textureSku = texture.sku;
    this._emitChange();
  }

  _buildViewer() {
    const viewerEl = document.createElement('div');
    viewerEl.className = 'jola-viewer';
    this._viewerEl = viewerEl;
    this._shadow.appendChild(viewerEl);
  }

  _initScene() {
    const container = this._viewerEl;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf4f1ec);

    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
    camera.position.set(3.4, 2.1, 3.8);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    container.appendChild(renderer.domElement);

    scene.add(new THREE.HemisphereLight(0xffffff, 0xb8a888, 0.55));
    const key = new THREE.DirectionalLight(0xffffff, 1.9);
    key.position.set(4, 6, 3);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.left = -4; key.shadow.camera.right = 4;
    key.shadow.camera.top = 4; key.shadow.camera.bottom = -4;
    key.shadow.bias = -0.0005;
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xffffff, 0.4);
    fill.position.set(-3, 2, -2);
    scene.add(fill);

    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(6, 64),
      new THREE.ShadowMaterial({ opacity: 0.22 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0.6, 0);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 2;
    controls.maxDistance = 8;
    controls.maxPolarAngle = Math.PI / 2 - 0.05;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.9;

    this._scene = scene;
    this._camera = camera;
    this._renderer = renderer;
    this._controls = controls;
    this._material = new THREE.MeshStandardMaterial({ color: 0xd8c9a8, roughness: 0.9, metalness: 0 });

    const resize = () => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    this._resizeObserver = new ResizeObserver(resize);
    this._resizeObserver.observe(container);
  }

  _loop() {
    this._raf = requestAnimationFrame(() => this._loop());
    this._controls.update();
    this._renderer.render(this._scene, this._camera);
  }
}

// --- Public namespace ---

window.JolaConfigurator = {
  version: '2.0.0',

  async create(options = {}) {
    const el = typeof options.el === 'string'
      ? document.querySelector(options.el)
      : options.el;
    if (!el) throw new Error('JolaConfigurator: target element not found');
    if (!options.product) throw new Error('JolaConfigurator: product SKU is required');

    const product = await fetchProduct(options.apiKey || '', options.product);
    return new Configurator(el, product, options);
  },
};
