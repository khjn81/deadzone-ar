import { GLTFLoader, THREE as bundledThree, cloneSkeleton as bundledCloneSkeleton } from './vendor/three-runtime.mjs';
import { SPECIES_PROFILES, speciesProfile } from './species-profile.mjs';

const MODEL_URL = new URL('../assets/models/infected-swarmer.glb', import.meta.url).href;
const SPECIES_ORDER = Object.freeze(['swarmer', 'stinger', 'bulwark', 'queen']);
const MODEL_URLS = Object.freeze(Object.fromEntries(
  SPECIES_ORDER.map((kind) => [kind, speciesProfile(kind).modelUrl])
));
const MAX_LIVE = 6;
const MAX_CORPSES = 4;
const DEPTH_GAP = 4;

const WING_STYLES = Object.freeze({
  mosquito: Object.freeze({ rootX: 0.11, rootY: 0.05, rootZ: 0.015, spread: 0.08, beat: 0.16, scaleX: 1, scaleY: 1, opacity: 0.235 }),
  wasp: Object.freeze({ rootX: 0.13, rootY: 0.06, rootZ: 0.018, spread: 0.11, beat: 0.19, scaleX: 1.05, scaleY: 0.88, opacity: 0.255 }),
  shell: Object.freeze({ rootX: 0.2, rootY: 0.105, rootZ: 0.02, spread: 0.44, beat: 0.035, scaleX: 0.72, scaleY: 0.62, opacity: 0.205 }),
  queen: Object.freeze({ rootX: 0.18, rootY: 0.095, rootZ: 0.022, spread: 0.16, beat: 0.22, scaleX: 1.26, scaleY: 1.32, opacity: 0.28 })
});
const WEAK_POINT_STYLES = Object.freeze({
  abdomen: Object.freeze({ x: 0, y: 0, z: 0.34, scale: 1, rotation: 0 }),
  'side-plate': Object.freeze({ x: 0.23, y: 0.06, z: 0.3, scale: 0.92, rotation: -0.35 }),
  'thorax-core': Object.freeze({ x: 0, y: 0.1, z: 0.36, scale: 1.42, rotation: 0 })
});

const number = (value, fallback = 0) => {
  try {
    const result = Number(value);
    return Number.isFinite(result) ? result : fallback;
  } catch {
    return fallback;
  }
};
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const propertyOf = (source, key, fallback) => {
  try { return source == null ? fallback : source[key]; } catch { return fallback; }
};
const unitTurn = (value) => {
  const wrapped = number(value, 0) % 1;
  return wrapped < 0 ? wrapped + 1 : wrapped;
};
const ownSpecies = (value) => typeof value === 'string' && Object.hasOwn(SPECIES_PROFILES, value) ? value : null;
const normalizeModelKind = (value) => ownSpecies(value) || 'stinger';
const modelKindFromDescriptor = (descriptor) => {
  const species = propertyOf(descriptor, 'species', undefined);
  const modelKind = propertyOf(descriptor, 'modelKind', undefined);
  return normalizeModelKind(ownSpecies(species) || modelKind);
};
const wingStyleFromDescriptor = (descriptor, modelKind) => {
  const candidate = propertyOf(descriptor, 'wingStyle', undefined);
  if (typeof candidate === 'string' && Object.hasOwn(WING_STYLES, candidate)) return candidate;
  return speciesProfile(modelKind).wingStyle;
};
const weakPointStyleFromDescriptor = (descriptor, modelKind) => {
  const candidate = propertyOf(descriptor, 'weakPointStyle', undefined);
  if (typeof candidate === 'string' && Object.hasOwn(WEAK_POINT_STYLES, candidate)) return candidate;
  return speciesProfile(modelKind).weakPointStyle;
};
const deathStyleFromDescriptor = (descriptor, modelKind) => {
  const candidate = propertyOf(descriptor, 'deathStyle', undefined);
  return typeof candidate === 'string' && candidate ? candidate : speciesProfile(modelKind).deathStyle;
};
const silhouetteFromDescriptor = (descriptor, modelKind) => {
  const profileSilhouette = speciesProfile(modelKind).silhouette;
  const candidate = propertyOf(descriptor, 'silhouette', profileSilhouette) || profileSilhouette;
  return {
    bodyWidth: clamp(number(propertyOf(candidate, 'bodyWidth', profileSilhouette.bodyWidth), profileSilhouette.bodyWidth), 0.55, 1.5),
    bodyHeight: clamp(number(propertyOf(candidate, 'bodyHeight', profileSilhouette.bodyHeight), profileSilhouette.bodyHeight), 0.65, 1.4),
    headScale: clamp(number(propertyOf(candidate, 'headScale', profileSilhouette.headScale), profileSilhouette.headScale), 0.55, 1.35),
    abdomenScale: clamp(number(propertyOf(candidate, 'abdomenScale', profileSilhouette.abdomenScale), profileSilhouette.abdomenScale), 0.6, 1.5),
    wingSpan: clamp(number(propertyOf(candidate, 'wingSpan', profileSilhouette.wingSpan), profileSilhouette.wingSpan), 0.55, 1.5),
    wingDepth: clamp(number(propertyOf(candidate, 'wingDepth', profileSilhouette.wingDepth), profileSilhouette.wingDepth), 0.55, 1.5),
    weakPointScale: clamp(number(propertyOf(candidate, 'weakPointScale', profileSilhouette.weakPointScale), profileSilhouette.weakPointScale), 0.6, 1.35)
  };
};
const depthOrder = (left, right) => number(propertyOf(right.descriptor, 'depth', 1), 1)
  - number(propertyOf(left.descriptor, 'depth', 1), 1);
