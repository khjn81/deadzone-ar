import assert from 'node:assert/strict';
import test from 'node:test';

const runtimeUrl = new URL('../public/game/src/vendor/three-runtime.mjs', import.meta.url);
const layerUrl = new URL('../public/game/src/three-world-layer.mjs', import.meta.url);
const modelUrl = new URL('../public/game/assets/models/infected-swarmer.glb', import.meta.url).href;
const modelUrls = [
  'infected-swarmer.glb',
  'infected-stinger.glb',
  'infected-bulwark.glb',
  'infected-queen.glb'
].map((file) => new URL(`../public/game/assets/models/${file}`, import.meta.url).href);

function deferred() {
  let reject;
  let resolve;
  const promise = new Promise((accept, decline) => {
    resolve = accept;
    reject = decline;
  });
  return { promise, reject, resolve };
}

function liveInsect(id, overrides = {}) {
  return {
    id,
    x: 200,
    centerY: 300,
    height: 90,
    widthScale: 1,
    wingRate: 1.2,
    wingPhase: 0.25,
    depth: 0.5,
    bank: 0,
    hitFlash: 0,
    elite: false,
    modelKind: 'swarmer',
    appearance: {
      baseColor: 0x302a19,
      fluidColor: 0x8c9a1b,
      wingTint: 0xc8d2bc,
      weakPointColor: 0xff8b42,
      roughness: 0.7,
      metalness: 0.07
    },
    visible: true,
    ...overrides
  };
}

function corpse(id, overrides = {}) {
  return {
    id,
    enemyId: id,
    x: 200,
    centerY: 500,
    height: 82,
    depth: 0.55,
    rotation: 0.42,
    curl: 0.8,
    opacity: 0.72,
    state: 'resting',
    elite: false,
    appearance: {
      baseColor: 0x25271d,
      fluidColor: 0x718414,
      wingTint: 0xb9c7aa,
      weakPointColor: 0xff8b42,
      roughness: 0.76,
      metalness: 0.04
    },
    visible: true,
    ...overrides
  };
}

function maximumWorldFrame() {
  return {
    insects: [0.95, 0.79, 0.63, 0.47, 0.31, 0.15].map((depth, index) => liveInsect(index + 1, {
      depth,
      elite: index === 5,
      height: 100,
      x: 200,
      centerY: 320
    })),
    corpses: [0.88, 0.66, 0.44, 0.22].map((depth, index) => corpse(index + 101, {
      depth,
      elite: index === 3
    })),
    effects: { casings: [], impacts: [], fragments: [], fluids: [] }
  };
}

function sceneObjects(scene, predicate) {
  const objects = [];
  scene.traverse((object) => {
    if (predicate(object)) objects.push(object);
  });
  return objects;
}

function countedRuntime(THREE, counters, WebGLRenderer) {
  function counted(Base, key) {
    return class extends Base {
      constructor(...args) {
        super(...args);
        counters[key] += 1;
      }
    };
  }

  return {
    ...THREE,
    WebGLRenderer,
    Group: counted(THREE.Group, 'groups'),
    Mesh: counted(THREE.Mesh, 'meshes'),
    BufferGeometry: counted(THREE.BufferGeometry, 'geometries'),
    PlaneGeometry: counted(THREE.PlaneGeometry, 'geometries'),
    CylinderGeometry: counted(THREE.CylinderGeometry, 'geometries'),
    BoxGeometry: counted(THREE.BoxGeometry, 'geometries'),
    SphereGeometry: counted(THREE.SphereGeometry, 'geometries'),
    ConeGeometry: counted(THREE.ConeGeometry, 'geometries'),
    MeshBasicMaterial: counted(THREE.MeshBasicMaterial, 'materials'),
    MeshStandardMaterial: counted(THREE.MeshStandardMaterial, 'materials')
  };
}

