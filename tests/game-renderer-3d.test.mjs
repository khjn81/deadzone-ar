import assert from 'node:assert/strict';
import test from 'node:test';

import { createRenderer } from '../public/game/src/renderer.mjs';
import { createThreeWorldLayer } from '../public/game/src/three-world-layer.mjs';
import { THREE as bundledThree, cloneSkeleton } from '../public/game/src/vendor/three-runtime.mjs';

function deferred() {
  let reject;
  let resolve;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function flushPromises() {
  return new Promise((resolve) => setImmediate(resolve));
}

function createContext() {
  const calls = { ellipse: 0, fill: 0, lineTo: 0, moveTo: 0 };
  const gradient = { addColorStop() {} };
  const context = new Proxy({
    canvas: null,
    createLinearGradient() { return gradient; },
    createRadialGradient() { return gradient; },
    ellipse() { calls.ellipse += 1; },
    fill() { calls.fill += 1; },
    lineTo() { calls.lineTo += 1; },
    moveTo() { calls.moveTo += 1; }
  }, {
    get(target, property) {
      if (property in target) return target[property];
      return () => {};
    },
    set(target, property, value) {
      target[property] = value;
      return true;
    }
  });
  return { calls, context };
}

function createCanvas() {
  const { calls, context } = createContext();
  const canvas = {
    clientHeight: 844,
    clientWidth: 390,
    getContext(kind) { return kind === '2d' ? context : null; }
  };
  context.canvas = canvas;
  return { calls, canvas };
}

function createGlobalObject({ devicePixelRatio = 2 } = {}) {
  const listeners = new Map();
  const removedListeners = [];
  return {
    addEventListener(type, handler) { listeners.set(type, handler); },
    devicePixelRatio,
    listeners,
    matchMedia() { return { matches: false }; },
    removedListeners,
    removeEventListener(type, handler) {
      removedListeners.push({ handler, type });
      if (listeners.get(type) === handler) listeners.delete(type);
    }
  };
}

function fixtureState() {
  return {
    enemies: [
      { id: 'visible', type: 'infected', size: 1, distance: 0.4, yaw: 0, pitch: 0, phase: 0, hitFlash: 0 },
      { id: 'offscreen', type: 'runner', size: 1, distance: 0.8, yaw: 90, pitch: 0, phase: 1, hitFlash: 0 }
    ],
    shield: 100,
    weapon: { recoil: 0 }
  };
}

const cameraView = Object.freeze({
  yaw: 0,
  pitch: 0,
  sensorFresh: true,
  cameraActive: true,
  horizontalFov: 60,
  verticalFov: 48
});

function sixLiveInsectStates() {
  return Array.from({ length: 6 }, (_, index) => ({
    id: index + 1,
    type: index === 5 ? 'bulwark' : 'stinger',
    elite: index === 5,
    yaw: index * 4 - 10,
    pitch: index - 2,
    distance: 0.4 + index * 0.05,
    size: 1,
    phase: index,
    bank: 0,
    hitFlash: 0
  }));
}

function fourCorpseStates() {
  return Array.from({ length: 4 }, (_, index) => ({
    id: index + 20,
    enemyId: index + 40,
    type: 'stinger',
    elite: false,
    yaw: index * 3 - 4,
    pitch: -2,
    distance: 0.7,
    size: 1,
    phase: index,
    age: 2,
    lifetime: 8,
    seed: index + 1
  }));
}

function maxStateWithCorpses() {
  return {
    phase: 'playing',
    shield: 100,
    enemies: sixLiveInsectStates(),
    corpses: fourCorpseStates(),
    weapon: { recoil: 0 }
  };
}

async function createRendererFixture() {
  const { canvas } = createCanvas();
  const layer = {
    lastFrame: null,
    resize() {},
    render(frame) {
      this.lastFrame = frame;
      return true;
    },
    getDiagnostics() { return {}; },
    destroy() {}
  };
  const renderer = createRenderer(canvas, {
    globalObject: createGlobalObject(),
    worldCanvas: { clientWidth: 390, clientHeight: 844 },
    worldLayerFactory: async () => layer
  });
  await flushPromises();
  return { layer, renderer };
}

async function createNonThrowingShaderFailureLayer(canvas) {
  const webglRenderers = [];

  class WebGLRenderer {
    constructor() {
      this.debug = { checkShaderErrors: true, onShaderError: null };
      this.renderLists = { dispose() {} };
      this.shadowMap = {};
      webglRenderers.push(this);
    }

    setClearColor() {}
    setPixelRatio() {}
    setSize() {}

    render() {
      this.debug.onShaderError?.({}, {}, {}, {});
    }

    dispose() {
      this.disposed = true;
    }

    forceContextLoss() {}
  }

  const THREE = { ...bundledThree, WebGLRenderer };
  const geometry = new THREE.BoxGeometry(2, 4, 1);
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.y = 2;
  const hips = new THREE.Group();
  hips.name = 'Hips';
  hips.add(mesh);
  const source = new THREE.Group();
  source.add(hips);
  const clip = new THREE.AnimationClip('Walk', 1, [
    new THREE.VectorKeyframeTrack('Hips.position', [0, 1], [0, 0, 0, 0, 0, 0])
  ]);

  class GLTFLoader {
    async loadAsync() {
      return { scene: source, animations: [clip] };
    }
  }

  const layer = await createThreeWorldLayer(canvas, {
    runtime: { THREE, GLTFLoader, cloneSkeleton }
  });
  return { layer, webglRenderer: webglRenderers[0] };
}

const view = { yaw: 0, pitch: 0 };

test('forwards live insects, corpses, and bounded effects to one world frame', async () => {
  const fixture = await createRendererFixture();
  fixture.renderer.present({ id: 1, type: 'shoot', yaw: 0, pitch: 0, effectSeed: 1 });
  fixture.renderer.present({ id: 1, type: 'shoot', yaw: 0, pitch: 0, effectSeed: 1 });
  fixture.renderer.present({ id: 2, type: 'miss', yaw: 0, pitch: 0, effectSeed: 2 });

  fixture.renderer.render(maxStateWithCorpses(), cameraView, 1000);

  assert.deepEqual(fixture.layer.lastFrame.insects.map(({ id }) => id), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(fixture.layer.lastFrame.corpses.map(({ id }) => id), [20, 21, 22, 23]);
  assert.equal(fixture.layer.lastFrame.effects.casings.length, 1);
  assert.equal(fixture.layer.lastFrame.effects.impacts.length, 1);
  fixture.renderer.destroy();
});

test('draws the bounded critical-hit Canvas fallback without accepting the legacy headshot preset', () => {
  const { canvas } = createCanvas();
  const renderer = createRenderer(canvas, { globalObject: createGlobalObject() });
  const emptyState = { corpses: [], enemies: [], shield: 100, weapon: { recoil: 0 } };

  renderer.burst('critical-hit', { x: 120, y: 240 });
  assert.equal(renderer.render(emptyState, cameraView, 100).particleCount, 18);

  for (let index = 0; index < 6; index += 1) {
    renderer.burst('critical-hit', { x: 120, y: 240 });
  }
  assert.equal(renderer.render(emptyState, cameraView, 116).particleCount, 110, 'the shared fallback pool stays capped');
  renderer.destroy();

  const legacyFixture = createCanvas();
  const legacyRenderer = createRenderer(legacyFixture.canvas, { globalObject: createGlobalObject() });
  legacyRenderer.burst('headshot', { x: 120, y: 240 });
  assert.equal(legacyRenderer.render(emptyState, cameraView, 100).particleCount, 0);
  legacyRenderer.destroy();
});

test('draws bounded rail and cryo fallback bursts', () => {
  const { canvas } = createCanvas();
  const renderer = createRenderer(canvas, { globalObject: createGlobalObject() });
  const emptyState = { corpses: [], enemies: [], shield: 100, weapon: { recoil: 0 } };

  renderer.burst('rail', { x: 120, y: 240 });
  assert.equal(renderer.render(emptyState, cameraView, 100).particleCount, 12);
  renderer.burst('freeze', { x: 120, y: 240 });
  assert.equal(renderer.render(emptyState, cameraView, 116).particleCount, 24);
  renderer.destroy();
});

test('reprojects a camera-direction impact to the same point after turning away and back', async () => {
  const fixture = await createRendererFixture();
  fixture.renderer.present({ id: 9, type: 'miss', yaw: 12, pitch: -3, effectSeed: 2 });

  fixture.renderer.render(maxStateWithCorpses(), cameraView, 1000);
  const initial = fixture.layer.lastFrame.effects.impacts[0];
  fixture.renderer.render(maxStateWithCorpses(), { ...cameraView, yaw: 90 }, 1100);
  const turnedAway = fixture.layer.lastFrame.effects.impacts[0];
  fixture.renderer.render(maxStateWithCorpses(), cameraView, 1200);
  const returned = fixture.layer.lastFrame.effects.impacts[0];

  assert.equal(initial.visible, true);
  assert.equal(turnedAway.visible, false);
  assert.deepEqual(
    { x: returned.x, y: returned.y, scale: returned.scale, visible: returned.visible },
    { x: initial.x, y: initial.y, scale: initial.scale, visible: initial.visible }
  );
  assert.ok(Math.abs(returned.age - 0.2) < 1e-9, 'effect age uses deterministic render-time elapsed seconds');
  fixture.renderer.destroy();
});

test('camera-direction impact fragments hide while turned away and return to their anchored impulse', async () => {
  const fixture = await createRendererFixture();
  fixture.renderer.present({ id: 19, type: 'miss', yaw: 12, pitch: -3, effectSeed: 8 });

  fixture.renderer.render(maxStateWithCorpses(), cameraView, 1000);
  const initialImpact = { ...fixture.layer.lastFrame.effects.impacts[0] };
  const initialFragment = { ...fixture.layer.lastFrame.effects.fragments[0] };
  fixture.renderer.render(maxStateWithCorpses(), { ...cameraView, yaw: 90 }, 1000);
  const awayImpact = { ...fixture.layer.lastFrame.effects.impacts[0] };
  const awayFragment = { ...fixture.layer.lastFrame.effects.fragments[0] };
  fixture.renderer.render(maxStateWithCorpses(), cameraView, 1000);
  const returnedImpact = fixture.layer.lastFrame.effects.impacts[0];
  const returnedFragment = fixture.layer.lastFrame.effects.fragments[0];

  assert.equal(initialImpact.visible, true);
  assert.equal(initialFragment.visible, true);
  assert.equal(awayImpact.visible, false);
  assert.equal(awayFragment.visible, false);
  assert.deepEqual(
    { x: returnedImpact.x, y: returnedImpact.y },
    { x: initialImpact.x, y: initialImpact.y }
  );
  assert.deepEqual(
    { x: returnedFragment.x, y: returnedFragment.y },
    { x: initialFragment.x, y: initialFragment.y }
  );
  fixture.renderer.destroy();
});

test('a rejected world layer draws flying insects and corpses procedurally in the same frame', async () => {
  const pending = deferred();
  const { calls, canvas } = createCanvas();
  const renderer = createRenderer(canvas, {
    globalObject: createGlobalObject(),
    worldCanvas: {},
    worldLayerFactory: () => pending.promise
  });
  pending.reject(new Error('WebGL unavailable'));
  await flushPromises();

  const start = { ...calls };
  renderer.render({ enemies: [], corpses: [], shield: 100, weapon: { recoil: 0 } }, cameraView, 1000);
  const baseline = Object.fromEntries(Object.keys(calls).map((key) => [key, calls[key] - start[key]]));
  const before = { ...calls };
  renderer.render({
    enemies: [sixLiveInsectStates()[2]],
    corpses: [fourCorpseStates()[1]],
    shield: 100,
    weapon: { recoil: 0 }
  }, cameraView, 1016);

  assert.ok(calls.ellipse - before.ellipse - baseline.ellipse >= 8, 'fallback draws insect wing and body ellipses');
  assert.ok(calls.lineTo - before.lineTo - baseline.lineTo >= 12, 'fallback draws six legs per insect or corpse');
  assert.ok(calls.fill - before.fill - baseline.fill >= 6, 'fallback fills airborne insect anatomy');
  renderer.destroy();
});

test('destroy clears combat effects and aborts the active world layer exactly once', async () => {
  const { canvas } = createCanvas();
  let clearCount = 0;
  let destroyCount = 0;
  let factorySignal;
  const renderer = createRenderer(canvas, {
    combatEffectsFactory: () => ({
      clear() { clearCount += 1; },
      present() {},
      snapshot() { return { casings: [], impacts: [], fragments: [], fluids: [] }; },
      update() {}
    }),
    globalObject: createGlobalObject(),
    worldCanvas: {},
    worldLayerFactory: async (_target, { signal } = {}) => {
      factorySignal = signal;
      return {
        destroy() { destroyCount += 1; },
        getDiagnostics() { return {}; },
        render() { return true; },
        resize() {}
      };
    }
  });
  await flushPromises();

  renderer.destroy();
  renderer.destroy();

  assert.equal(clearCount, 1);
  assert.equal(factorySignal?.aborted, true);
  assert.equal(destroyCount, 1);
});

test('caps the live-camera canvas at 1.5 DPR while retaining 2 DPR outside camera gameplay', () => {
  const { canvas } = createCanvas();
  const renderer = createRenderer(canvas, {
    globalObject: createGlobalObject({ devicePixelRatio: 3 })
  });

  renderer.render(fixtureState(), { ...view, cameraActive: true }, 100);

  assert.equal(canvas.width, 585);
  assert.equal(canvas.height, 1266);

  renderer.render(fixtureState(), { ...view, cameraActive: false }, 116);

  assert.equal(canvas.width, 780);
  assert.equal(canvas.height, 1688);
  renderer.destroy();
});

test('keeps public no-argument resize compatible with the default non-camera budget', () => {
  const { canvas } = createCanvas();
  const renderer = createRenderer(canvas, {
    globalObject: createGlobalObject({ devicePixelRatio: 3 })
  });

  renderer.render(fixtureState(), { ...view, cameraActive: true }, 100);
  assert.equal(canvas.width, 585);
  assert.equal(canvas.height, 1266);

  renderer.resize();
  assert.equal(canvas.width, 780);
  assert.equal(canvas.height, 1688);
  renderer.destroy();
});

test('keeps the last rendered camera budget across resize events and removes the registered wrapper', () => {
  const { canvas } = createCanvas();
  const globalObject = createGlobalObject({ devicePixelRatio: 3 });
  const renderer = createRenderer(canvas, { globalObject });
  const resizeListener = globalObject.listeners.get('resize');

  renderer.render(fixtureState(), { ...view, cameraActive: true }, 100);
  resizeListener({ cameraActive: false, type: 'resize' });

  assert.equal(canvas.width, 585);
  assert.equal(canvas.height, 1266);

  renderer.destroy();
  assert.equal(globalObject.listeners.has('resize'), false);
  assert.equal(globalObject.removedListeners.at(-1).handler, resizeListener);
});

test('keeps an explicit camera resize budget across an event before the first gameplay render', () => {
  const { canvas } = createCanvas();
  const globalObject = createGlobalObject({ devicePixelRatio: 3 });
  const renderer = createRenderer(canvas, { globalObject });

  renderer.resize({ cameraActive: true });
  globalObject.listeners.get('resize')({ cameraActive: false, type: 'resize' });

  assert.equal(canvas.width, 585);
  assert.equal(canvas.height, 1266);
  renderer.destroy();
});

test('resizes 2D and Three layers once per camera or device-DPR transition, then remains stable', async () => {
  const { canvas } = createCanvas();
  const globalObject = createGlobalObject({ devicePixelRatio: 3 });
  const layerResizes = [];
  const renderer = createRenderer(canvas, {
    worldLayerFactory: async () => ({
      destroy() {},
      render() { return true; },
      resize(...values) { layerResizes.push(values); }
    }),
    globalObject,
    worldCanvas: { clientHeight: 844, clientWidth: 390 }
  });
  await flushPromises();

  renderer.render(fixtureState(), { ...view, cameraActive: true }, 100);
  renderer.render(fixtureState(), { ...view, cameraActive: true }, 116);
  globalObject.listeners.get('resize')({ type: 'resize' });
  assert.deepEqual(layerResizes, [
    [390, 844, 2],
    [390, 844, 1.5]
  ]);

  globalObject.devicePixelRatio = 1.25;
  globalObject.listeners.get('resize')({ type: 'resize' });
  globalObject.listeners.get('resize')({ type: 'resize' });
  assert.deepEqual(layerResizes.at(-1), [390, 844, 1.25]);
  assert.equal(layerResizes.length, 3);

  renderer.render(fixtureState(), { ...view, cameraActive: false }, 132);
  assert.equal(layerResizes.length, 3, 'the non-camera mode is remembered even when its DPR is unchanged');
  globalObject.devicePixelRatio = 3;
  globalObject.listeners.get('resize')({ type: 'resize' });
  assert.deepEqual(layerResizes.at(-1), [390, 844, 2]);

  renderer.render(fixtureState(), { ...view, cameraActive: true }, 148);
  renderer.render(fixtureState(), { ...view, cameraActive: true }, 164);
  renderer.render(fixtureState(), { ...view, cameraActive: false }, 180);
  renderer.render(fixtureState(), { ...view, cameraActive: false }, 196);
  assert.deepEqual(layerResizes.slice(-3), [
    [390, 844, 2],
    [390, 844, 1.5],
    [390, 844, 2]
  ]);
  assert.equal(layerResizes.length, 6);
  assert.equal(canvas.width, 780);
  assert.equal(canvas.height, 1688);
  renderer.destroy();
});

test('keeps procedural enemy bodies while the 3D enemy layer is loading', () => {
  const pending = deferred();
  const { calls, canvas } = createCanvas();
  const renderer = createRenderer(canvas, {
    worldLayerFactory: () => pending.promise,
    globalObject: createGlobalObject(),
    worldCanvas: {}
  });

  const result = renderer.render(fixtureState(), view, 100);

  assert.equal(result.enemyRenderMode, 'loading');
  assert.ok(calls.ellipse > 0, 'the visible procedural enemy body is drawn while 3D is unconfirmed');
  renderer.destroy();
});

test('confirms a 3D frame before suppressing procedural bodies while retaining lock and threat results', async () => {
  const layerReady = deferred();
  const { calls, canvas } = createCanvas();
  const frames = [];
  const resizes = [];
  const renderer = createRenderer(canvas, {
    worldLayerFactory: () => layerReady.promise,
    globalObject: createGlobalObject(),
    worldCanvas: { clientHeight: 844, clientWidth: 390 }
  });
  const state = fixtureState();
  const loading = renderer.render(state, view, 100);

  layerReady.resolve({
    destroy() {},
    render(frame, timestamp) {
      frames.push({ frame, timestamp });
      return true;
    },
    resize(...values) { resizes.push(values); }
  });
  await flushPromises();
  const ready = renderer.render(state, view, 116);

  assert.equal(loading.lockedEnemyId, ready.lockedEnemyId);
  assert.deepEqual(loading.threats, ready.threats);
  assert.deepEqual(loading.visibleEnemyIds, ready.visibleEnemyIds);
  assert.equal(ready.enemyRenderMode, 'ready');
  assert.ok(calls.ellipse >= 4, 'the loading frame drew the visible procedural insect');
  assert.deepEqual(resizes, [[390, 844, 2]]);
  assert.equal(frames.length, 1);
  assert.deepEqual(frames[0].frame.insects.map((descriptor) => ({ id: descriptor.id, visible: descriptor.visible })), [
    { id: 'visible', visible: true },
    { id: 'offscreen', visible: false }
  ]);
  renderer.destroy();
});

test('resizes a deferred Three layer once with the latest camera viewport and DPR', async () => {
  const layerReady = deferred();
  const { canvas } = createCanvas();
  const globalObject = createGlobalObject({ devicePixelRatio: 3 });
  const resizes = [];
  const renderer = createRenderer(canvas, {
    worldLayerFactory: () => layerReady.promise,
    globalObject,
    worldCanvas: {}
  });

  renderer.resize({ cameraActive: true });
  canvas.clientWidth = 360;
  canvas.clientHeight = 780;
  globalObject.devicePixelRatio = 1.25;
  globalObject.listeners.get('resize')({ type: 'resize' });
  layerReady.resolve({
    destroy() {},
    render() { return true; },
    resize(...values) { resizes.push(values); }
  });
  await flushPromises();

  assert.deepEqual(resizes, [[360, 780, 1.25]]);
  renderer.render(fixtureState(), { ...view, cameraActive: true }, 100);
  assert.deepEqual(resizes, [[360, 780, 1.25]]);
  renderer.destroy();
});

test('suppresses procedural bodies only after forwarding all six active enemies to 3D', async () => {
  const { calls, canvas } = createCanvas();
  const frames = [];
  const renderer = createRenderer(canvas, {
    worldLayerFactory: async () => ({
      destroy() {},
      render(frame) {
        frames.push(frame);
        return true;
      },
      resize() {}
    }),
    globalObject: createGlobalObject(),
    worldCanvas: {}
  });
  const state = {
    enemies: [1, 2, 3, 4, 5, 6].map((id) => ({
      id,
      type: 'infected',
      size: 1,
      distance: id / 10,
      yaw: 0,
      pitch: 0,
      phase: 0,
      hitFlash: 0
    })),
    shield: 100,
    weapon: { recoil: 0 }
  };

  await flushPromises();
  const result = renderer.render(state, view, 100);

  assert.equal(result.enemyRenderMode, 'ready');
  assert.deepEqual(frames[0].insects.map((descriptor) => descriptor.id), [1, 2, 3, 4, 5, 6]);
  assert.equal(calls.ellipse, 0, 'the 2D facade does not leave a sixth procedural body behind');
  renderer.destroy();
});

test('permanently falls back to procedural bodies when 3D initialization rejects', async () => {
  const pending = deferred();
  const { calls, canvas } = createCanvas();
  const renderer = createRenderer(canvas, {
    worldLayerFactory: () => pending.promise,
    globalObject: createGlobalObject(),
    worldCanvas: {}
  });

  pending.reject(new Error('model unavailable'));
  await flushPromises();
  const firstFallback = renderer.render(fixtureState(), view, 100);
  const bodiesAfterFailure = calls.ellipse;
  const secondFallback = renderer.render(fixtureState(), view, 116);

  assert.equal(firstFallback.enemyRenderMode, 'fallback');
  assert.equal(secondFallback.enemyRenderMode, 'fallback');
  assert.ok(bodiesAfterFailure > 0);
  assert.ok(calls.ellipse > bodiesAfterFailure);
  renderer.destroy();
});

test('falls back in the same frame and tears down the active layer when its frame throws', async () => {
  const { calls, canvas } = createCanvas();
  let destroyed = 0;
  const renderer = createRenderer(canvas, {
    worldLayerFactory: async () => ({
      destroy() { destroyed += 1; },
      render() { throw new Error('context lost'); },
      resize() {}
    }),
    globalObject: createGlobalObject(),
    worldCanvas: {}
  });

  await flushPromises();
  const result = renderer.render(fixtureState(), view, 100);

  assert.equal(result.enemyRenderMode, 'fallback');
  assert.equal(destroyed, 1);
  assert.ok(calls.ellipse > 0, 'the same failing frame draws the procedural enemy body');
  renderer.destroy();
});

test('falls back to a procedural body in the same frame when Three.js reports a non-throwing shader failure', async () => {
  const { calls, canvas } = createCanvas();
  const layerCreated = deferred();
  const worldCanvas = {
    clientHeight: 844,
    clientWidth: 390,
    addEventListener() {},
    removeEventListener() {}
  };
  let webglRenderer;
  const renderer = createRenderer(canvas, {
    worldLayerFactory: async (target) => {
      const fixture = await createNonThrowingShaderFailureLayer(target);
      webglRenderer = fixture.webglRenderer;
      layerCreated.resolve();
      return fixture.layer;
    },
    globalObject: createGlobalObject(),
    worldCanvas
  });

  await layerCreated.promise;
  await flushPromises();
  const result = renderer.render(fixtureState(), view, 100);

  assert.equal(result.enemyRenderMode, 'fallback');
  assert.ok(calls.ellipse > 0, 'the shader-failing frame draws its visible procedural enemy body');
  assert.equal(webglRenderer.disposed, true, 'the failed WebGL layer is permanently retired');
  renderer.destroy();
});

test('destroys a layer that resolves after its renderer has been destroyed', async () => {
  const pending = deferred();
  const { canvas } = createCanvas();
  let destroyed = 0;
  const renderer = createRenderer(canvas, {
    worldLayerFactory: () => pending.promise,
    globalObject: createGlobalObject(),
    worldCanvas: {}
  });

  renderer.destroy();
  pending.resolve({ destroy() { destroyed += 1; }, render() { return true; }, resize() {} });
  await flushPromises();

  assert.equal(destroyed, 1);
});

test('destroys the active 3D layer during normal renderer teardown', async () => {
  const { canvas } = createCanvas();
  let destroyed = 0;
  const renderer = createRenderer(canvas, {
    worldLayerFactory: async () => ({ destroy() { destroyed += 1; }, render() { return true; }, resize() {} }),
    globalObject: createGlobalObject(),
    worldCanvas: {}
  });

  await flushPromises();
  renderer.destroy();

  assert.equal(destroyed, 1);
});

test('retains zeroed layer lifecycle diagnostics after active teardown', async () => {
  const { canvas } = createCanvas();
  let layerDestroyed = false;
  const renderer = createRenderer(canvas, {
    worldLayerFactory: async () => ({
      destroy() { layerDestroyed = true; },
      getDiagnostics() {
        return {
          liveInsectCount: layerDestroyed ? 0 : 6,
          corpseCount: layerDestroyed ? 0 : 4,
          sourceGeometryCount: layerDestroyed ? 0 : 1,
          destroyed: layerDestroyed
        };
      },
      render() { return true; },
      resize() {}
    }),
    globalObject: createGlobalObject(),
    worldCanvas: {}
  });
  await flushPromises();

  renderer.destroy();

  assert.deepEqual(renderer.getDiagnostics().layer, {
    liveInsectCount: 0,
    corpseCount: 0,
    sourceGeometryCount: 0,
    destroyed: true
  });
});

test('exposes stable renderer and layer diagnostics for local browser QA', async () => {
  const { canvas } = createCanvas();
  const layerDiagnostics = { instanceCount: 6, programCount: 4, shaderErrorCount: 0 };
  const renderer = createRenderer(canvas, {
    worldLayerFactory: async () => ({
      destroy() {},
      getDiagnostics() { return layerDiagnostics; },
      render() { return true; },
      resize() {}
    }),
    globalObject: createGlobalObject(),
    worldCanvas: {}
  });

  await flushPromises();
  renderer.render(fixtureState(), view, 100);

  assert.deepEqual(renderer.getDiagnostics(), {
    enemyLayerFailure: null,
    enemyRenderMode: 'ready',
    layer: layerDiagnostics
  });
  renderer.destroy();
});

test('diagnostic renderer exposes copied production frame primitives for direction anchors only', async () => {
  const { canvas } = createCanvas();
  const factoryOptions = [];
  const renderer = createRenderer(canvas, {
    exposeDiagnostics: true,
    globalObject: createGlobalObject(),
    worldCanvas: {},
    worldLayerFactory: async (_target, options) => {
      factoryOptions.push(options);
      return {
        destroy() {},
        getDiagnostics() { return {}; },
        render() { return true; },
        resize() {}
      };
    }
  });
  await flushPromises();
  const state = {
    enemies: [{
      id: 'anchor-target', type: 'swarmer', size: 1, distance: 0.4,
      yaw: 12, pitch: -3, phase: 0, hitFlash: 0
    }],
    corpses: [], shield: 100, weapon: { recoil: 0 }
  };
  renderer.present({ id: 909, type: 'miss', yaw: 12, pitch: -3, effectSeed: 2 });

  renderer.render(state, { ...cameraView, yaw: 12, pitch: -3 }, 1000);
  const aimed = renderer.getDiagnostics().frame;
  renderer.render(state, { ...cameraView, yaw: 102, pitch: -3 }, 1100);
  const away = renderer.getDiagnostics().frame;
  renderer.render(state, { ...cameraView, yaw: 12, pitch: -3 }, 1200);
  const returned = renderer.getDiagnostics().frame;

  const aimedTarget = aimed.insects.find(({ id }) => id === 'anchor-target');
  const awayTarget = away.insects.find(({ id }) => id === 'anchor-target');
  const returnedTarget = returned.insects.find(({ id }) => id === 'anchor-target');
  const aimedImpact = aimed.effects.impacts.find(({ id }) => id === 909);
  const awayImpact = away.effects.impacts.find(({ id }) => id === 909);
  const returnedImpact = returned.effects.impacts.find(({ id }) => id === 909);
  assert.equal(aimedTarget.visible, true);
  assert.equal(awayTarget.visible, false);
  assert.deepEqual(
    { x: returnedTarget.x, centerY: returnedTarget.centerY, visible: returnedTarget.visible },
    { x: aimedTarget.x, centerY: aimedTarget.centerY, visible: aimedTarget.visible }
  );
  assert.equal(aimedImpact.visible, true);
  assert.equal(awayImpact.visible, false);
  assert.deepEqual(
    { x: returnedImpact.x, y: returnedImpact.y, visible: returnedImpact.visible },
    { x: aimedImpact.x, y: aimedImpact.y, visible: aimedImpact.visible }
  );
  assert.deepEqual(Object.keys(aimedTarget).sort(), ['centerY', 'id', 'visible', 'x']);
  assert.deepEqual(Object.keys(aimedImpact).sort(), ['id', 'visible', 'x', 'y']);
  aimed.insects.length = 0;
  assert.equal(renderer.getDiagnostics().frame.insects.length, 1, 'callers cannot mutate the retained snapshot');
  assert.equal(factoryOptions[0].exposeDiagnostics, true);

  renderer.destroy();
  assert.equal(renderer.getDiagnostics().frame, null);
});

test('exposes the maximum-effect QA seeder only for an explicit diagnostic renderer', async () => {
  const ordinaryFixture = await createRendererFixture();
  assert.equal('seedMaximumEffectsForQa' in ordinaryFixture.renderer, false);
  assert.equal('frame' in ordinaryFixture.renderer.getDiagnostics(), false);
  ordinaryFixture.renderer.destroy();

  const { canvas } = createCanvas();
  const layer = {
    lastFrame: null,
    destroy() {},
    getDiagnostics() {
      return {
        liveInsectCount: this.lastFrame?.insects.length || 0,
        corpseCount: this.lastFrame?.corpses.length || 0,
        casingCount: this.lastFrame?.effects.casings.length || 0,
        impactCount: this.lastFrame?.effects.impacts.length || 0,
        fragmentCount: (this.lastFrame?.effects.fragments.length || 0)
          + (this.lastFrame?.effects.fluids.length || 0)
      };
    },
    render(frame) { this.lastFrame = frame; return true; },
    resize() {}
  };
  const renderer = createRenderer(canvas, {
    exposeDiagnostics: true,
    globalObject: createGlobalObject(),
    worldCanvas: { clientWidth: 390, clientHeight: 844 },
    worldLayerFactory: async () => layer
  });
  await flushPromises();

  assert.equal(typeof renderer.seedMaximumEffectsForQa, 'function');
  assert.equal(renderer.seedMaximumEffectsForQa(), true);
  renderer.render(maxStateWithCorpses(), cameraView, 1000);

  assert.deepEqual(renderer.getDiagnostics().layer, {
    liveInsectCount: 6,
    corpseCount: 4,
    casingCount: 20,
    impactCount: 8,
    fragmentCount: 36
  });
  renderer.destroy();
});

test('does not initialize an enemy layer without a world canvas', () => {
  const { canvas } = createCanvas();
  let factoryCalls = 0;
  const renderer = createRenderer(canvas, {
    worldLayerFactory: () => { factoryCalls += 1; },
    globalObject: createGlobalObject()
  });

  const result = renderer.render(fixtureState(), view, 100);

  assert.equal(factoryCalls, 0);
  assert.equal(result.enemyRenderMode, 'disabled');
  renderer.destroy();
});

test('uses a camera-derived field of view below 20 degrees when projecting enemies', () => {
  const { canvas } = createCanvas();
  const renderer = createRenderer(canvas, {
    globalObject: createGlobalObject()
  });
  const state = {
    enemies: [
      { id: 'edge', type: 'infected', size: 1, distance: 0.4, yaw: 11.25, pitch: 0, phase: 0, hitFlash: 0 }
    ],
    shield: 100,
    weapon: { recoil: 0 }
  };

  const defaultResult = renderer.render(state, view, 100);
  const croppedResult = renderer.render(state, { ...view, horizontalFov: 19.523 }, 116);

  assert.deepEqual(defaultResult.visibleEnemyIds, ['edge']);
  assert.deepEqual(croppedResult.visibleEnemyIds, []);
  renderer.destroy();
});

test('uses vertical field of view for projected position and visibility in both renderer layers', async () => {
  const { canvas } = createCanvas();
  const frames = [];
  const renderer = createRenderer(canvas, {
    worldLayerFactory: async () => ({
      destroy() {},
      render(frame) {
        frames.push(frame);
        return true;
      },
      resize() {}
    }),
    globalObject: createGlobalObject(),
    worldCanvas: { clientHeight: 844, clientWidth: 390 }
  });
  const state = {
    enemies: [
      { id: 'vertical-edge', type: 'infected', size: 1, distance: 0.4, yaw: 0, pitch: 12, phase: 0, hitFlash: 0 }
    ],
    shield: 100,
    weapon: { recoil: 0 }
  };
  await flushPromises();

  const defaultResult = renderer.render(state, { ...view, verticalFov: 48 }, 100);
  const croppedResult = renderer.render(state, { ...view, verticalFov: 20 }, 116);

  assert.deepEqual(defaultResult.visibleEnemyIds, ['vertical-edge']);
  assert.deepEqual(croppedResult.visibleEnemyIds, []);
  assert.equal(frames[0].insects[0].visible, true);
  assert.equal(frames[1].insects[0].visible, false);
  assert.ok(frames[1].insects[0].centerY < frames[0].insects[0].centerY - 250);
  renderer.destroy();
});