const safeDispose = (resource) => { try { resource?.dispose?.(); } catch {} };

function emptySourceAssets() {
  return { geometries: new Set(), materials: new Set(), textures: new Set(), skeletons: new Set() };
}

function sourceAssets(root, assets = emptySourceAssets()) {
  root.traverse((node) => {
    if (node.geometry?.isBufferGeometry) assets.geometries.add(node.geometry);
    if (node.isSkinnedMesh && node.skeleton) assets.skeletons.add(node.skeleton);
    const nodeMaterials = Array.isArray(node.material) ? node.material : [node.material];
    for (const material of nodeMaterials) {
      if (!material?.isMaterial) continue;
      assets.materials.add(material);
      for (const value of Object.values(material)) {
        if (value?.isTexture) assets.textures.add(value);
      }
    }
  });
  return assets;
}

function disposeSource(assets) {
  if (!assets) return;
  const closedImages = new Set();
  const closeImage = (image) => {
    if (!image || closedImages.has(image)) return;
    closedImages.add(image);
    if (Array.isArray(image)) {
      for (const item of image) closeImage(item);
      return;
    }
    try { image.close?.(); } catch {}
  };
  for (const skeleton of assets.skeletons) safeDispose(skeleton);
  for (const material of assets.materials) safeDispose(material);
  for (const geometry of assets.geometries) safeDispose(geometry);
  for (const texture of assets.textures) {
    const image = texture?.source?.data ?? texture?.image;
    safeDispose(texture);
    closeImage(image);
  }
  assets.skeletons.clear();
  assets.materials.clear();
  assets.geometries.clear();
  assets.textures.clear();
  closedImages.clear();
}

function cloneMaterials(root, ownedMaterials) {
  root.traverse((node) => {
    if (!node.isMesh || !node.material) return;
    node.castShadow = false;
    node.receiveShadow = false;
    node.frustumCulled = false;
    const copy = (material) => {
      const clone = material.clone();
      clone.userData.insectBaseOpacity = number(material.opacity, 1);
      clone.userData.insectBaseDepthWrite = material.depthWrite !== false;
      ownedMaterials.add(clone);
      return clone;
    };
    node.material = Array.isArray(node.material) ? node.material.map(copy) : copy(node.material);
  });
}

function collectSkeletons(root, target) {
  root.traverse((node) => {
    if (node.isSkinnedMesh && node.skeleton) target.add(node.skeleton);
  });
}