async function createWorldLayerFixture(options = {}) {
  const bundledRuntime = await import(runtimeUrl);
  const { createThreeWorldLayer } = await import(layerUrl);
  const renderers = [];
  const listeners = new Map();
  const listenerAdds = [];
  const listenerRemovals = [];
  const requestedUrls = [];
  const allocationCounts = { geometries: 0, groups: 0, materials: 0, meshes: 0 };

  const canvas = {
    clientWidth: 400,
    clientHeight: 800,
    addEventListener(type, handler, capture) {
      listenerAdds.push([type, handler, capture]);
      listeners.set(type, handler);
    },
    removeEventListener(type, handler, capture) {
      listenerRemovals.push([type, handler, capture]);
      if (listeners.get(type) === handler) listeners.delete(type);
    },
    dispatch(type, event = {}) {
      listeners.get(type)?.(event);
    }
  };

  class WebGLRenderer {
    constructor(rendererOptions) {
      this.debug = { checkShaderErrors: true, onShaderError: null };
      this.info = { programs: [{}], render: { calls: 0, triangles: 0 } };
      this.options = rendererOptions;
      this.pixelRatios = [];
      this.sizes = [];
      this.shadowMap = {};
      this.renderLists = { dispose: () => {
        this.renderListsDisposed = true;
        this.renderListsDisposeCount = (this.renderListsDisposeCount || 0) + 1;
      } };
      renderers.push(this);
    }

    setClearColor(color, alpha) {
      this.clearColor = [color, alpha];
    }

    setPixelRatio(value) {
      this.pixelRatios.push(value);
    }

    setSize(width, height, updateStyle) {
      if (options.resizeError) throw options.resizeError;
      this.sizes.push([width, height, updateStyle]);
    }

    render(scene, camera) {
      this.lastFrame = { scene, camera };
      this.info.render.calls = sceneObjects(scene, (object) => object.isMesh && object.visible).length;
      if (options.shaderFailureOnRender && !this.shaderFailureSent) {
        this.shaderFailureSent = true;
        const log = () => 'fixture shader log';
        this.debug.onShaderError?.(
          { getProgramInfoLog: log, getShaderInfoLog: log },
          {},
          {},
          {}
        );
      }
      if (options.contextLossOnRender && !this.contextLossSent) {
        this.contextLossSent = true;
        canvas.dispatch('webglcontextlost', options.contextLossEvent || {});
      }
    }

    getContext() {
      return { getContextAttributes: () => ({ alpha: true }) };
    }

    dispose() {
      this.disposeCount = (this.disposeCount || 0) + 1;
      this.renderLists.dispose();
    }

    forceContextLoss() {
      this.forceContextLossCount = (this.forceContextLossCount || 0) + 1;
    }
  }

  const sourceTexture = new bundledRuntime.THREE.Texture();
  sourceTexture.name = 'MosquitoBaseColor';
  const sourceImage = { closeCount: 0, close() { this.closeCount += 1; } };
  const secondarySourceImage = { closeCount: 0, close() { this.closeCount += 1; } };
  sourceTexture.source.data = options.arrayTextureSource
    ? [sourceImage, secondarySourceImage]
    : sourceImage;
  const sourceMaterial = new bundledRuntime.THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: sourceTexture,
    roughness: 0.72,
    metalness: 0.06
  });
  sourceMaterial.name = 'MosquitoMaterial';
  const sourceGeometry = new bundledRuntime.THREE.BoxGeometry(2, 1, 0.4);
  const vertexCount = sourceGeometry.getAttribute('position').count;
  sourceGeometry.setAttribute(
    'skinIndex',
    new bundledRuntime.THREE.Uint16BufferAttribute(new Uint16Array(vertexCount * 4), 4)
  );
  const weights = new Float32Array(vertexCount * 4);
  for (let index = 0; index < vertexCount; index += 1) weights[index * 4] = 1;
  sourceGeometry.setAttribute(
    'skinWeight',
    new bundledRuntime.THREE.Float32BufferAttribute(weights, 4)
  );
  const sourceBone = new bundledRuntime.THREE.Bone();
  sourceBone.name = 'BodyRoot';
  const sourceMesh = new bundledRuntime.THREE.SkinnedMesh(sourceGeometry, sourceMaterial);
  sourceMesh.name = 'BodyMesh';
  sourceMesh.add(sourceBone);
  sourceMesh.bind(new bundledRuntime.THREE.Skeleton([sourceBone]));
  const fusedSourceWings = new bundledRuntime.THREE.Mesh(sourceGeometry, sourceMaterial);
  fusedSourceWings.name = 'FusedSourceWings';
  const source = new bundledRuntime.THREE.Group();
  source.name = 'InfectedSwarmerSource';
  source.add(sourceMesh, fusedSourceWings);
  const sourceDisposals = { geometry: 0, material: 0, skeleton: 0, texture: 0 };
  sourceGeometry.addEventListener('dispose', () => { sourceDisposals.geometry += 1; });
  sourceMaterial.addEventListener('dispose', () => { sourceDisposals.material += 1; });
  sourceTexture.addEventListener('dispose', () => { sourceDisposals.texture += 1; });
  const disposeSourceSkeleton = sourceMesh.skeleton.dispose.bind(sourceMesh.skeleton);
  sourceMesh.skeleton.dispose = () => {
    sourceDisposals.skeleton += 1;
    disposeSourceSkeleton();
  };
  const loadGate = options.loadGate;

  class GLTFLoader {
    async loadAsync(url) {
      requestedUrls.push(url);
      if (loadGate) await loadGate.promise;
      if (options.loadErrorUrls?.has?.(url)) {
        throw options.loadErrorUrls.get(url) || new Error(`fixture GLB load failure: ${url}`);
      }
      if (options.loadError) throw options.loadError;
      return { scene: source, animations: [] };
    }
  }

  const THREE = countedRuntime(bundledRuntime.THREE, allocationCounts, WebGLRenderer);
  const BaseScene = THREE.Scene;
  const createdScenes = [];
  let effectAdds = 0;
  THREE.Scene = class extends BaseScene {
    constructor(...args) {
      super(...args);
      createdScenes.push(this);
    }

    add(...objects) {
      if (options.sceneAddError && objects.some((object) => object?.userData?.insectId !== undefined)) {
        throw options.sceneAddError;
      }
      const result = super.add(...objects);
      if (objects.some((object) => object?.userData?.effectPool)) {
        effectAdds += 1;
        if (effectAdds === options.effectSceneAddErrorAt) {
          throw options.effectSceneAddError || new Error('fixture effect scene add failure');
        }
      }
      return result;
    }
  };
  if (options.meshErrorAt) {
    const Mesh = THREE.Mesh;
    let meshCreations = 0;
    THREE.Mesh = class extends Mesh {
      constructor(...args) {
        meshCreations += 1;
        if (meshCreations === options.meshErrorAt) throw options.meshError || new Error('fixture mesh creation failure');
        super(...args);
      }
    };
  }
  const cloneSkeleton = options.cloneSkeleton || bundledRuntime.cloneSkeleton;
  const creation = createThreeWorldLayer(canvas, {
    pixelRatio: options.pixelRatio ?? 3,
    signal: options.signal,
    modelUrl: options.modelUrl,
    modelKind: options.modelKind,
    reducedMotion: options.reducedMotion === true,
    runtime: { THREE, GLTFLoader, cloneSkeleton }
  });
  await Promise.resolve();

  if (options.returnCreation) {
    return {
      allocationCounts,
      canvas,
      creation,
      listenerAdds,
      listenerRemovals,
      listeners,
      loadGate,
      renderer: renderers[0],
      scene: createdScenes.at(-1),
      requestedUrls,
      source: {
        fusedSourceWings,
        geometry: sourceGeometry,
        material: sourceMaterial,
        mesh: sourceMesh,
        root: source,
        sourceDisposals,
        image: sourceImage,
        images: [sourceImage, secondarySourceImage],
        texture: sourceTexture
      }
    };
  }

  const layer = await creation;
  return {
    THREE,
    allocationCounts,
    canvas,
    layer,
    listenerAdds,
    listenerRemovals,
    listeners,
    renderer: renderers[0],
    scene: createdScenes.at(-1),
    requestedUrls,
    source: {
      fusedSourceWings,
      geometry: sourceGeometry,
      material: sourceMaterial,
      mesh: sourceMesh,
      root: source,
      sourceDisposals,
      image: sourceImage,
      images: [sourceImage, secondarySourceImage],
      texture: sourceTexture
    }
  };
}

test('world layer exposes its async factory and clearly rejects a missing canvas', async () => {
  const { createThreeWorldLayer } = await import(layerUrl);

  assert.equal(typeof createThreeWorldLayer, 'function');
  await assert.rejects(createThreeWorldLayer(), /canvas/i);
});

test('loads each insect species template once and renders six live insects plus four corpses', async () => {
  const { layer, requestedUrls, renderer } = await createWorldLayerFixture();
  assert.deepEqual(requestedUrls, modelUrls);
  assert.deepEqual(renderer.options, {
    canvas: renderer.options.canvas,
    alpha: true,
    antialias: false,
    powerPreference: 'high-performance'
  });
  assert.equal(renderer.getContext().getContextAttributes().alpha, true);
  assert.equal(layer.render(maximumWorldFrame(), 0), true);
  const diagnostics = layer.getDiagnostics();
  assert.equal(diagnostics.liveInsectCount, 6);
  assert.equal(diagnostics.corpseCount, 4);
  assert.equal(diagnostics.speciesSourceCount, 4);
  assert.equal(diagnostics.speciesFallbackCount, 0);
  assert.deepEqual(diagnostics.speciesModelKinds, ['swarmer', 'stinger', 'bulwark', 'queen']);
  assert.ok(renderer.info.render.calls > 0);
  layer.destroy();
});

