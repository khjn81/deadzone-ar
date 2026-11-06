import { ENEMY_VISUAL_SCALE_BOOST, shortestAngleDelta } from './ar-geometry.mjs';
import { planEnemySpawn } from './spawn-placement.mjs';
import {
  createWeaponAmmo,
  normalizeWeaponId,
  weaponProfile
} from './weapon-profile.mjs';

const SPAWN_ENTRY_DURATION = 0.9;
const MAX_LIVE_ENEMIES = 6;
const MAX_CORPSES = 4;
const NORMAL_CORPSE_LIFETIME = 8;
const ELITE_CORPSE_LIFETIME = 12;

export const PHASES = Object.freeze({
  READY: 'ready',
  PLAYING: 'playing',
  PAUSED: 'paused',
  RESULT: 'result'
});

const SIDEARM_PROFILE = weaponProfile('sidearm');
export const MAGAZINE_SIZE = SIDEARM_PROFILE.magazine;
export const RELOAD_DURATION = SIDEARM_PROFILE.reloadDuration;
export const FIRE_COOLDOWN = SIDEARM_PROFILE.fireCooldown;
export const COMBO_WINDOW = 1.8;
export const MAX_EVENT_HISTORY = 96;

export const ENEMY_TYPES = Object.freeze({
  swarmer: Object.freeze({ hp: 1, speed: 0.075, damage: 8, points: 140, size: 0.72, orbit: 5.4, orbitSpeed: 3.8, bob: 2.8, bobSpeed: 4.4 }),
  stinger: Object.freeze({ hp: 2, speed: 0.05, damage: 12, points: 100, size: 1, orbit: 3.2, orbitSpeed: 2.6, bob: 1.8, bobSpeed: 3.2 }),
  bulwark: Object.freeze({ hp: 6, speed: 0.032, damage: 24, points: 350, size: 1.28, orbit: 1.4, orbitSpeed: 1.5, bob: 1.1, bobSpeed: 1.9 })
});

const WAVE_CONFIG = Object.freeze({
  1: Object.freeze({ maxEnemies: 3, spawnInterval: 2.4 }),
  2: Object.freeze({ maxEnemies: 4, spawnInterval: 1.75 }),
  3: Object.freeze({ maxEnemies: 5, spawnInterval: 1.25 })
});

