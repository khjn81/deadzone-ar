const CASING_POOL_SIZE = 20;
const IMPACT_POOL_SIZE = 8;
const FRAGMENT_POOL_SIZE = 36;

const number = (value, fallback = 0) => {
  try {
    const result = Number(value);
    return Number.isFinite(result) ? result : fallback;
  } catch {
    return fallback;
  }
};
const propertyOf = (source, key, fallback) => {
  try { return source == null ? fallback : source[key]; } catch { return fallback; }
};
const itemAt = (list, index) => {
  try { return Array.isArray(list) ? list[index] : undefined; } catch { return undefined; }
};
const safeDispose = (resource) => { try { resource?.dispose?.(); } catch {} };
const safeRemove = (scene, mesh) => { try { scene.remove(mesh); } catch {} };

function createImpactAlphaTexture(THREE) {
  const size = 64;
  const data = new Uint8Array(size * size * 4);
  const center = size / 2;
  const rays = [0, 0.82, 1.74, 2.66, 3.48, 4.31, 5.37];
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = x - center;
      const dy = y - center;
      const radius = Math.hypot(dx, dy);
      let alpha = radius < 5 ? Math.round(255 * (1 - radius / 7)) : 0;
      if (radius >= 4 && radius <= 29) {
        for (const angle of rays) {
          const forward = dx * Math.cos(angle) + dy * Math.sin(angle);
          const sideways = Math.abs(dy * Math.cos(angle) - dx * Math.sin(angle));
          if (forward > 0 && sideways < 0.85) {
            alpha = Math.max(alpha, Math.round(220 * (1 - radius / 34)));
          }
        }
      }
      const offset = (y * size + x) * 4;
      data[offset] = 255;
      data[offset + 1] = alpha;
      data[offset + 2] = 255;
      data[offset + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(data, size, size);
  texture.needsUpdate = true;
  return texture;
}

export function createThreeCombatEffects(scene, THREE) {
  let casingGeometry = null;
  let impactGeometry = null;
  let fragmentGeometry = null;
  let casingMaterial = null;
  let impactMaterial = null;
  let impactFlashMaterial = null;
  let impactAlphaTexture = null;
  let fragmentMaterial = null;
  const casings = [];
  const impacts = [];
  const impactMaterials = [];
  const impactFlashMaterials = [];
  const fragments = [];
  const counts = { casingCount: 0, impactCount: 0, fragmentCount: 0 };
  let destroyed = false;

  function makePool(size, geometry, material, kind, target) {
    for (let index = 0; index < size; index += 1) {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.visible = false;
      mesh.userData.effectPool = kind;
      target.push(mesh);
      scene.add(mesh);
    }
  }

  function rollback() {
    for (const mesh of casings) safeRemove(scene, mesh);
    for (const mesh of impacts) safeRemove(scene, mesh);
    for (const mesh of fragments) safeRemove(scene, mesh);
    casings.length = 0;
    impacts.length = 0;
    fragments.length = 0;
    safeDispose(casingGeometry);
    safeDispose(impactGeometry);
    safeDispose(fragmentGeometry);
    safeDispose(casingMaterial);
    for (const material of impactMaterials) safeDispose(material);
    for (const material of impactFlashMaterials) safeDispose(material);
    impactMaterials.length = 0;
    impactFlashMaterials.length = 0;
    safeDispose(impactMaterial);
    safeDispose(impactFlashMaterial);
    safeDispose(impactAlphaTexture);
    safeDispose(fragmentMaterial);
  }

  try {
    casingGeometry = new THREE.CylinderGeometry(1, 1, 1, 6);
    impactGeometry = new THREE.PlaneGeometry(1, 1);
    fragmentGeometry = new THREE.BoxGeometry(1, 1, 1);
    casingMaterial = new THREE.MeshStandardMaterial({ color: 0xc99b42, roughness: 0.42, metalness: 0.72 });
    impactAlphaTexture = createImpactAlphaTexture(THREE);
    impactMaterial = new THREE.MeshBasicMaterial({
      alphaMap: impactAlphaTexture,
      color: 0x160f0b,
      transparent: true,
      opacity: 0.92,
      depthWrite: false
    });
    impactFlashMaterial = new THREE.MeshBasicMaterial({
      alphaMap: impactAlphaTexture,
      blending: THREE.AdditiveBlending,
      color: 0xffc56b,
      transparent: true,
      opacity: 0,
      depthWrite: false
    });
    fragmentMaterial = new THREE.MeshStandardMaterial({ color: 0x788522, roughness: 0.9, metalness: 0 });
    makePool(CASING_POOL_SIZE, casingGeometry, casingMaterial, 'casing', casings);
    for (let index = 0; index < IMPACT_POOL_SIZE; index += 1) {
      const slotMaterial = impactMaterial.clone();
      impactMaterials.push(slotMaterial);
      const slotFlashMaterial = impactFlashMaterial.clone();
      impactFlashMaterials.push(slotFlashMaterial);
      const mesh = new THREE.Mesh(impactGeometry, slotMaterial);
      const flash = new THREE.Mesh(impactGeometry, slotFlashMaterial);
      mesh.visible = false;
      flash.visible = false;
      mesh.userData.effectPool = 'impact';
      flash.userData.impactFlash = true;
      slotMaterial.opacity = 0;
      slotFlashMaterial.opacity = 0;
      flash.position.z = 0.5;
      flash.scale.set(1.18, 1.18, 1);
      mesh.add(flash);
      impacts.push(mesh);
      scene.add(mesh);
    }
    makePool(FRAGMENT_POOL_SIZE, fragmentGeometry, fragmentMaterial, 'fragment', fragments);
  } catch (error) {
    rollback();
    throw error;
  }

  function normalized(mesh, descriptor, viewport) {
    const width = Math.max(1, number(viewport?.width, 1));
    const height = Math.max(1, number(viewport?.height, 1));
    const x = number(propertyOf(descriptor, 'x', Number.NaN), Number.NaN) * width - width / 2;
    const y = height / 2 - number(propertyOf(descriptor, 'y', Number.NaN), Number.NaN) * height;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
    const limit = Math.max(width, height) * 4;
    mesh.position.x = Math.max(-limit, Math.min(limit, x));
    mesh.position.y = Math.max(-limit, Math.min(limit, y));
    return true;
  }

  function renderCasings(items, viewport) {
    let count = 0;
    for (let index = 0; index < casings.length; index += 1) {
      const mesh = casings[index];
      const descriptor = itemAt(items, index);
      const visible = Boolean(descriptor)
        && propertyOf(descriptor, 'visible', true) !== false
        && normalized(mesh, descriptor, viewport);
      mesh.visible = visible;
      if (!visible) continue;
      mesh.position.z = 80;
      mesh.rotation.z = number(propertyOf(descriptor, 'rotation', 0));
      mesh.scale.set(3, 7, 3);
      count += 1;
    }
    return count;
  }

  function renderImpacts(items, viewport) {
    const width = Math.max(1, number(viewport?.width, 1));
    const height = Math.max(1, number(viewport?.height, 1));
    const limit = Math.max(width, height) * 4;
    let count = 0;
    for (let index = 0; index < impacts.length; index += 1) {
      const mesh = impacts[index];
      const descriptor = itemAt(items, index);
      const x = number(propertyOf(descriptor, 'x', Number.NaN), Number.NaN) - width / 2;
      const y = height / 2 - number(propertyOf(descriptor, 'y', Number.NaN), Number.NaN);
      const visible = Boolean(descriptor)
        && propertyOf(descriptor, 'visible', false) !== false
        && Number.isFinite(x)
        && Number.isFinite(y);
      mesh.visible = visible;
      const flash = mesh.children[0];
      if (!visible) {
        mesh.material.opacity = 0;
        flash.material.opacity = 0;
        flash.visible = false;
        continue;
      }
      mesh.position.set(
        Math.max(-limit, Math.min(limit, x)),
        Math.max(-limit, Math.min(limit, y)),
        90
      );
      const projectionScale = number(propertyOf(descriptor, 'scale', 1), 1);
      const markScale = number(propertyOf(descriptor, 'markScale', 1), 1);
      const scale = Math.max(0, Math.min(limit, projectionScale * markScale * 28));
      mesh.scale.set(scale, scale, 1);
      mesh.rotation.z = number(propertyOf(descriptor, 'rotation', 0));
      mesh.material.opacity = Math.max(0, Math.min(0.92, number(propertyOf(descriptor, 'opacity', 1), 1)));
      flash.material.opacity = Math.max(0, Math.min(0.82, number(propertyOf(descriptor, 'flashOpacity', 0), 0)));
      flash.visible = flash.material.opacity > 0;
      count += 1;
    }
    return count;
  }

  function renderParticles(fragmentItems, fluidItems, viewport) {
    let chipCount = 0;
    try { chipCount = Array.isArray(fragmentItems) ? fragmentItems.length : 0; } catch {}
    chipCount = Math.max(0, Math.min(FRAGMENT_POOL_SIZE, number(chipCount, 0)));
    let count = 0;
    for (let index = 0; index < fragments.length; index += 1) {
      const mesh = fragments[index];
      const descriptor = index < chipCount
        ? itemAt(fragmentItems, index)
        : itemAt(fluidItems, index - chipCount);
      const visible = Boolean(descriptor)
        && propertyOf(descriptor, 'visible', true) !== false
        && normalized(mesh, descriptor, viewport);
      mesh.visible = visible;
      if (!visible) continue;
      mesh.position.z = 85;
      mesh.rotation.z = number(propertyOf(descriptor, 'rotation', 0));
      mesh.scale.set(4, 2, 1);
      count += 1;
    }
    return count;
  }

  function render(effects = {}, viewport) {
    if (destroyed) return;
    counts.casingCount = renderCasings(propertyOf(effects, 'casings', null), viewport);
    counts.impactCount = renderImpacts(propertyOf(effects, 'impacts', null), viewport);
    counts.fragmentCount = renderParticles(
      propertyOf(effects, 'fragments', null),
      propertyOf(effects, 'fluids', null),
      viewport
    );
  }

  function getDiagnostics() {
    return {
      casingCount: counts.casingCount,
      impactCount: counts.impactCount,
      fragmentCount: counts.fragmentCount
    };
  }

  function resetMission() {
    if (destroyed) return;
    for (const mesh of [...casings, ...impacts, ...fragments]) {
      mesh.visible = false;
      if (mesh.userData.effectPool === 'impact') mesh.material.opacity = 0;
      for (const child of mesh.children) {
        child.visible = false;
        if (child.userData.impactFlash === true) child.material.opacity = 0;
      }
    }
    counts.casingCount = 0;
    counts.impactCount = 0;
    counts.fragmentCount = 0;
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    rollback();
    counts.casingCount = 0;
    counts.impactCount = 0;
    counts.fragmentCount = 0;
  }

  return { render, resetMission, getDiagnostics, destroy };
}