test('falls back only the species whose GLB failed and keeps the remaining templates live', async () => {
  const failedUrl = modelUrls[1];
  const fixture = await createWorldLayerFixture({
    loadErrorUrls: new Map([[failedUrl, new Error('fixture stinger unavailable')]])
  });
  assert.deepEqual(fixture.requestedUrls, modelUrls);
  assert.equal(fixture.layer.getDiagnostics().speciesSourceCount, 3);
  assert.equal(fixture.layer.getDiagnostics().speciesFallbackCount, 1);
  fixture.layer.render({
    insects: [
      liveInsect(1, { species: 'stinger', modelKind: 'stinger', wingStyle: 'wasp' }),
      liveInsect(2, { species: 'bulwark', modelKind: 'bulwark', wingStyle: 'shell' })
    ],
    corpses: [],
    effects: {}
  }, 0);
  const stinger = fixture.renderer.lastFrame.scene.children.find((node) => node.userData.insectId === 1);
  const stingerModel = sceneObjects(stinger, (node) => node.userData.insectModel)[0];
  assert.equal(stinger.userData.species, 'stinger');
  assert.equal(stingerModel.userData.proceduralFallback, true);
  const bulwark = fixture.renderer.lastFrame.scene.children.find((node) => node.userData.insectId === 2);
  const bulwarkModel = sceneObjects(bulwark, (node) => node.userData.insectModel)[0];
  assert.equal(bulwark.userData.species, 'bulwark');
  assert.notEqual(bulwarkModel.userData.proceduralFallback, true);
  fixture.layer.destroy();
});

test('applies species wing, armor, weak-point, and death styling without changing pool limits', async () => {
  const { layer, renderer } = await createWorldLayerFixture();
  layer.render({
    insects: [
      liveInsect(1, { species: 'swarmer', modelKind: 'swarmer', wingStyle: 'mosquito' }),
      liveInsect(2, { species: 'stinger', modelKind: 'stinger', wingStyle: 'wasp' }),
      liveInsect(3, { species: 'bulwark', modelKind: 'bulwark', wingStyle: 'shell', weakPointStyle: 'side-plate' }),
      liveInsect(4, { species: 'queen', modelKind: 'queen', wingStyle: 'queen', weakPointStyle: 'thorax-core', elite: true })
    ],
    corpses: [],
    effects: {}
  }, 0);
  const roots = [1, 2, 3, 4].map((id) => renderer.lastFrame.scene.children.find((node) => node.userData.insectId === id));
  assert.deepEqual(roots.map((root) => root.userData.species), ['swarmer', 'stinger', 'bulwark', 'queen']);
  const wingSpans = roots.map((root) => {
    const wing = sceneObjects(root, (node) => node.userData.proceduralWing)[0];
    return wing.scale.y;
  });
  assert.ok(new Set(wingSpans).size >= 3, 'species use distinct wing silhouettes');
  const wingWidths = roots.map((root) => {
    const wing = sceneObjects(root, (node) => node.userData.proceduralWing)[0];
    return Math.abs(wing.scale.x);
  });
  assert.ok(new Set(wingWidths).size >= 3, 'species retain distinct wing widths');
  const bodyPivots = roots.map((root) => sceneObjects(root, (node) => node.userData.insectModel)[0]);
  assert.ok(new Set(bodyPivots.map((pivot) => pivot.scale.x)).size >= 3, 'species retain distinct body widths');
  const weakPointScales = roots.map((root) => sceneObjects(root, (node) => node.userData.insectWeakPoint)[0].scale.x);
  assert.ok(new Set(weakPointScales).size >= 3, 'species retain distinct weak-point sizes');
  const shellArmor = sceneObjects(roots[2], (node) => node.userData.shellArmor && node.visible);
  assert.ok(shellArmor.length >= 1, 'bulwark receives a visible shell plate');
  const weakPoints = roots.map((root) => sceneObjects(root, (node) => node.userData.insectWeakPoint)[0]);
  assert.notDeepEqual(weakPoints[0].position.toArray(), weakPoints[2].position.toArray());

  layer.render({
    insects: [],
    corpses: [
      corpse(101, { species: 'bulwark', modelKind: 'bulwark', deathStyle: 'shell-roll' }),
      corpse(102, { species: 'queen', modelKind: 'queen', deathStyle: 'queen-collapse', elite: true })
    ],
    effects: {}
  }, 1000);
  const bulwarkCorpse = renderer.lastFrame.scene.children.find((node) => node.userData.corpseId === 101);
  const queenCorpse = renderer.lastFrame.scene.children.find((node) => node.userData.corpseId === 102);
  const bulwarkPivot = sceneObjects(bulwarkCorpse, (node) => node.userData.insectModel)[0];
  const queenPivot = sceneObjects(queenCorpse, (node) => node.userData.insectModel)[0];
  assert.notEqual(bulwarkPivot.rotation.x, queenPivot.rotation.x);
  assert.equal(layer.getDiagnostics().liveInsectCount, 0);
  assert.equal(layer.getDiagnostics().corpseCount, 2);
  layer.destroy();
});

test('uses shared tapered root-pivot wings while owning clone material and skeleton state', async () => {
  const { THREE, layer, renderer, source } = await createWorldLayerFixture();
  layer.render({
    insects: [liveInsect(1), liveInsect(2, { wingPhase: 0.7, hitFlash: 1 })],
    corpses: [],
    effects: {}
  }, 1000);
  const insects = renderer.lastFrame.scene.children
    .filter((node) => node.userData.insectId !== undefined)
    .sort((left, right) => left.userData.insectId - right.userData.insectId);
  const meshes = insects.map((insect) => insect.getObjectByName('BodyMesh'));

  assert.equal(meshes.length, 2);
  assert.equal(meshes[0].geometry, source.geometry);
  assert.equal(meshes[1].geometry, source.geometry);
  assert.notEqual(meshes[0].material, source.material);
  assert.notEqual(meshes[1].material, source.material);
  assert.notEqual(meshes[0].material, meshes[1].material);
  assert.equal(meshes[0].material.map, source.texture);
  assert.equal(meshes[1].material.map, source.texture);
  assert.notEqual(meshes[0].skeleton, meshes[1].skeleton);
  assert.notEqual(meshes[0].skeleton.bones[0], meshes[1].skeleton.bones[0]);

  for (const insect of insects) {
    const proceduralWings = sceneObjects(insect, (node) => node.userData.proceduralWing);
    assert.equal(proceduralWings.length, 2);
    assert.equal(proceduralWings[0].geometry, proceduralWings[1].geometry, 'one tapered geometry is shared by both sides');
    const geometry = proceduralWings[0].geometry;
    const positions = geometry.getAttribute('position');
    assert.ok(positions.count >= 6, 'the silhouette has enough vertices to avoid a rectangular plate');
    assert.ok((geometry.index?.count || 0) >= 12, 'the silhouette is triangulated beyond two rectangular faces');
    const points = Array.from({ length: positions.count }, (_, index) => ({
      x: positions.getX(index),
      y: positions.getY(index)
    }));
    const root = points.filter(({ x }) => Math.abs(x) < 1e-6);
    const middle = points.filter(({ x }) => x > 0.15 && x < 0.55);
    const tip = points.filter(({ x }) => x > 0.55);
    const span = (items) => Math.max(...items.map(({ y }) => y)) - Math.min(...items.map(({ y }) => y));
    assert.equal(root.length, 2, 'the narrow attachment edge sits on the local origin');
    assert.ok(span(root) < span(middle) * 0.45, 'the wing opens out from a narrow root');
    assert.ok(span(tip) < span(middle) * 0.7, 'the wing tapers again at the tip');
    assert.notEqual(
      Math.max(...points.map(({ y }) => y)),
      Math.abs(Math.min(...points.map(({ y }) => y))),
      'the outline is asymmetric rather than a mirrored rectangle'
    );
    assert.deepEqual(proceduralWings.map((wing) => Math.sign(wing.scale.x)), [-1, 1]);
    assert.deepEqual(proceduralWings.map((wing) => Math.sign(wing.position.x)), [-1, 1]);
    assert.ok(proceduralWings.every((wing) => wing.material.transparent));
    assert.ok(proceduralWings.every((wing) => wing.material.depthWrite === false));
    assert.ok(proceduralWings.every((wing) => wing.material.opacity >= 0.22 && wing.material.opacity <= 0.3));
    assert.equal(insect.getObjectByName('FusedSourceWings').visible, true);
    const modelPivot = sceneObjects(insect, (node) => node.userData.insectModel)[0];
    assert.ok(proceduralWings.every((wing) => wing.parent === modelPivot), 'wings inherit body scale and bank');
    const bodyBounds = new THREE.Box3().setFromObject(insect.getObjectByName('BodyMesh'));
    const wingBounds = new THREE.Box3().setFromObject(proceduralWings[0]);
    assert.ok(wingBounds.getSize(new THREE.Vector3()).length() > bodyBounds.getSize(new THREE.Vector3()).length() * 0.1);
  }
  assert.notEqual(insects[0].children.at(-1).rotation.z, insects[1].children.at(-1).rotation.z);
  layer.destroy();
});

