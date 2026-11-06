import { normalizeWeaponId } from './weapon-profile.mjs';

const MAX_CASINGS = 20;
const MAX_IMPACTS = 8;
const MAX_PARTICLES = 36;
const CASING_FLOOR = 0.92;
const MAX_STEP = 0.1;
const MAX_EFFECT_LIFETIME = 14;

function finiteNumber(value, fallback = 0) {
  try {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  } catch {
    return fallback;
  }
}

function eventValue(event, key) {
  try {
    return event && (typeof event === 'object' || typeof event === 'function')
      ? event[key]
      : undefined;
  } catch {
    return undefined;
  }
}

function eventId(event) {
  const id = eventValue(event, 'id');
  return Number.isSafeInteger(id) && id >= 1 ? id : null;
}

function seededRandom(seed) {
  let state = (finiteNumber(seed, 1) >>> 0) || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
}

function trimPool(pool, cap) {
  while (pool.length > cap) pool.shift();
}

function removeExpired(pool) {
  return pool.filter((record) => record.age < record.lifetime);
}

export function createCombatEffects() {
  let casings = [];
  let impacts = [];
  let fragments = [];
  let fluids = [];
  let particleOrder = [];
  let seenEventIds = new Set();

  function currentParticlePool(name) {
    return name === 'fragments' ? fragments : fluids;
  }

  function addParticle(poolName, record) {
    currentParticlePool(poolName).push(record);
    particleOrder.push({ poolName, record });
    while (particleOrder.length > MAX_PARTICLES) {
      const oldest = particleOrder.shift();
      const pool = currentParticlePool(oldest.poolName);
      const index = pool.indexOf(oldest.record);
      if (index !== -1) pool.splice(index, 1);
    }
  }

  function makeParticle(id, random, kind, yaw, pitch, weaponId) {
    const angle = random() * Math.PI * 2;
    const speed = 0.12 + random() * 0.22;
    return {
      id,
      age: 0,
      lifetime: 0.35 + random() * 0.65,
      x: 0.5,
      y: 0.5,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 0.08,
      spin: (random() - 0.5) * 18,
      rotation: 0,
      kind,
      weaponId,
      yaw,
      pitch
    };
  }

  function present(event) {
    const id = eventId(event);
    if (id === null || seenEventIds.has(id)) return;
    seenEventIds.add(id);

    if (eventValue(event, 'accepted') === false || eventValue(event, 'rejected') === true) return;

    const type = eventValue(event, 'type');
    if (typeof type !== 'string') return;
    const rawSeed = eventValue(event, 'effectSeed');
    const random = seededRandom(rawSeed);
    const yaw = finiteNumber(eventValue(event, 'yaw'));
    const pitch = finiteNumber(eventValue(event, 'pitch'));
    const weaponId = normalizeWeaponId(eventValue(event, 'weaponId'));

    if (type === 'shoot') {
      casings.push({
        id,
        age: 0,
        lifetime: 1.4,
        x: 0.78,
        y: 0.72,
        vx: 0.1 + random() * 0.12,
        vy: 0.18 + random() * 0.18,
        spin: (random() - 0.5) * 20,
        rotation: 0,
        bounceCount: 0,
        weaponId
      });
      trimPool(casings, MAX_CASINGS);
      return;
    }

    if (type === 'miss') {
      const lifetime = 10 + Math.floor(random() * 5);
      impacts.push({
        id,
        age: 0,
        lifetime,
        yaw,
        pitch,
        pseudoDepth: 0.72,
        seed: (finiteNumber(rawSeed, 1) >>> 0) || 1,
        rotation: (random() - 0.5) * Math.PI * 2,
        markScale: 0.86 + random() * 0.32,
        weaponId
      });
      trimPool(impacts, MAX_IMPACTS);
      const count = 6 + Math.floor(random() * 5);
      for (let index = 0; index < count; index += 1) {
        addParticle('fragments', makeParticle(id, random, 'chip', yaw, pitch, weaponId));
      }
      return;
    }

    const fluidCounts = { hit: 4, 'critical-hit': 6, kill: 8 };
    const count = fluidCounts[type];
    if (!count) return;
    for (let index = 0; index < count; index += 1) {
      addParticle('fluids', makeParticle(id, random, type === 'kill' ? 'shell' : 'fluid', yaw, pitch, weaponId));
    }
  }

  function advance(step) {
    for (const casing of casings) {
      casing.age += step;
      casing.x += casing.vx * step;
      casing.y += casing.vy * step;
      casing.vy += 0.9 * step;
      casing.rotation += casing.spin * step;
      if (casing.y >= CASING_FLOOR) {
        casing.y = CASING_FLOOR;
        if (casing.bounceCount === 0) {
          casing.vy = -Math.abs(casing.vy) * 0.42;
          casing.bounceCount = 1;
        } else {
          casing.vy = 0;
        }
      }
    }

    for (const impact of impacts) impact.age += step;
    for (const particle of [...fragments, ...fluids]) {
      particle.age += step;
      particle.x += particle.vx * step;
      particle.y += particle.vy * step;
      particle.vy += 0.55 * step;
      particle.rotation += particle.spin * step;
    }

    casings = removeExpired(casings);
    impacts = removeExpired(impacts);
    fragments = removeExpired(fragments);
    fluids = removeExpired(fluids);
    particleOrder = particleOrder.filter(({ record }) => record.age < record.lifetime);
  }

  function update(dt) {
    const elapsed = finiteNumber(dt, -1);
    if (elapsed <= 0) return;

    // Motion is integrated in bounded chunks; all effects expire by 14 seconds.
    let remaining = Math.min(elapsed, MAX_EFFECT_LIFETIME + MAX_STEP);
    while (remaining > 0) {
      const step = Math.min(MAX_STEP, remaining);
      advance(step);
      remaining -= step;
    }
  }

  function snapshot() {
    return {
      casings: casings.map((record) => ({ ...record })),
      impacts: impacts.map((record) => ({
        ...record,
        opacity: Math.max(0, Math.min(1, (record.lifetime - record.age) / 1.2)),
        flashOpacity: Math.max(0, Math.min(1, 1 - record.age / 0.16))
      })),
      fragments: fragments.map((record) => ({ ...record })),
      fluids: fluids.map((record) => ({ ...record }))
    };
  }

  function clear() {
    casings = [];
    impacts = [];
    fragments = [];
    fluids = [];
    particleOrder = [];
    seenEventIds = new Set();
  }

  return { present, update, snapshot, clear };
}