function finiteNumber(value, fallback = 0) {
  try {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  } catch {
    return fallback;
  }
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function unsignedSeed(value) {
  const seed = finiteNumber(value, 1) >>> 0;
  return seed || 1;
}

function effectSeed(eventId, salt = 0) {
  return (Math.imul((eventId >>> 0) || 1, 2654435761) ^ (salt >>> 0)) >>> 0;
}

function cloneState(state) {
  const weaponAmmo = state.weaponAmmo && typeof state.weaponAmmo === 'object'
    ? { ...state.weaponAmmo }
    : createWeaponAmmo();
  return {
    ...state,
    weapon: { ...state.weapon },
    weaponAmmo,
    stats: { ...state.stats },
    enemies: state.enemies.map((enemy) => ({ ...enemy })),
    corpses: (state.corpses || []).map((corpse) => ({ ...corpse })),
    particles: state.particles.map((particle) => ({ ...particle })),
    events: state.events.map((event) => ({
      ...event,
      ...(event.corpse ? { corpse: { ...event.corpse } } : {})
    }))
  };
}

function addEvent(state, type, payload = {}) {
  state.events.push({ id: state.nextEventId, type, ...payload });
  state.nextEventId += 1;
  if (state.events.length > MAX_EVENT_HISTORY) {
    state.events.splice(0, state.events.length - MAX_EVENT_HISTORY);
  }
}

function nextRandom(state) {
  state.rngState = (Math.imul(state.rngState, 1664525) + 1013904223) >>> 0;
  return state.rngState / 4294967296;
}

function corpseLifetime(elite) {
  return elite ? ELITE_CORPSE_LIFETIME : NORMAL_CORPSE_LIFETIME;
}

function canonicalEnemyType(type) {
  return typeof type === 'string' && Object.hasOwn(ENEMY_TYPES, type) ? type : 'stinger';
}

function createCorpseSnapshot(enemy, id, seed) {
  const elite = enemy.elite === true;
  return {
    id,
    enemyId: finiteNumber(enemy.id),
    type: canonicalEnemyType(enemy.type),
    elite,
    yaw: finiteNumber(enemy.yaw),
    pitch: finiteNumber(enemy.pitch),
    distance: Math.max(0, finiteNumber(enemy.distance, 1)),
    size: Math.max(0, finiteNumber(enemy.size, 1)),
    phase: finiteNumber(enemy.phase),
    age: 0,
    lifetime: corpseLifetime(elite),
    seed,
    fallVelocity: -8 - (seed % 5),
    roll: 0
  };
}

function oldestCorpseIndex(corpses, { nonEliteOnly = false } = {}) {
  let oldestIndex = -1;
  let oldestAge = -Infinity;
  for (let index = 0; index < corpses.length; index += 1) {
    const corpse = corpses[index];
    if (nonEliteOnly && corpse.elite === true) continue;
    const age = Math.max(0, finiteNumber(corpse.age));
    if (oldestIndex === -1 || age > oldestAge) {
      oldestIndex = index;
      oldestAge = age;
    }
  }
  return oldestIndex;
}

function enforceCorpseCap(state) {
  while (state.corpses.length > MAX_CORPSES) {
    const nonEliteIndex = oldestCorpseIndex(state.corpses, { nonEliteOnly: true });
    const evictionIndex = nonEliteIndex === -1
      ? oldestCorpseIndex(state.corpses)
      : nonEliteIndex;
    state.corpses.splice(evictionIndex, 1);
  }
}

function updateCorpses(state, delta) {
  for (const corpse of state.corpses) {
    const lifetime = corpseLifetime(corpse.elite === true);
    corpse.age = Math.max(0, finiteNumber(corpse.age)) + delta;
    corpse.lifetime = clamp(finiteNumber(corpse.lifetime, lifetime), 0, lifetime);
    corpse.yaw = finiteNumber(corpse.yaw);
    corpse.pitch = finiteNumber(corpse.pitch);
    corpse.distance = Math.max(0, finiteNumber(corpse.distance, 1));
    corpse.size = Math.max(0, finiteNumber(corpse.size, 1));
    corpse.phase = finiteNumber(corpse.phase);
    corpse.seed = unsignedSeed(corpse.seed);
    corpse.fallVelocity = finiteNumber(corpse.fallVelocity, -8 - (corpse.seed % 5));
    corpse.roll = finiteNumber(corpse.roll);
    if (corpse.age < 0.9) {
      corpse.pitch = Math.max(-28, corpse.pitch + corpse.fallVelocity * delta);
      corpse.roll += ((corpse.seed & 1) ? 1 : -1) * 2.4 * delta;
      corpse.fallVelocity = Math.max(-24, corpse.fallVelocity - 15 * delta);
    }
  }
  state.corpses = state.corpses.filter((corpse) => corpse.age < corpse.lifetime);
}

function waveForRemaining(remaining) {
  if (remaining > 60) return 1;
  if (remaining > 30) return 2;
  return 3;
}

function enemyTypeForWave(state, wave) {
  const roll = nextRandom(state);
  if (wave === 1) return 'stinger';
  if (wave === 2) return roll < 0.62 ? 'stinger' : 'swarmer';
  if (roll < 0.4) return 'stinger';
  if (roll < 0.72) return 'swarmer';
  return 'bulwark';
}

function spawnEnemy(state, view = {}, { elite = false } = {}) {
  const placement = planEnemySpawn({
    view,
    enemies: state.enemies,
    elite,
    laneRoll: nextRandom(state),
    pitchRoll: nextRandom(state),
    distanceRoll: nextRandom(state)
  });
  const type = elite ? 'bulwark' : enemyTypeForWave(state, state.wave);
  const config = ENEMY_TYPES[type];
  const phase = nextRandom(state) * Math.PI * 2;
  const hp = elite ? config.hp + 3 : config.hp;
  const id = state.nextEnemyId;

  state.enemies.push({
    id,
    type,
    hp,
    maxHp: hp,
    ...placement,
    speed: elite ? config.speed * 0.86 : config.speed,
    damage: elite ? 28 : config.damage,
    points: elite ? 600 : config.points,
    size: elite ? config.size * 1.15 : config.size,
    age: 0,
    phase,
    orbit: config.orbit,
    orbitSpeed: config.orbitSpeed,
    bob: config.bob,
    bobSpeed: config.bobSpeed,
    slowTimer: 0,
    slowFactor: 1,
    bank: 0,
    divePulse: 0,
    attackCooldown: 0,
    hitFlash: 0,
    spawnProgress: 0,
    elite
  });
  state.nextEnemyId += 1;
  addEvent(state, elite ? 'elite-spawn' : 'spawn', { enemyId: id, enemyType: type, elite });
}

function beginReload(state, { empty = false } = {}) {
  const profile = weaponProfile(state.selectedWeapon);
  if (state.weapon.reloading || state.ammo >= profile.magazine) return;
  state.weapon.reloading = true;
  state.weapon.reloadTimer = profile.reloadDuration;
  if (empty) addEvent(state, 'empty');
  addEvent(state, 'reload-start', {
    automatic: empty,
    weaponId: profile.id,
    reloadDuration: profile.reloadDuration,
    magazine: profile.magazine
  });
}

function finishMission(state, reason) {
  if (state.phase === PHASES.RESULT) return;
  state.phase = PHASES.RESULT;
  state.resultReason = reason;
  state.remaining = Math.max(0, state.remaining);
  state.weapon.reloading = false;
  state.weapon.reloadTimer = 0;
  addEvent(state, 'mission-end', { reason, grade: missionGrade(state) });
}

export function createInitialState({ seed = Date.now(), duration = 90, selectedWeapon = 'sidearm' } = {}) {
  const safeDuration = clamp(finiteNumber(duration, 90), 8, 180);
  const safeSeed = unsignedSeed(seed);
  const weaponId = normalizeWeaponId(selectedWeapon);
  const weaponAmmo = createWeaponAmmo();

  return {
    phase: PHASES.READY,
    duration: safeDuration,
    elapsed: 0,
    remaining: safeDuration,
    seed: safeSeed,
    rngState: safeSeed,
    wave: 1,
    maxEnemies: WAVE_CONFIG[1].maxEnemies,
    shield: 100,
    selectedWeapon: weaponId,
    weaponAmmo,
    ammo: weaponAmmo[weaponId],
    score: 0,
    combo: 0,
    bestCombo: 0,
    comboTimer: 0,
    enemies: [],
    corpses: [],
    particles: [],
    spawnTimer: 0.35,
    eliteSpawned: false,
    weapon: {
      cooldown: 0,
      reloading: false,
      reloadTimer: 0,
      recoil: 0
    },
    stats: {
      shots: 0,
      hits: 0,
      criticalHits: 0,
      kills: 0,
      damageTaken: 0
    },
    resultReason: null,
    events: [],
    nextEventId: 1,
    nextEnemyId: 1,
    nextCorpseId: 1
  };
}

export function startMission(state = createInitialState()) {
  const next = createInitialState({
    seed: state?.seed,
    duration: state?.duration,
    selectedWeapon: state?.selectedWeapon
  });
  next.phase = PHASES.PLAYING;
  addEvent(next, 'mission-start', { wave: 1 });
  return next;
}

export function updateGame(state, view = {}, dt = 0) {
  if (!state || state.phase !== PHASES.PLAYING) return state;
  const delta = clamp(finiteNumber(dt), 0, 2);
  if (delta <= 0) return state;

  const next = cloneState(state);
  next.elapsed = Math.min(next.duration, next.elapsed + delta);
  next.remaining = Math.max(0, next.duration - next.elapsed);

  const activeWeapon = weaponProfile(next.selectedWeapon);
  next.weapon.cooldown = Math.max(0, next.weapon.cooldown - delta);
  next.weapon.recoil = Math.max(0, next.weapon.recoil - delta * 8);
  if (next.weapon.reloading) {
    next.weapon.reloadTimer = Math.max(0, next.weapon.reloadTimer - delta);
    if (next.weapon.reloadTimer === 0) {
      next.weapon.reloading = false;
      next.ammo = activeWeapon.magazine;
      next.weaponAmmo[next.selectedWeapon] = activeWeapon.magazine;
      addEvent(next, 'reload-complete', { ammo: activeWeapon.magazine, weaponId: activeWeapon.id });
    }
  }

  if (next.comboTimer > 0) {
    next.comboTimer = Math.max(0, next.comboTimer - delta);
    if (next.comboTimer === 0) next.combo = 0;
  }

  updateCorpses(next, delta);

  const previousWave = next.wave;
  next.wave = waveForRemaining(next.remaining);
  next.maxEnemies = WAVE_CONFIG[next.wave].maxEnemies;
  if (next.wave !== previousWave) addEvent(next, 'wave', { wave: next.wave });

  if (next.remaining <= 15 && !next.eliteSpawned && next.enemies.length < MAX_LIVE_ENEMIES) {
    spawnEnemy(next, view, { elite: true });
    next.eliteSpawned = true;
  }

  next.spawnTimer -= delta;
  if (next.spawnTimer <= 0 && next.enemies.length < next.maxEnemies) {
    spawnEnemy(next, view);
    next.spawnTimer = WAVE_CONFIG[next.wave].spawnInterval * (0.88 + nextRandom(next) * 0.24);
  }

  for (const enemy of next.enemies) {
    enemy.age = finiteNumber(enemy.age) + delta;
    enemy.hitFlash = Math.max(0, enemy.hitFlash - delta);
    enemy.attackCooldown = Math.max(0, enemy.attackCooldown - delta);
    enemy.divePulse = Math.max(0, finiteNumber(enemy.divePulse) - delta * 3);
    enemy.slowTimer = Math.max(0, finiteNumber(enemy.slowTimer));
    enemy.slowFactor = clamp(finiteNumber(enemy.slowFactor, 1), 0.15, 1);
    if (enemy.slowTimer > 0) enemy.slowTimer = Math.max(0, enemy.slowTimer - delta);
    if (enemy.slowTimer === 0) enemy.slowFactor = 1;
    const speedFactor = enemy.slowTimer > 0 ? enemy.slowFactor : 1;
    enemy.distance = Math.max(0, enemy.distance - enemy.speed * speedFactor * delta);
    enemy.spawnProgress = clamp(enemy.age / SPAWN_ENTRY_DURATION, 0, 1);
    const entryEase = 1 - ((1 - enemy.spawnProgress) ** 3);
    const entryYaw = finiteNumber(enemy.entryYawOffset) * (1 - entryEase);
    const phase = finiteNumber(enemy.phase);
    const orbitPhase = enemy.age * finiteNumber(enemy.orbitSpeed) + phase;
    const orbitYaw = Math.sin(orbitPhase) * finiteNumber(enemy.orbit);
    const bobPitch = Math.sin(enemy.age * finiteNumber(enemy.bobSpeed) + phase * 0.73)
      * finiteNumber(enemy.bob);
    enemy.yaw = shortestAngleDelta(finiteNumber(enemy.baseYaw) + entryYaw + orbitYaw, 0);
    enemy.pitch = finiteNumber(enemy.basePitch) + bobPitch;
    enemy.bank = clamp(Math.cos(orbitPhase) * 0.42, -0.65, 0.65);

    if (enemy.distance <= 0.06 && enemy.attackCooldown === 0) {
      next.shield = Math.max(0, next.shield - enemy.damage);
      next.stats.damageTaken += enemy.damage;
      next.combo = 0;
      next.comboTimer = 0;
      enemy.distance = 0.3;
      enemy.attackCooldown = 1.4;
      enemy.divePulse = 1;
      addEvent(next, 'player-hit', { enemyId: enemy.id, damage: enemy.damage });
    }
  }

  if (next.shield <= 0) {
    finishMission(next, 'overrun');
  } else if (next.remaining <= 0) {
    finishMission(next, 'survived');
  }

  return next;
}

function targetScale(enemy) {
  const baseScale = clamp(0.5 + (1 - finiteNumber(enemy.distance, 1)) * 1.15, 0.42, 1.65);
  return clamp(baseScale * ENEMY_VISUAL_SCALE_BOOST, 0.42, 1.65)
    * finiteNumber(enemy.size, 1);
}

function findTargets(enemies, view, limit = 1) {
  const viewYaw = finiteNumber(view?.yaw);
  const viewPitch = finiteNumber(view?.pitch);
  const candidates = [];

  for (const enemy of enemies) {
    const scale = Math.max(0.3, targetScale(enemy));
    const yawDelta = Math.abs(shortestAngleDelta(finiteNumber(enemy.yaw), viewYaw));
    if (yawDelta > 4.6 / scale) continue;

    const weakPointPitch = finiteNumber(enemy.pitch);
    const critical = Math.abs(weakPointPitch - viewPitch) <= 2.1 / scale;
    const bodyHit = Math.abs(weakPointPitch - viewPitch) <= 6.8 / scale;
    if (!critical && !bodyHit) continue;
    candidates.push({ enemy, critical });
  }

  candidates.sort((left, right) => left.enemy.distance - right.enemy.distance);
  return candidates.slice(0, Math.max(1, Math.floor(finiteNumber(limit, 1))));
}

function projectilePose(yaw, pitch, profile, index, count) {
  if (count <= 1 || profile.spreadDegrees <= 0) return { yaw, pitch };
  const center = (count - 1) / 2;
  const normalized = center === 0 ? 0 : (index - center) / center;
  return {
    yaw: shortestAngleDelta(yaw + normalized * profile.spreadDegrees, 0),
    pitch
  };
}

function applyProjectile(next, profile, weaponId, pose, projectileIndex, projectileCount) {
  next.stats.shots += 1;
  const shotEventId = next.nextEventId;
  addEvent(next, 'shoot', {
    ammo: next.ammo,
    yaw: pose.yaw,
    pitch: pose.pitch,
    weaponId,
    projectileIndex,
    projectileCount,
    effectSeed: effectSeed(shotEventId)
  });

  const targets = findTargets(next.enemies, pose, profile.pierceTargets);
  if (targets.length === 0) {
    const missEventId = next.nextEventId;
    addEvent(next, 'miss', {
      yaw: pose.yaw,
      pitch: pose.pitch,
      weaponId,
      projectileIndex,
      projectileCount,
      effectSeed: effectSeed(missEventId)
    });
    return;
  }

  for (const target of targets) {
    const enemy = target.enemy;
    const damage = target.critical ? profile.criticalDamage : profile.damage;
    enemy.hp = Math.max(0, enemy.hp - damage);
    enemy.hitFlash = 0.16;
    next.stats.hits += 1;
    next.score += target.critical ? 40 : 20;
    const hitEventId = next.nextEventId;
    const hitType = target.critical ? 'critical-hit' : 'hit';
    if (target.critical) next.stats.criticalHits += 1;
    addEvent(next, hitType, {
      enemyId: enemy.id,
      damage,
      yaw: pose.yaw,
      pitch: pose.pitch,
      weaponId,
      projectileIndex,
      projectileCount,
      effectSeed: effectSeed(hitEventId)
    });

    if (profile.slowDuration > 0) {
      enemy.slowTimer = Math.max(finiteNumber(enemy.slowTimer), profile.slowDuration);
      enemy.slowFactor = Math.min(finiteNumber(enemy.slowFactor, 1), profile.slowFactor);
      addEvent(next, 'freeze', {
        enemyId: enemy.id,
        weaponId,
        duration: profile.slowDuration,
        slowFactor: profile.slowFactor,
        yaw: pose.yaw,
        pitch: pose.pitch,
        effectSeed: effectSeed(next.nextEventId, 0x51f0)
      });
    }

    if (enemy.hp !== 0) continue;
    next.combo = next.combo > 0 && next.comboTimer > 0 ? next.combo + 1 : 1;
    next.comboTimer = COMBO_WINDOW;
    next.bestCombo = Math.max(next.bestCombo, next.combo);
    next.stats.kills += 1;
    const criticalMultiplier = target.critical ? 1.5 : 1;
    const comboMultiplier = 1 + Math.min(8, next.combo - 1) * 0.15;
    const award = Math.round(enemy.points * criticalMultiplier * comboMultiplier);
    next.score += award;
    next.enemies = next.enemies.filter((candidate) => candidate.id !== enemy.id);
    const corpseId = Math.max(1, Math.floor(finiteNumber(next.nextCorpseId, 1)));
    const corpse = createCorpseSnapshot(enemy, corpseId, effectSeed(next.nextEventId));
    next.nextCorpseId = corpseId + 1;
    next.corpses.push(corpse);
    enforceCorpseCap(next);
    const killEventId = next.nextEventId;
    addEvent(next, 'kill', {
      enemyId: enemy.id,
      enemyType: corpse.type,
      criticalHit: target.critical,
      combo: next.combo,
      award,
      corpseId,
      corpse: { ...corpse },
      yaw: pose.yaw,
      pitch: pose.pitch,
      weaponId,
      projectileIndex,
      projectileCount,
      effectSeed: effectSeed(killEventId)
    });
  }
}

export function fireWeapon(state, view = {}) {
  if (!state || state.phase !== PHASES.PLAYING) return state;
  if (state.weapon.reloading || state.weapon.cooldown > 0) return state;

  const weaponId = normalizeWeaponId(state.selectedWeapon);
  const profile = weaponProfile(weaponId);
  const currentAmmo = clamp(finiteNumber(state.ammo, profile.magazine), 0, profile.magazine);
  if (currentAmmo <= 0) {
    const next = cloneState(state);
    next.selectedWeapon = weaponId;
    next.ammo = currentAmmo;
    next.weaponAmmo[weaponId] = currentAmmo;
    beginReload(next, { empty: true });
    return next;
  }

  const next = cloneState(state);
  next.selectedWeapon = weaponId;
  next.ammo = currentAmmo;
  next.weaponAmmo[weaponId] = currentAmmo;
  const rounds = Math.min(profile.ammoPerTrigger, currentAmmo);
  next.ammo = Math.max(0, currentAmmo - rounds);
  next.weaponAmmo[weaponId] = next.ammo;
  next.weapon.cooldown = profile.fireCooldown;
  next.weapon.recoil = 1;
  const shotYaw = finiteNumber(view?.yaw);
  const shotPitch = finiteNumber(view?.pitch);
  const actualProjectiles = profile.ammoPerTrigger === profile.projectiles
    ? Math.min(profile.projectiles, rounds)
    : profile.projectiles;
  for (let index = 0; index < actualProjectiles; index += 1) {
    applyProjectile(
      next,
      profile,
      weaponId,
      projectilePose(shotYaw, shotPitch, profile, index, actualProjectiles),
      index,
      actualProjectiles
    );
  }

  if (next.ammo === 0) beginReload(next);
  return next;
}

export function selectWeapon(state, weaponId) {
  if (!state) return state;
  const nextId = normalizeWeaponId(weaponId);
  const currentId = normalizeWeaponId(state.selectedWeapon);
  const sourceAmmo = state.weaponAmmo && typeof state.weaponAmmo === 'object'
    ? state.weaponAmmo
    : {};
  const readAmmo = (id) => clamp(
    finiteNumber(sourceAmmo[id], id === currentId ? state.ammo : weaponProfile(id).magazine),
    0,
    weaponProfile(id).magazine
  );
  const weaponAmmo = createWeaponAmmo();
  for (const id of Object.keys(weaponAmmo)) weaponAmmo[id] = readAmmo(id);
  if (currentId === nextId && state.selectedWeapon === nextId && state.ammo === weaponAmmo[nextId]) return state;
  weaponAmmo[currentId] = readAmmo(currentId);
  const next = cloneState(state);
  next.selectedWeapon = nextId;
  next.weaponAmmo = weaponAmmo;
  next.ammo = weaponAmmo[nextId];
  next.weapon = {
    ...next.weapon,
    cooldown: 0,
    reloading: false,
    reloadTimer: 0,
    recoil: 0
  };
  return next;
}

export function requestReload(state) {
  if (!state || state.phase !== PHASES.PLAYING) return state;
  const profile = weaponProfile(state.selectedWeapon);
  if (state.weapon.reloading || state.ammo >= profile.magazine) return state;
  const next = cloneState(state);
  beginReload(next);
  return next;
}

export function togglePause(state) {
  if (!state) return state;
  if (state.phase === PHASES.PLAYING) return { ...state, phase: PHASES.PAUSED };
  if (state.phase === PHASES.PAUSED) return { ...state, phase: PHASES.PLAYING };
  return state;
}

export function missionGrade(state = {}) {
  const shots = Math.max(0, finiteNumber(state.stats?.shots));
  const hits = clamp(finiteNumber(state.stats?.hits), 0, shots || Infinity);
  const hitRate = shots > 0 ? hits / shots : 0;
  const score = Math.max(0, finiteNumber(state.score));
  const survived = state.resultReason === 'survived';

  if (survived && score >= 4000 && hitRate >= 0.65) return 'S';
  if (survived && score >= 2500 && hitRate >= 0.5) return 'A';
  if (score >= 1200 || (survived && score >= 800)) return 'B';
  return 'C';
}