test('keeps sinusoidal wing spread bounded at extreme timestamps without frame allocations', async () => {
  const { allocationCounts, layer, renderer } = await createWorldLayerFixture();
  const frame = {
    insects: [liveInsect(1, { wingPhase: Number.MAX_VALUE, wingRate: Number.MAX_VALUE })],
    corpses: [],
    effects: {}
  };
  layer.render(frame, Number.MAX_VALUE);
  const allocations = { ...allocationCounts };
  const root = renderer.lastFrame.scene.children.find((node) => node.userData.insectId === 1);
  const wings = sceneObjects(root, (node) => node.userData.proceduralWing);
  assert.equal(wings.length, 2);
  assert.ok(wings.every((wing) => Number.isFinite(wing.rotation.z)));
  assert.ok(wings.every((wing) => Math.abs(wing.rotation.z) <= 0.35));

  for (const timestamp of [-Number.MAX_VALUE, 0, 60_000, Number.MAX_VALUE]) {
    layer.render(frame, timestamp);
    assert.ok(wings.every((wing) => Math.abs(wing.rotation.z) <= 0.35));
  }
  assert.deepEqual({ ...allocationCounts }, allocations);
  layer.destroy();
});

test('freezes Three wing motion when reduced motion is requested', async () => {
  const { layer, renderer } = await createWorldLayerFixture({ reducedMotion: true });
  const frame = { insects: [liveInsect(1, { wingPhase: 0.37, wingRate: 9 })], corpses: [], effects: {} };
  layer.render(frame, 0);
  const insect = renderer.lastFrame.scene.children.find((node) => node.userData.insectId === 1);
  const wings = sceneObjects(insect, (node) => node.userData.proceduralWing);
  const first = wings.map((wing) => wing.rotation.z);
  const pivot = sceneObjects(insect, (node) => node.userData.insectModel)[0];
  const firstPivotBank = pivot.rotation.z;
  layer.render(frame, 10_000);
  const second = wings.map((wing) => wing.rotation.z);
  assert.deepEqual(second, first);
  assert.equal(pivot.rotation.z, firstPivotBank);
  layer.destroy();
});

test('keeps shared wing geometry alive through instance eviction and disposes wing resources once', async () => {
  const { layer, renderer } = await createWorldLayerFixture();
  layer.render({ insects: [liveInsect(1)], corpses: [], effects: {} }, 0);
  const root = renderer.lastFrame.scene.children.find((node) => node.userData.insectId === 1);
  const wings = sceneObjects(root, (node) => node.userData.proceduralWing);
  const geometry = wings[0].geometry;
  const material = wings[0].material;
  let geometryDisposals = 0;
  let materialDisposals = 0;
  geometry.addEventListener('dispose', () => { geometryDisposals += 1; });
  material.addEventListener('dispose', () => { materialDisposals += 1; });

  layer.render({ insects: [], corpses: [], effects: {} }, 16);
  assert.equal(materialDisposals, 1, 'eviction disposes the instance-owned wing material');
  assert.equal(geometryDisposals, 0, 'the shared wing geometry remains available to the scene');

  layer.destroy();
  layer.destroy();
  assert.equal(materialDisposals, 1);
  assert.equal(geometryDisposals, 1);
});

test('caps live and corpse maps and adds shared armor only to queens without contact shadows', async () => {
  const { layer, renderer } = await createWorldLayerFixture();
  const frame = maximumWorldFrame();
  frame.insects.push(liveInsect(7), liveInsect(8));
  frame.corpses.push(corpse(105), corpse(106));
  layer.render(frame, 0);

  const insects = sceneObjects(renderer.lastFrame.scene, (node) => node.userData.insectId !== undefined);
  const corpses = sceneObjects(renderer.lastFrame.scene, (node) => node.userData.corpseId !== undefined);
  const normal = insects.find((node) => node.userData.insectId === 1);
  const liveQueen = insects.find((node) => node.userData.insectId === 6);
  const corpseQueen = corpses.find((node) => node.userData.corpseId === 104);
  const liveArmor = sceneObjects(liveQueen, (node) => node.userData.queenArmor);
  const corpseArmor = sceneObjects(corpseQueen, (node) => node.userData.queenArmor);

  assert.equal(insects.length, 6);
  assert.equal(corpses.length, 4);
  assert.equal(sceneObjects(normal, (node) => node.userData.queenArmor).length, 0);
  assert.ok(liveArmor.length >= 3);
  assert.equal(liveArmor.length, corpseArmor.length);
  assert.deepEqual(
    liveArmor.map((part) => part.geometry),
    corpseArmor.map((part) => part.geometry),
    'queen armor geometry is shared across instances'
  );
  assert.ok(liveArmor.every((part) => part.material === liveArmor[0].material));
  assert.ok(corpseArmor.every((part) => part.material === corpseArmor[0].material));
  assert.notEqual(liveArmor[0].material, corpseArmor[0].material, 'armor material state is owned per instance');
  assert.equal(corpseArmor[0].material.transparent, true);
  assert.equal(corpseArmor[0].material.opacity, frame.corpses[3].opacity);
  assert.equal(sceneObjects(renderer.lastFrame.scene, (node) => node.userData.contactShadow).length, 0);
  layer.destroy();
});