function disposeInstanceResources(instance) {
  if (!instance || instance.disposed) return;
  instance.disposed = true;
  for (const material of instance.ownedMaterials || []) safeDispose(material);
  for (const skeleton of instance.ownedSkeletons || []) safeDispose(skeleton);
  instance.ownedMaterials?.clear?.();
  instance.ownedSkeletons?.clear?.();
}

function normalizeSource(THREE, root) {
  const bounds = new THREE.Box3().setFromObject(root);
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  const baseHeight = Math.max(0.001, number(size.y, 1));
  return {
    scale: 1 / baseHeight,
    x: -center.x / baseHeight,
    y: -center.y / baseHeight,
    z: -center.z / baseHeight
  };
}

function createFallbackSource(THREE, assets) {
  const root = new THREE.Group();
  root.name = 'ProceduralInsectFallback';
  root.userData.proceduralFallback = true;
  const geometry = new THREE.SphereGeometry(0.46, 10, 7);
  const material = new THREE.MeshStandardMaterial({
    color: 0x25271d,
    roughness: 0.72,
    metalness: 0.08
  });
  const body = new THREE.Mesh(geometry, material);
  body.name = 'ProceduralFallbackBody';
  body.userData.proceduralFallback = true;
  body.scale.set(1, 1.18, 0.72);
  root.add(body);
  sourceAssets(root, assets);
  return {
    root,
    normalization: normalizeSource(THREE, root),
    fallback: true
  };
}