test('updates elite armor and deterministic appearance without reallocating an instance', async () => {
  const { allocationCounts, layer, renderer } = await createWorldLayerFixture();
  layer.render({ insects: [liveInsect(1)], corpses: [], effects: {} }, 0);
  const root = renderer.lastFrame.scene.children.find((node) => node.userData.insectId === 1);
  const allocations = { ...allocationCounts };
  const wings = sceneObjects(root, (node) => node.userData.proceduralWing);
  const armor = sceneObjects(root, (node) => node.userData.armorPart);
  const weakPoint = sceneObjects(root, (node) => node.userData.insectWeakPoint)[0];
  assert.equal(armor.filter((part) => part.visible).length, 0);

  layer.render({
    insects: [liveInsect(1, {
      elite: true,
      appearance: {
        ...liveInsect(1).appearance,
        colorLift: 0.04,
        wingTint: 0x123456,
        weakPointColor: 0xff3b21
      }
    })],
    corpses: [],
    effects: {}
  }, 16);
  assert.deepEqual({ ...allocationCounts }, allocations);
  assert.equal(armor.filter((part) => part.visible && part.userData.queenArmor).length, 3);
  assert.equal(wings[0].material.color.getHex(), 0x123456);
  assert.equal(weakPoint.material.color.getHex(), 0xff3b21);
  assert.equal(weakPoint.scale.x, 1.35);

  layer.render({ insects: [liveInsect(1, { elite: false })], corpses: [], effects: {} }, 32);
  assert.equal(armor.filter((part) => part.visible || part.userData.queenArmor).length, 0);
  layer.destroy();
});

test('fades corpse body wings armor and weak point as one owned material state', async () => {
  const { layer, renderer } = await createWorldLayerFixture();
  layer.render({ insects: [], corpses: [corpse(101, { elite: true, opacity: 0.25 })], effects: {} }, 0);
  const root = renderer.lastFrame.scene.children.find((node) => node.userData.corpseId === 101);
  const body = root.getObjectByName('BodyMesh');
  const wing = sceneObjects(root, (node) => node.userData.proceduralWing)[0];
  const armor = sceneObjects(root, (node) => node.userData.queenArmor)[0];
  const weakPoint = sceneObjects(root, (node) => node.userData.insectWeakPoint)[0];
  assert.equal(body.material.opacity, 0.25);
  assert.ok(wing.material.opacity >= 0.22 * 0.25 && wing.material.opacity <= 0.3 * 0.25);
  assert.equal(armor.material.opacity, 0.25);
  assert.equal(weakPoint.material.opacity, 0.25);
  assert.ok([body, wing, armor, weakPoint].every((mesh) => mesh.material.transparent && !mesh.material.depthWrite));
  layer.destroy();
});

test('places the mixed maximum world into unique strict bands wholly inside the camera frustum', async () => {
  const { THREE, layer, renderer } = await createWorldLayerFixture();
  const frame = maximumWorldFrame();
  layer.render(frame, 0);

  const roots = renderer.lastFrame.scene.children.filter((node) => (
    node.userData.insectId !== undefined || node.userData.corpseId !== undefined
  ));
  const byDepth = roots.map((root) => ({
    bounds: new THREE.Box3().setFromObject(root),
    depth: frame.insects.find((item) => item.id === root.userData.insectId)?.depth
      ?? frame.corpses.find((item) => item.id === root.userData.corpseId)?.depth
  })).sort((left, right) => right.depth - left.depth);
  assert.equal(new Set(byDepth.map(({ bounds }) => bounds.min.z)).size, 10);
  for (let index = 1; index < byDepth.length; index += 1) {
    assert.ok(byDepth[index].bounds.min.z > byDepth[index - 1].bounds.max.z, `mixed band ${index + 1} is wholly in front`);
  }
  for (const { bounds } of byDepth) {
    assert.ok(bounds.max.z <= renderer.lastFrame.camera.position.z - renderer.lastFrame.camera.near);
    assert.ok(bounds.min.z >= renderer.lastFrame.camera.position.z - renderer.lastFrame.camera.far);
  }

  const corpseContainer = renderer.lastFrame.scene.children.find((node) => node.userData.corpseId === 101);
  const corpsePivot = sceneObjects(corpseContainer, (node) => node.userData.insectModel)[0];
  assert.equal(corpseContainer.rotation.z, frame.corpses[0].rotation);
  assert.ok(corpsePivot.rotation.x > 0.5, 'curl tumbles the corpse out of the flight plane');
  assert.ok(Math.abs(corpsePivot.rotation.y) > 0.1, 'corpse receives a stable tumble');
  assert.ok(sceneObjects(corpseContainer, (node) => node.userData.proceduralWing).every((wing) => wing.parent === corpsePivot));
  layer.destroy();
});

test('allocates fixed reusable combat pools and applies CSS-pixel projection data', async () => {
  const { allocationCounts, layer, renderer } = await createWorldLayerFixture();
  const scene = rendererScene(renderer, layer);
  const casings = sceneObjects(scene, (node) => node.userData.effectPool === 'casing');
  const impacts = sceneObjects(scene, (node) => node.userData.effectPool === 'impact');
  const fragments = sceneObjects(scene, (node) => node.userData.effectPool === 'fragment');
  assert.equal(casings.length, 20);
  assert.equal(impacts.length, 8);
  assert.equal(fragments.length, 36);
  assert.ok([...casings, ...impacts, ...fragments].every((mesh) => mesh.visible === false));

  const poolIdentities = [...casings, ...impacts, ...fragments];
  const allocationsBeforeRender = { ...allocationCounts };
  layer.render({
    insects: [],
    corpses: [],
    effects: {
      casings: [{ id: 1, x: 0.75, y: 0.25, rotation: 0.2 }],
      impacts: [{ id: 2, x: 330, y: 180, visible: false, scale: 1.5 }],
      fragments: [{ id: 3, x: 0.1, y: 0.9, rotation: -0.3, kind: 'chip' }],
      fluids: []
    }
  }, 0);
  assert.deepEqual(casings[0].position.toArray().slice(0, 2), [100, 200]);
  assert.deepEqual(fragments[0].position.toArray().slice(0, 2), [-160, -320]);
  assert.equal(impacts[0].visible, false);

  layer.render({
    insects: [],
    corpses: [],
    effects: {
      casings: [{ id: 1, x: 0.75, y: 0.25, rotation: 0.4 }],
      impacts: [{ id: 2, x: 330, y: 180, visible: true, scale: 1.5, markScale: 1.2, rotation: 0.4, opacity: 0.35, flashOpacity: 0.6 }],
      fragments: [{ id: 3, x: 0.1, y: 0.9, rotation: -0.1, kind: 'chip' }],
      fluids: []
    }
  }, 16);
  assert.equal(impacts[0].visible, true);
  assert.deepEqual(impacts[0].position.toArray().slice(0, 2), [130, 220]);
  assert.ok(impacts[0].scale.toArray().slice(0, 2).every((value) => Math.abs(value - 50.4) < 1e-9));
  assert.ok(Math.abs(impacts[0].rotation.z - 0.4) < 1e-9);
  assert.deepEqual({ ...allocationCounts }, allocationsBeforeRender);

  const impact = impacts[0];
  const flash = impact.children.find((child) => child.userData.impactFlash === true);
  const alphaData = impact.material.alphaMap.source.data.data;
  const alphaAt = (x, y) => alphaData[(y * 64 + x) * 4 + 1];
  assert.equal(impact.material.color.getHex(), 0x160f0b, 'the persistent mark has a dark center');
  assert.ok(alphaAt(32, 32) > 200, 'the shared alpha texture has an opaque impact center');
  assert.ok(alphaAt(50, 32) > alphaAt(50, 45), 'the shared alpha texture carries a radial fracture');
  assert.equal(flash.material.color.getHex(), 0xffc56b, 'the child plane provides the brief warm flash');
  assert.ok(Math.abs(impact.material.opacity - 0.35) < 1e-9);
  assert.ok(Math.abs(flash.material.opacity - 0.6) < 1e-9);

  const disposalCounts = { geometry: 0, mark: 0, flash: 0, texture: 0 };
  impact.geometry.addEventListener('dispose', () => { disposalCounts.geometry += 1; });
  impact.material.addEventListener('dispose', () => { disposalCounts.mark += 1; });
  flash.material.addEventListener('dispose', () => { disposalCounts.flash += 1; });
  impact.material.alphaMap.addEventListener('dispose', () => { disposalCounts.texture += 1; });
  layer.resetMission();
  assert.ok([...casings, ...impacts, ...fragments].every((mesh) => mesh.visible === false));
  assert.ok(impacts.every((mesh) => mesh.children.every((child) => child.visible === false)));
  const resetDiagnostics = layer.getDiagnostics();
  assert.deepEqual({
    casingCount: resetDiagnostics.casingCount,
    impactCount: resetDiagnostics.impactCount,
    fragmentCount: resetDiagnostics.fragmentCount
  }, {
    casingCount: 0,
    impactCount: 0,
    fragmentCount: 0
  });
  assert.deepEqual(disposalCounts, { geometry: 0, mark: 0, flash: 0, texture: 0 });
  assert.deepEqual({ ...allocationCounts }, allocationsBeforeRender);
  layer.render({
    insects: [],
    corpses: [],
    effects: {
      casings: [],
      impacts: [{ id: 4, x: 200, y: 400, visible: true, scale: 1, markScale: 1, opacity: 1, flashOpacity: 1 }],
      fragments: [],
      fluids: []
    }
  }, 32);
  assert.equal(impacts[0].visible, true);
  assert.equal(impacts[0].children[0].visible, true, 'a pooled flash is reusable after mission reset');
  assert.deepEqual({ ...allocationCounts }, allocationsBeforeRender);
  assert.deepEqual(
    sceneObjects(scene, (node) => node.userData.effectPool).map((mesh) => mesh),
    poolIdentities
  );
  layer.destroy();
  assert.deepEqual(disposalCounts, { geometry: 1, mark: 1, flash: 1, texture: 1 });

  function rendererScene(activeRenderer, activeLayer) {
    if (!activeRenderer.lastFrame) activeLayer?.render({ insects: [], corpses: [], effects: {} }, -1);
    return activeRenderer.lastFrame.scene;
  }
});

test('ordinary frame updates allocate nothing and do not recompile materials', async () => {
  const { allocationCounts, layer, renderer } = await createWorldLayerFixture();
  const frame = maximumWorldFrame();
  frame.effects.casings.push({ id: 1, x: 0.6, y: 0.4, rotation: 0 });
  frame.effects.impacts.push({ id: 2, x: 210, y: 330, visible: true, scale: 1 });
  frame.effects.fragments.push({ id: 3, x: 0.4, y: 0.6, rotation: 0, kind: 'chip' });
  layer.render(frame, 0);
  const allocations = { ...allocationCounts };
  const materials = new Set(sceneObjects(renderer.lastFrame.scene, (node) => node.isMesh)
    .map((mesh) => mesh.material)
    .flat());
  const versions = new Map([...materials].map((material) => [material, material.version]));

  frame.insects[0] = liveInsect(1, { wingPhase: 0.9, hitFlash: 1, bank: 0.2, depth: 0.95 });
  frame.corpses[0] = corpse(101, { curl: 1, opacity: 0.25, rotation: 0.8, depth: 0.88 });
  frame.effects.casings[0] = { id: 1, x: 0.61, y: 0.43, rotation: 0.3 };
  layer.render(frame, 16);

  assert.deepEqual({ ...allocationCounts }, allocations);
  assert.deepEqual(new Map([...materials].map((material) => [material, material.version])), versions);
  layer.destroy();
});

test('malformed and extreme descriptors remain finite or hidden without escaping render', async () => {
  const { layer, renderer } = await createWorldLayerFixture();
  const throwing = new Proxy([], {
    get(target, key, receiver) {
      if (key === 'length') throw new Error('hostile length');
      return Reflect.get(target, key, receiver);
    }
  });
  const hostileImpact = {
    x: Number.MAX_VALUE,
    y: Number.MAX_VALUE,
    get visible() { throw new Error('hostile visibility'); }
  };
  const hostileInsect = {
    id: 1,
    x: Number.MAX_VALUE,
    centerY: -Number.MAX_VALUE,
    height: Number.MAX_VALUE,
    widthScale: Number.MAX_VALUE,
    depth: Symbol('depth'),
    visible: true,
    appearance: { baseColor: Symbol('color') }
  };
  assert.doesNotThrow(() => layer.render({
    insects: [hostileInsect],
    corpses: throwing,
    effects: {
      casings: [{ x: Number.MAX_VALUE, y: Number.MAX_VALUE, rotation: Symbol('rotation') }],
      impacts: [hostileImpact],
      fragments: throwing,
      fluids: []
    }
  }, Symbol('time')));
  const matrices = sceneObjects(renderer.lastFrame.scene, (node) => node.isMesh && node.visible)
    .flatMap((mesh) => mesh.matrixWorld.elements);
  assert.ok(matrices.every(Number.isFinite));
  assert.equal(layer.getDiagnostics().impactCount, 0);

  assert.doesNotThrow(() => layer.render({
    insects: [liveInsect(2, {
      wingPhase: Number.MAX_VALUE,
      wingRate: Number.MAX_VALUE,
      bank: Number.MAX_VALUE
    })],
    corpses: [],
    effects: {}
  }, Number.MAX_VALUE));
  const extremeMatrices = sceneObjects(renderer.lastFrame.scene, (node) => node.isMesh && node.visible)
    .flatMap((mesh) => mesh.matrixWorld.elements);
  assert.ok(extremeMatrices.every(Number.isFinite));
  layer.destroy();
});

test('hostile descriptor getters cannot escape the Three render boundary', async () => {
  const { layer } = await createWorldLayerFixture();
  let idReads = 0;
  const hostile = {
    x: 200,
    centerY: 300,
    height: 90,
    visible: true,
    get id() {
      idReads += 1;
      if (idReads === 1) return 1;
      throw new Error('hostile id getter');
    },
    get opacity() { return Symbol('opacity'); }
  };
  assert.doesNotThrow(() => layer.render({ insects: [hostile], corpses: [], effects: {} }, 0));
  assert.equal(idReads >= 2, true);
  layer.destroy();
});

test('returns false in the same frame that the renderer reports a shader error', async () => {
  const { layer } = await createWorldLayerFixture({ shaderFailureOnRender: true });

  assert.equal(layer.render(maximumWorldFrame(), 0), false);
  const diagnostics = layer.getDiagnostics();
  assert.equal(diagnostics.shaderErrorCount, 1);
  assert.equal(diagnostics.renderCount, 0);
  layer.destroy();
});