export async function createThreeInsectScene(scene, runtime = {}, options = {}) {
  const THREE = runtime.THREE || bundledThree;
  const Loader = runtime.GLTFLoader || GLTFLoader;
  const cloneSkeleton = runtime.cloneSkeleton || bundledCloneSkeleton;
  const reducedMotion = propertyOf(options, 'reducedMotion', false) === true;
  const assets = emptySourceAssets();
  const templates = new Map();
  const sourceKinds = new Set();
  const fallbackKinds = new Set();
  let fallbackTemplate = null;
  let wingGeometry = null;
  let wingMaterial = null;
  let armorGeometry = null;
  let armorSpikeGeometry = null;
  let armorMaterial = null;
  let weakPointGeometry = null;
  let weakPointMaterial = null;

  try {
    const modelUrlOverride = propertyOf(options, 'modelUrl', undefined);
    const modelKindOverride = propertyOf(options, 'modelKind', 'swarmer');
    const strictSingleTemplate = modelUrlOverride !== undefined && modelUrlOverride !== null;
    const entries = strictSingleTemplate
      ? [{ kind: normalizeModelKind(modelKindOverride || 'swarmer'), url: modelUrlOverride || MODEL_URL }]
      : SPECIES_ORDER.map((kind) => ({
        kind,
        url: propertyOf(propertyOf(options, 'modelUrls', null), kind, MODEL_URLS[kind]) || MODEL_URLS[kind]
      }));
    const results = await Promise.all(entries.map(async ({ kind, url }) => {
      try {
        const gltf = await new Loader().loadAsync(url);
        if (!gltf?.scene || typeof gltf.scene.traverse !== 'function') {
          throw new Error(`Insect ${kind} GLB did not contain a renderable scene`);
        }
        const root = gltf.scene;
        sourceAssets(root, assets);
        return { kind, root, normalization: normalizeSource(THREE, root), fallback: false };
      } catch (error) {
        if (strictSingleTemplate) throw error;
        return { kind, error, fallback: true };
      }
    }));
    for (const result of results) {
      if (!result.fallback) {
        templates.set(result.kind, result);
        sourceKinds.add(result.kind);
      } else {
        fallbackKinds.add(result.kind);
      }
    }
    if (fallbackKinds.size > 0 || templates.size === 0) {
      fallbackTemplate = createFallbackSource(THREE, assets);
      for (const kind of fallbackKinds) templates.set(kind, { ...fallbackTemplate, kind, fallback: true });
      if (templates.size === 0) {
        fallbackKinds.add('stinger');
        templates.set('stinger', { ...fallbackTemplate, kind: 'stinger', fallback: true });
      }
    }
    if (!templates.has('stinger')) {
      const sourceTemplate = templates.get('swarmer')
        || fallbackTemplate
        || templates.values().next().value;
      if (sourceTemplate) templates.set('stinger', {
        ...sourceTemplate,
        kind: 'stinger',
        fallback: Boolean(sourceTemplate.fallback)
      });
    }
    wingGeometry = new THREE.BufferGeometry();
    wingGeometry.setAttribute('position', new THREE.Float32BufferAttribute([
      0, -0.018, 0,
      0, 0.022, 0,
      0.12, 0.062, 0,
      0.34, 0.086, 0,
      0.58, 0.058, 0,
      0.7, 0.006, 0,
      0.6, -0.027, 0,
      0.36, -0.064, 0,
      0.14, -0.048, 0
    ], 3));
    wingGeometry.setIndex([
      0, 1, 2,
      0, 2, 8,
      8, 2, 3,
      8, 3, 7,
      7, 3, 4,
      7, 4, 6,
      6, 4, 5
    ]);
    wingGeometry.computeVertexNormals();
    wingMaterial = new THREE.MeshBasicMaterial({
      color: 0xc8d2bc,
      transparent: true,
      opacity: 0.235,
      depthWrite: false,
      side: THREE.DoubleSide
    });
    armorGeometry = new THREE.SphereGeometry(0.25, 8, 6);
    armorSpikeGeometry = new THREE.ConeGeometry(0.13, 0.42, 6);
    armorMaterial = new THREE.MeshStandardMaterial({
      color: 0x687028,
      roughness: 0.48,
      metalness: 0.28
    });
    weakPointGeometry = new THREE.SphereGeometry(0.085, 8, 6);
    weakPointMaterial = new THREE.MeshBasicMaterial({ color: 0xd7ef42 });
  } catch (error) {
    safeDispose(wingGeometry);
    safeDispose(wingMaterial);
    safeDispose(armorGeometry);
    safeDispose(armorSpikeGeometry);
    safeDispose(armorMaterial);
    safeDispose(weakPointGeometry);
    safeDispose(weakPointMaterial);
    disposeSource(assets);
    templates.clear();
    sourceKinds.clear();
    fallbackKinds.clear();
    fallbackTemplate = null;
    throw error;
  }

  const live = new Map();
  const corpses = new Map();
  const liveList = [];
  const corpseList = [];
  const liveIds = new Set();
  const corpseIds = new Set();
  const depthScratch = [];
  const boundsScratch = new THREE.Box3();
  let destroyed = false;

  function createInstance(descriptor, corpse, descriptorId) {
    const instance = {
      container: null,
      pivot: null,
      model: null,
      wings: [],
      ownedMaterials: new Set(),
      ownedSkeletons: new Set(),
      armor: [],
      armorMaterial: null,
      weakPoint: null,
      weakPointMaterial: null,
      wingMaterial: null,
      descriptor,
      modelKind: modelKindFromDescriptor(descriptor),
      wingStyle: null,
      weakPointStyle: null,
      deathStyle: null,
      silhouette: null,
      disposed: false,
      depthOffset: 0
    };
    let added = false;
    try {
      const modelKind = instance.modelKind;
      const template = templates.get(modelKind) || templates.get('stinger') || fallbackTemplate;
      if (!template?.root) throw new Error(`Missing insect template for ${modelKind}`);
      instance.wingStyle = wingStyleFromDescriptor(descriptor, modelKind);
      instance.weakPointStyle = weakPointStyleFromDescriptor(descriptor, modelKind);
      instance.deathStyle = deathStyleFromDescriptor(descriptor, modelKind);
      instance.silhouette = silhouetteFromDescriptor(descriptor, modelKind);
      instance.container = new THREE.Group();
      instance.container.userData.species = modelKind;
      instance.container.userData.modelKind = modelKind;
      instance.pivot = new THREE.Group();
      instance.pivot.userData.insectModel = true;
      instance.pivot.userData.proceduralFallback = Boolean(template.fallback || template.root.userData?.proceduralFallback);
      instance.pivot.userData.modelKind = modelKind;
      instance.model = cloneSkeleton(template.root);
      if (!instance.model || typeof instance.model.traverse !== 'function') {
        throw new Error('Insect template clone was not renderable');
      }
      instance.model.userData.proceduralFallback = Boolean(template.fallback || template.root.userData?.proceduralFallback);
      instance.model.userData.modelKind = modelKind;
      cloneMaterials(instance.model, instance.ownedMaterials);
      collectSkeletons(instance.model, instance.ownedSkeletons);
      instance.model.scale.setScalar(template.normalization.scale);
      instance.model.position.set(template.normalization.x, template.normalization.y, template.normalization.z);
      instance.pivot.add(instance.model);

      instance.wingMaterial = wingMaterial.clone();
      instance.wingMaterial.userData.insectBaseOpacity = number(wingMaterial.opacity, 0.235);
      instance.wingMaterial.userData.insectBaseDepthWrite = false;
      instance.ownedMaterials.add(instance.wingMaterial);

      for (const side of [-1, 1]) {
        const wing = new THREE.Mesh(wingGeometry, instance.wingMaterial);
        wing.userData.proceduralWing = true;
        wing.userData.wingSide = side;
        const wingStyle = WING_STYLES[instance.wingStyle] || WING_STYLES.mosquito;
        wing.position.set(side * wingStyle.rootX, wingStyle.rootY, wingStyle.rootZ);
        wing.scale.set(
          side * wingStyle.scaleX * instance.silhouette.wingSpan,
          wingStyle.scaleY * instance.silhouette.wingDepth,
          1
        );
        wing.rotation.y = side * 0.06;
        instance.pivot.add(wing);
        instance.wings.push(wing);
      }

      instance.armorMaterial = armorMaterial.clone();
      instance.armorMaterial.userData.insectBaseOpacity = 1;
      instance.armorMaterial.userData.insectBaseDepthWrite = true;
      instance.ownedMaterials.add(instance.armorMaterial);
      const armorParts = [
        [armorGeometry, 0, 0.15, 0.1],
        [armorSpikeGeometry, -0.22, 0.08, 0.18],
        [armorSpikeGeometry, 0.22, 0.08, 0.18]
      ];
      for (const [geometry, x, y, z] of armorParts) {
        const armor = new THREE.Mesh(geometry, instance.armorMaterial);
        armor.userData.armorPart = true;
        armor.userData.shellArmor = modelKind === 'bulwark';
        armor.userData.queenArmor = modelKind === 'queen' || propertyOf(descriptor, 'elite', false) === true;
        armor.position.set(x, y, z);
        instance.pivot.add(armor);
        instance.armor.push(armor);
      }

      instance.weakPointMaterial = weakPointMaterial.clone();
      instance.weakPointMaterial.userData.insectBaseOpacity = 1;
      instance.weakPointMaterial.userData.insectBaseDepthWrite = true;
      instance.ownedMaterials.add(instance.weakPointMaterial);
      instance.weakPoint = new THREE.Mesh(weakPointGeometry, instance.weakPointMaterial);
      instance.weakPoint.userData.insectWeakPoint = true;
      const weakPointStyle = WEAK_POINT_STYLES[instance.weakPointStyle] || WEAK_POINT_STYLES.abdomen;
      instance.weakPoint.position.set(weakPointStyle.x, weakPointStyle.y, weakPointStyle.z);
      instance.weakPoint.rotation.z = weakPointStyle.rotation;
      instance.pivot.add(instance.weakPoint);

      instance.container.userData[corpse ? 'corpseId' : 'insectId'] = descriptorId;
      instance.container.add(instance.pivot);
      added = true;
      scene.add(instance.container);
      return instance;
    } catch (error) {
      if (added && instance.container) { try { scene.remove(instance.container); } catch {} }
      disposeInstanceResources(instance);
      try { instance.container?.clear?.(); } catch {}
      throw error;
    }
  }

  function dispose(instance) {
    if (!instance) return;
    if (instance.container) { try { scene.remove(instance.container); } catch {} }
    disposeInstanceResources(instance);
    try { instance.container?.clear?.(); } catch {}
  }

  function fillDescriptors(input, max, result, ids) {
    result.length = 0;
    ids.clear();
    if (!Array.isArray(input)) return result;
    const length = Math.max(0, Math.min(1024, Math.floor(number(propertyOf(input, 'length', 0), 0))));
    for (let index = 0; index < length && result.length < max; index += 1) {
      let descriptor;
      try { descriptor = input[index]; } catch { continue; }
      const id = propertyOf(descriptor, 'id', undefined);
      if (!descriptor || id === undefined || ids.has(id)) continue;
      ids.add(id);
      result.push(descriptor);
    }
    return result;
  }

  function paint(instance, descriptor) {
    const appearance = propertyOf(descriptor, 'appearance', {}) || {};
    const profile = speciesProfile(instance.modelKind);
    const baseColor = number(propertyOf(appearance, 'baseColor', profile.baseColor), profile.baseColor);
    const colorLift = clamp(number(propertyOf(appearance, 'colorLift', 0)), -0.08, 0.08);
    for (const material of instance.ownedMaterials) {
      if (material === instance.wingMaterial || material === instance.weakPointMaterial || material === instance.armorMaterial) continue;
      if (material.color) material.color.set(baseColor).offsetHSL(0, 0, colorLift);
      if ('roughness' in material) material.roughness = number(propertyOf(appearance, 'roughness', material.roughness), material.roughness);
      if ('metalness' in material) material.metalness = number(propertyOf(appearance, 'metalness', material.metalness), material.metalness);
      if (material.emissive) {
        material.emissive.set(number(propertyOf(appearance, 'fluidColor', profile.fluidColor), profile.fluidColor));
        material.emissiveIntensity = clamp(number(propertyOf(descriptor, 'hitFlash', 0)), 0, 1);
      }
    }
    const wingStyle = WING_STYLES[instance.wingStyle] || WING_STYLES.mosquito;
    instance.wingMaterial.color.set(number(propertyOf(appearance, 'wingTint', profile.wingTint), profile.wingTint));
    const descriptorOpacity = number(propertyOf(descriptor, 'opacity', NaN), NaN);
    const fadeOpacity = Number.isFinite(descriptorOpacity) ? clamp(descriptorOpacity, 0, 1) : 1;
    instance.wingMaterial.opacity = wingStyle.opacity * fadeOpacity;
    instance.wingMaterial.userData.insectBaseOpacity = wingStyle.opacity;
    instance.weakPointMaterial.color.set(number(propertyOf(appearance, 'weakPointColor', profile.weakPointColor), profile.weakPointColor));
    const weakPointStyle = WEAK_POINT_STYLES[instance.weakPointStyle] || WEAK_POINT_STYLES.abdomen;
    const eliteScale = propertyOf(descriptor, 'elite', false) === true ? 1.35 : 1;
    instance.weakPoint.position.set(weakPointStyle.x, weakPointStyle.y, weakPointStyle.z);
    instance.weakPoint.rotation.z = weakPointStyle.rotation;
    instance.weakPoint.scale.setScalar(weakPointStyle.scale * eliteScale * instance.silhouette.weakPointScale);
    if (instance.armorMaterial?.color) {
      instance.armorMaterial.color.set(number(propertyOf(appearance, 'fluidColor', profile.fluidColor), profile.fluidColor));
    }
  }

  function updateSet(input, map, corpse, now, viewport, list, ids) {
    fillDescriptors(input, corpse ? MAX_CORPSES : MAX_LIVE, list, ids);
    for (const [id, instance] of map) {
      if (!ids.has(id)) {
        dispose(instance);
        map.delete(id);
      }
    }
    for (let index = 0; index < list.length; index += 1) {
      const descriptor = list[index];
      const id = propertyOf(descriptor, 'id', undefined);
      const modelKind = modelKindFromDescriptor(descriptor);
      let instance = map.get(id);
      if (instance && instance.modelKind !== modelKind) {
        dispose(instance);
        map.delete(id);
        instance = null;
      }
      if (!instance) {
        instance = createInstance(descriptor, corpse, id);
        map.set(id, instance);
      }
      const coordinateLimit = Math.max(1, viewport.width, viewport.height) * 4;
      const height = clamp(number(propertyOf(descriptor, 'height', 1), 1), 1, Math.max(1, viewport.width, viewport.height));
      const elite = propertyOf(descriptor, 'elite', false) === true;
      const opacity = corpse ? clamp(number(propertyOf(descriptor, 'opacity', 1), 1), 0, 1) : 1;
      instance.descriptor = descriptor;
      instance.wingStyle = wingStyleFromDescriptor(descriptor, modelKind);
      instance.weakPointStyle = weakPointStyleFromDescriptor(descriptor, modelKind);
      instance.deathStyle = deathStyleFromDescriptor(descriptor, modelKind);
      instance.container.userData.species = modelKind;
      instance.container.userData.modelKind = modelKind;
      instance.container.visible = propertyOf(descriptor, 'visible', false) !== false;
      instance.container.position.set(
        clamp(number(propertyOf(descriptor, 'x', 0)), -coordinateLimit, coordinateLimit) - viewport.width / 2,
        viewport.height / 2 - clamp(number(propertyOf(descriptor, 'centerY', 0)), -coordinateLimit, coordinateLimit),
        0
      );
      instance.pivot.scale.set(
        height * clamp(number(propertyOf(descriptor, 'widthScale', 1), 1), 0.01, 2.5) * instance.silhouette.bodyWidth,
        height * instance.silhouette.bodyHeight,
        height
      );
      const wingStyle = WING_STYLES[instance.wingStyle] || WING_STYLES.mosquito;
      for (const wing of instance.wings) {
        const side = number(wing.userData.wingSide, 1) < 0 ? -1 : 1;
        wing.position.set(side * wingStyle.rootX, wingStyle.rootY, wingStyle.rootZ);
        wing.scale.set(
          side * wingStyle.scaleX * instance.silhouette.wingSpan,
          wingStyle.scaleY * instance.silhouette.wingDepth,
          1
        );
      }
      for (const armor of instance.armor) {
        armor.visible = elite || modelKind === 'queen' || modelKind === 'bulwark';
        armor.userData.queenArmor = elite || modelKind === 'queen';
        armor.userData.shellArmor = modelKind === 'bulwark';
      }
      if (corpse) {
        instance.container.rotation.z = clamp(number(propertyOf(descriptor, 'rotation', 0)), -Math.PI * 4, Math.PI * 4);
        const curl = clamp(number(propertyOf(descriptor, 'curl', 0)), 0, 1);
        if (instance.deathStyle === 'shell-roll') {
          instance.pivot.rotation.set(0.72 + curl * 0.35, 0.58 + curl * 0.18, 0.08);
        } else if (instance.deathStyle === 'queen-collapse') {
          instance.pivot.rotation.set(0.92 + curl * 0.22, 0.18 + curl * 0.1, -0.12);
        } else if (instance.deathStyle === 'curl') {
          instance.pivot.rotation.set(Math.max(0.55, curl * 0.9), 0.35 + curl * 0.3, 0);
        } else {
          instance.pivot.rotation.set(Math.max(0.55, curl * 0.9), 0.26 + curl * 0.22, 0);
        }
        instance.pivot.position.y = -height * 0.12;
        for (const wing of instance.wings) {
          const side = number(wing.userData.wingSide, 1) < 0 ? -1 : 1;
          const folded = instance.deathStyle === 'shell-roll' ? 0.92 : instance.deathStyle === 'queen-collapse' ? 0.42 : 0.62;
          wing.rotation.z = side * folded;
        }
        for (const material of instance.ownedMaterials) {
          material.transparent = true;
          material.opacity = opacity * number(material.userData.insectBaseOpacity, 1);
          material.depthWrite = false;
        }
      } else {
        const phaseTurns = unitTurn(propertyOf(descriptor, 'wingPhase', 0));
        const elapsedSeconds = (number(now, 0) % 60000) / 1000;
        const wingRate = clamp(number(propertyOf(descriptor, 'wingRate', 1), 1), -10, 10);
        const angle = reducedMotion ? 0 : unitTurn(phaseTurns + elapsedSeconds * wingRate) * Math.PI * 2;
        instance.container.rotation.z = 0;
        instance.pivot.position.y = 0;
        instance.pivot.rotation.set(0, 0, clamp(number(propertyOf(descriptor, 'bank', 0)), -0.8, 0.8) + Math.sin(angle) * 0.01);
        const wingSpread = wingStyle.spread + Math.sin(angle) * wingStyle.beat;
        for (const wing of instance.wings) {
          const side = number(wing.userData.wingSide, 1) < 0 ? -1 : 1;
          wing.rotation.z = side * wingSpread;
        }
      }
      paint(instance, descriptor);
    }
  }

  function layoutDepth() {
    depthScratch.length = 0;
    for (const instance of live.values()) depthScratch.push(instance);
    for (const instance of corpses.values()) depthScratch.push(instance);
    for (let index = 1; index < depthScratch.length; index += 1) {
      const value = depthScratch[index];
      let insertion = index - 1;
      while (insertion >= 0 && depthOrder(depthScratch[insertion], value) > 0) {
        depthScratch[insertion + 1] = depthScratch[insertion];
        insertion -= 1;
      }
      depthScratch[insertion + 1] = value;
    }

    let cursor = 0;
    for (let index = 0; index < depthScratch.length; index += 1) {
      const instance = depthScratch[index];
      instance.container.position.z = 0;
      boundsScratch.setFromObject(instance.container);
      const min = number(boundsScratch.min.z);
      const max = number(boundsScratch.max.z);
      const extent = Math.max(0.001, max - min);
      instance.depthOffset = cursor - min;
      cursor += extent + DEPTH_GAP;
    }
    const nearestMax = Math.max(0, cursor - DEPTH_GAP);
    for (let index = 0; index < depthScratch.length; index += 1) {
      const instance = depthScratch[index];
      instance.container.position.z = instance.depthOffset - nearestMax;
    }
  }

  function renderLive(input, now, viewport) {
    if (destroyed) return 0;
    updateSet(input, live, false, now, viewport, liveList, liveIds);
    layoutDepth();
    return liveList.length;
  }

  function renderCorpses(input, now, viewport) {
    if (destroyed) return 0;
    updateSet(input, corpses, true, now, viewport, corpseList, corpseIds);
    layoutDepth();
    return corpseList.length;
  }

  function getDiagnostics() {
    return {
      liveInsectCount: live.size,
      corpseCount: corpses.size,
      sourceGeometryCount: assets?.geometries?.size || 0,
      sourceMaterialCount: assets?.materials?.size || 0,
      sourceTextureCount: assets?.textures?.size || 0,
      speciesSourceCount: sourceKinds.size,
      speciesFallbackCount: fallbackKinds.size,
      speciesModelKinds: SPECIES_ORDER.filter((kind) => templates.has(kind) && sourceKinds.has(kind))
    };
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    for (const item of live.values()) dispose(item);
    for (const item of corpses.values()) dispose(item);
    live.clear();
    corpses.clear();
    liveList.length = 0;
    corpseList.length = 0;
    depthScratch.length = 0;
    liveIds.clear();
    corpseIds.clear();
    safeDispose(wingGeometry);
    safeDispose(wingMaterial);
    safeDispose(armorGeometry);
    safeDispose(armorSpikeGeometry);
    safeDispose(armorMaterial);
    safeDispose(weakPointGeometry);
    safeDispose(weakPointMaterial);
    try { disposeSource(assets); } finally {
      templates.clear();
      sourceKinds.clear();
      fallbackKinds.clear();
      fallbackTemplate = null;
    }
  }

  return { renderLive, renderCorpses, getDiagnostics, destroy };
}