test('returns false in the same frame as context loss and prevents the browser default', async () => {
  let prevented = false;
  const { layer } = await createWorldLayerFixture({
    contextLossOnRender: true,
    contextLossEvent: { preventDefault() { prevented = true; } }
  });

  assert.equal(layer.render(maximumWorldFrame(), 0), false);
  assert.equal(prevented, true);
  assert.equal(layer.getDiagnostics().contextLost, true);
  assert.equal(layer.render(maximumWorldFrame(), 16), false);
  layer.destroy();
});

test('load rejection releases renderer and listener ownership', async () => {
  const expectedFailure = new Error('fixture GLB load failure');
  const fixture = await createWorldLayerFixture({ modelUrl, loadError: expectedFailure, returnCreation: true });

  await assert.rejects(fixture.creation, expectedFailure);
  assert.deepEqual(fixture.requestedUrls, [modelUrl]);
  assert.equal(fixture.listeners.has('webglcontextlost'), false);
  assert.equal(fixture.renderer.renderListsDisposed, true);
  assert.equal(fixture.renderer.renderListsDisposeCount, 1);
  assert.equal(fixture.renderer.disposeCount, 1);
  assert.equal(fixture.renderer.forceContextLossCount, 1);
});

test('aliases missing species to a custom single-template model without throwing', async () => {
  const fixture = await createWorldLayerFixture({ modelUrl, modelKind: 'bulwark' });
  assert.deepEqual(fixture.requestedUrls, [modelUrl]);
  assert.doesNotThrow(() => fixture.layer.render({
    insects: [liveInsect(1, { modelKind: 'stinger', species: 'stinger' })],
    corpses: [],
    effects: {}
  }, 0));
  const root = fixture.renderer.lastFrame.scene.children.find((node) => node.userData.insectId === 1);
  assert.equal(root.userData.modelKind, 'stinger');
  assert.equal(sceneObjects(root, (node) => node.userData.insectModel)[0].userData.proceduralFallback, false);
  fixture.layer.destroy();
});

test('disposes a late-loaded source once when context is lost while loading', async () => {
  const loadGate = deferred();
  const fixture = await createWorldLayerFixture({ loadGate, returnCreation: true });
  let prevented = false;
  fixture.canvas.dispatch('webglcontextlost', { preventDefault() { prevented = true; } });
  loadGate.resolve();

  await assert.rejects(fixture.creation, /context lost/i);
  assert.equal(prevented, true);
  assert.deepEqual(fixture.source.sourceDisposals, {
    geometry: 1,
    material: 1,
    skeleton: 1,
    texture: 1
  });
  assert.equal(fixture.source.image.closeCount, 1);
  assert.equal(fixture.listeners.has('webglcontextlost'), false);
  assert.equal(fixture.renderer.disposeCount, 1);
  assert.equal(fixture.renderer.forceContextLossCount, 1);
});

test('an abort signal releases renderer ownership immediately and source ownership after a late load', async () => {
  const loadGate = deferred();
  const controller = new AbortController();
  const fixture = await createWorldLayerFixture({ loadGate, signal: controller.signal, returnCreation: true });
  controller.abort();
  assert.equal(fixture.listeners.has('webglcontextlost'), false);
  assert.equal(fixture.renderer.disposeCount, 1);
  assert.equal(fixture.renderer.forceContextLossCount, 1);

  loadGate.resolve();
  await assert.rejects(fixture.creation, (error) => error?.name === 'AbortError');
  assert.deepEqual(fixture.source.sourceDisposals, { geometry: 1, material: 1, skeleton: 1, texture: 1 });
  assert.equal(fixture.source.image.closeCount, 1);
  assert.equal(fixture.renderer.disposeCount, 1);
});

test('rolls back loaded source and partial fixed pools when an effect mesh constructor throws', async () => {
  const expectedFailure = new Error('fixture effect pool failure');
  const fixture = await createWorldLayerFixture({
    meshErrorAt: 22,
    meshError: expectedFailure,
    returnCreation: true
  });
  await assert.rejects(fixture.creation, expectedFailure);
  assert.deepEqual(fixture.source.sourceDisposals, { geometry: 1, material: 1, skeleton: 1, texture: 1 });
  assert.equal(fixture.source.image.closeCount, 1);
  assert.equal(fixture.listeners.size, 0);
  assert.equal(fixture.renderer.disposeCount, 1);
  assert.equal(fixture.renderer.forceContextLossCount, 1);
});

test('rolls back a fixed-pool mesh even when scene insertion succeeds before throwing', async () => {
  const expectedFailure = new Error('fixture post-insert effect failure');
  const fixture = await createWorldLayerFixture({
    effectSceneAddErrorAt: 5,
    effectSceneAddError: expectedFailure,
    returnCreation: true
  });
  await assert.rejects(fixture.creation, expectedFailure);
  assert.equal(sceneObjects(fixture.scene, (node) => node.userData.effectPool).length, 0);
  assert.deepEqual(fixture.source.sourceDisposals, { geometry: 1, material: 1, skeleton: 1, texture: 1 });
  assert.equal(fixture.source.image.closeCount, 1);
  assert.equal(fixture.renderer.disposeCount, 1);
});

test('resizes in CSS pixels with a hard 1.5 device-pixel-ratio cap', async () => {
  const { layer, renderer } = await createWorldLayerFixture();
  layer.resize(1280, 720, 9);

  assert.equal(renderer.pixelRatios[0], 1.5);
  assert.equal(renderer.pixelRatios.at(-1), 1.5);
  assert.deepEqual(renderer.sizes.at(-1), [1280, 720, false]);
  layer.render({ insects: [], corpses: [], effects: {} }, 0);
  assert.deepEqual({
    left: renderer.lastFrame.camera.left,
    right: renderer.lastFrame.camera.right,
    top: renderer.lastFrame.camera.top,
    bottom: renderer.lastFrame.camera.bottom
  }, { left: -640, right: 640, top: 360, bottom: -360 });
  layer.destroy();
});

test('cleans partial ownership when initial resize throws before model loading', async () => {
  const expectedFailure = new Error('fixture resize failure');
  const fixture = await createWorldLayerFixture({ resizeError: expectedFailure, returnCreation: true });

  await assert.rejects(fixture.creation, expectedFailure);
  assert.deepEqual(fixture.requestedUrls, []);
  assert.equal(fixture.listeners.has('webglcontextlost'), false);
  assert.equal(fixture.renderer.renderListsDisposed, true);
  assert.equal(fixture.renderer.renderListsDisposeCount, 1);
  assert.equal(fixture.renderer.disposeCount, 1);
  assert.equal(fixture.renderer.forceContextLossCount, 1);
});

test('cleans source and world ownership when an instance clone throws', async () => {
  const expectedFailure = new Error('fixture clone failure');
  const fixture = await createWorldLayerFixture({
    cloneSkeleton() { throw expectedFailure; }
  });

  assert.throws(() => fixture.layer.render({ insects: [liveInsect(1)], corpses: [], effects: {} }, 0), expectedFailure);
  fixture.layer.destroy();
  assert.deepEqual(fixture.source.sourceDisposals, { geometry: 1, material: 1, skeleton: 1, texture: 1 });
  assert.equal(fixture.source.image.closeCount, 1);
  assert.equal(fixture.listeners.size, 0);
  assert.equal(fixture.renderer.disposeCount, 1);
});

test('cleans partially cloned instance when scene insertion throws', async () => {
  const expectedFailure = new Error('fixture scene add failure');
  const fixture = await createWorldLayerFixture({ sceneAddError: expectedFailure });
  let clonedMaterialDisposals = 0;
  const Material = fixture.source.material.constructor;
  const originalClone = Material.prototype.clone;
  Material.prototype.clone = function clone() {
    const material = originalClone.call(this);
    material.addEventListener('dispose', () => { clonedMaterialDisposals += 1; });
    return material;
  };
  try {
    assert.throws(() => fixture.layer.render({ insects: [liveInsect(1)], corpses: [], effects: {} }, 0), expectedFailure);
  } finally {
    Material.prototype.clone = originalClone;
    fixture.layer.destroy();
  }
  assert.ok(clonedMaterialDisposals > 0);
  assert.equal(fixture.listeners.size, 0);
  assert.equal(fixture.renderer.disposeCount, 1);
});

test('disposes source and cloned resources exactly once across removal and repeated destroy', async () => {
  const { layer, renderer, source } = await createWorldLayerFixture();
  layer.render({ insects: [liveInsect(1), liveInsect(2)], corpses: [corpse(101)], effects: {} }, 0);
  const instanceRoots = renderer.lastFrame.scene.children.filter((node) => (
    node.userData.insectId !== undefined || node.userData.corpseId !== undefined
  ));
  const clonedMaterials = new Set(instanceRoots.flatMap((root) => (
    sceneObjects(root, (node) => node.name === 'BodyMesh').map((mesh) => mesh.material)
  )));
  const clonedSkeletons = new Set(instanceRoots.flatMap((root) => (
    sceneObjects(root, (node) => node.name === 'BodyMesh').map((mesh) => mesh.skeleton)
  )));
  const materialDisposals = new Map([...clonedMaterials].map((material) => [material, 0]));
  const skeletonDisposals = new Map([...clonedSkeletons].map((skeleton) => [skeleton, 0]));
  for (const material of clonedMaterials) {
    material.addEventListener('dispose', () => {
      materialDisposals.set(material, materialDisposals.get(material) + 1);
    });
  }
  for (const skeleton of clonedSkeletons) {
    const dispose = skeleton.dispose.bind(skeleton);
    skeleton.dispose = () => {
      skeletonDisposals.set(skeleton, skeletonDisposals.get(skeleton) + 1);
      dispose();
    };
  }

  layer.render({ insects: [liveInsect(2)], corpses: [], effects: {} }, 16);
  assert.deepEqual([...materialDisposals.values()].sort(), [0, 1, 1]);
  assert.deepEqual([...skeletonDisposals.values()].sort(), [0, 1, 1]);
  assert.deepEqual(source.sourceDisposals, { geometry: 0, material: 0, skeleton: 0, texture: 0 });

  layer.destroy();
  layer.destroy();
  assert.deepEqual([...materialDisposals.values()], [1, 1, 1]);
  assert.deepEqual([...skeletonDisposals.values()], [1, 1, 1]);
  assert.deepEqual(source.sourceDisposals, { geometry: 1, material: 1, skeleton: 1, texture: 1 });
  assert.equal(source.image.closeCount, 1);
});

test('one throwing clone disposal cannot prevent remaining clone and source teardown', async () => {
  const { layer, renderer, source } = await createWorldLayerFixture();
  layer.render({ insects: [liveInsect(1), liveInsect(2)], corpses: [], effects: {} }, 0);
  const bodyMaterials = sceneObjects(renderer.lastFrame.scene, (node) => node.name === 'BodyMesh')
    .map((mesh) => mesh.material);
  bodyMaterials[0].dispose = () => { throw new Error('fixture disposal failure'); };
  let secondDisposed = 0;
  bodyMaterials[1].addEventListener('dispose', () => { secondDisposed += 1; });
  assert.doesNotThrow(() => layer.destroy());
  assert.equal(secondDisposed, 1);
  assert.deepEqual(source.sourceDisposals, { geometry: 1, material: 1, skeleton: 1, texture: 1 });
  assert.equal(source.image.closeCount, 1);
});

test('closes every unique decoded image in array-backed texture sources exactly once', async () => {
  const { layer, source } = await createWorldLayerFixture({ arrayTextureSource: true });
  layer.destroy();
  layer.destroy();
  assert.deepEqual(source.images.map((image) => image.closeCount), [1, 1]);
  assert.deepEqual(source.sourceDisposals, { geometry: 1, material: 1, skeleton: 1, texture: 1 });
});

test('removes the exact context-loss listener and makes destroy idempotent', async () => {
  const { layer, listenerAdds, listenerRemovals, listeners, renderer } = await createWorldLayerFixture();
  assert.equal(listenerAdds.length, 1);
  const [type, handler, capture] = listenerAdds[0];
  assert.deepEqual([type, capture], ['webglcontextlost', false]);

  layer.destroy();
  layer.destroy();
  assert.equal(listenerRemovals.length, 1);
  assert.equal(listenerRemovals[0][0], type);
  assert.equal(listenerRemovals[0][1], handler);
  assert.equal(listenerRemovals[0][2], capture);
  assert.equal(listeners.size, 0);
  assert.equal(renderer.disposeCount, 1);
  assert.equal(renderer.forceContextLossCount, 1);
  assert.equal(renderer.renderListsDisposeCount, 1);
});

test('reports stable world diagnostics before and after teardown', async () => {
  const { layer } = await createWorldLayerFixture();
  const frame = maximumWorldFrame();
  frame.effects.casings.push({ id: 1, x: 0.5, y: 0.5, rotation: 0 });
  frame.effects.impacts.push({ id: 2, x: 200, y: 400, visible: true, scale: 1 });
  frame.effects.fragments.push({ id: 3, x: 0.5, y: 0.5, rotation: 0, kind: 'chip' });
  frame.effects.fluids.push({ id: 4, x: 0.5, y: 0.5, rotation: 0, kind: 'fluid' });
  assert.equal(layer.render(frame, 0), true);

  assert.deepEqual(layer.getDiagnostics(), {
    liveInsectCount: 6,
    corpseCount: 4,
    sourceGeometryCount: 1,
    sourceMaterialCount: 1,
    sourceTextureCount: 1,
    speciesSourceCount: 4,
    speciesFallbackCount: 0,
    speciesModelKinds: ['swarmer', 'stinger', 'bulwark', 'queen'],
    casingCount: 1,
    impactCount: 1,
    fragmentCount: 2,
    programCount: 1,
    shaderErrorCount: 0,
    renderCount: 1,
    modelReady: true,
    destroyed: false,
    contextLost: false
  });
  layer.destroy();
  assert.deepEqual(layer.getDiagnostics(), {
    liveInsectCount: 0,
    corpseCount: 0,
    sourceGeometryCount: 0,
    sourceMaterialCount: 0,
    sourceTextureCount: 0,
    speciesSourceCount: 0,
    speciesFallbackCount: 0,
    speciesModelKinds: [],
    casingCount: 0,
    impactCount: 0,
    fragmentCount: 0,
    programCount: 1,
    shaderErrorCount: 0,
    renderCount: 1,
    modelReady: false,
    destroyed: true,
    contextLost: false
  });
});
