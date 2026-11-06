import assert from 'node:assert/strict';
import test from 'node:test';

import { shortestAngleDelta } from '../public/game/src/ar-geometry.mjs';
import {
  ENEMY_TYPES,
  createInitialState,
  fireWeapon,
  startMission,
  selectWeapon,
  updateGame
} from '../public/game/src/game-core.mjs';

const centeredView = Object.freeze({ yaw: 0, pitch: 0, sensorFresh: true });
const liveView = centeredView;

function mission(seed = 424242) {
  const state = startMission(createInitialState({ seed, duration: 90 }));
  state.spawnTimer = 0;
  return state;
}

function advanceUntilSpawn(state, view = liveView) {
  let next = state;
  for (let step = 0; step < 10 && next.enemies.length === 0; step += 1) {
    next = updateGame(next, view, 0.1);
  }
  assert.ok(next.enemies.length > 0, 'fixture must spawn an insect within one second');
  return next;
}

function eventsOf(state, type) {
  return state.events.filter((event) => event.type === type);
}

function targetState({ hp = 2, type = 'stinger', corpses = [], elite = false } = {}) {
  const state = mission(7);
  state.spawnTimer = 100;
  state.corpses = corpses.map((corpse) => ({ ...corpse }));
  state.nextCorpseId = 100;
  state.enemies = [{
    id: 1, type, hp, maxHp: hp, yaw: 0, baseYaw: 0, pitch: 0, basePitch: 0,
    distance: 0.6, size: 1, phase: 0, points: 100, hitFlash: 0, elite,
    speed: 0, damage: 0, orbit: 0, orbitSpeed: 0, bob: 0, bobSpeed: 0,
    attackCooldown: 0, spawnProgress: 1, entryYawOffset: 0, bank: 0
  }];
  return state;
}

test('timer spawns an airborne enemy relative to the live camera view', () => {
  const view = { yaw: 71, pitch: 9, sensorFresh: true };
  const next = updateGame(mission(), view, 0.001);
  const enemy = next.enemies[0];
  assert.ok(Math.abs(shortestAngleDelta(enemy.baseYaw, view.yaw)) >= 38);
  assert.ok(Math.abs(shortestAngleDelta(enemy.yaw, view.yaw)) >
    Math.abs(shortestAngleDelta(enemy.baseYaw, view.yaw)));
  assert.ok(enemy.basePitch >= -12 && enemy.basePitch <= 18);
  assert.ok(enemy.distance >= 1.03 && enemy.distance <= 1.15);
  assert.equal(enemy.spawnKind, 'air-edge');
  assert.ok(Number.isFinite(enemy.orbit));
  assert.ok(Number.isFinite(enemy.orbitSpeed));
  assert.ok(Number.isFinite(enemy.bob));
  assert.ok(Number.isFinite(enemy.bobSpeed));
  assert.ok(Math.abs(enemy.bank) <= 0.65);
  assert.ok(enemy.spawnProgress > 0 && enemy.spawnProgress < 0.01);
});

test('entry yaw follows the exact cubic while orbit stays derived from its stable center', () => {
  let state = mission(17);
  const samples = [
    { delta: 0.09, age: 0.09, factor: 0.729 },
    { delta: 0.18, age: 0.27, factor: 0.343 },
    { delta: 0.18, age: 0.45, factor: 0.125 },
    { delta: 0.36, age: 0.81, factor: 0.001 },
    { delta: 0.09, age: 0.9, factor: 0 }
  ];

  for (const { delta, age, factor } of samples) {
    state = updateGame(state, { yaw: 0, sensorFresh: true }, delta);
    const enemy = state.enemies[0];
    const orbitYaw = Math.sin(enemy.age * enemy.orbitSpeed + enemy.phase) * enemy.orbit;
    const entryYaw = shortestAngleDelta(enemy.yaw - orbitYaw, enemy.baseYaw);
    assert.ok(Math.abs(enemy.age - age) < 1e-12);
    assert.ok(Math.abs(entryYaw - enemy.entryYawOffset * factor) < 1e-9);
    const expectedPitch = enemy.basePitch
      + Math.sin(enemy.age * enemy.bobSpeed + enemy.phase * 0.73) * enemy.bob;
    const expectedBank = Math.cos(enemy.age * enemy.orbitSpeed + enemy.phase) * 0.42;
    assert.ok(Math.abs(enemy.pitch - expectedPitch) < 1e-12);
    assert.ok(Math.abs(enemy.bank - expectedBank) < 1e-12);
  }
  assert.equal(state.enemies[0].spawnProgress, 1);
});

test('exports the exact insect role configuration', () => {
  assert.deepEqual(ENEMY_TYPES, {
    swarmer: { hp: 1, speed: 0.075, damage: 8, points: 140, size: 0.72, orbit: 5.4, orbitSpeed: 3.8, bob: 2.8, bobSpeed: 4.4 },
    stinger: { hp: 2, speed: 0.05, damage: 12, points: 100, size: 1, orbit: 3.2, orbitSpeed: 2.6, bob: 1.8, bobSpeed: 3.2 },
    bulwark: { hp: 6, speed: 0.032, damage: 24, points: 350, size: 1.28, orbit: 1.4, orbitSpeed: 1.5, bob: 1.1, bobSpeed: 1.9 }
  });
});

test('airborne enemies orbit and bob around stable world centers', () => {
  const spawned = advanceUntilSpawn(startMission(createInitialState({ seed: 91 })), liveView);
  const insect = spawned.enemies[0];
  assert.equal(insect.type, 'stinger');
  assert.equal(insect.spawnKind, 'air-edge');
  assert.ok(insect.basePitch >= -12 && insect.basePitch <= 18);
  const later = updateGame(spawned, liveView, 0.25).enemies[0];
  assert.equal(later.baseYaw, insect.baseYaw);
  assert.equal(later.basePitch, insect.basePitch);
  assert.notEqual(later.yaw, insect.yaw);
  assert.notEqual(later.pitch, insect.pitch);
  assert.ok(Math.abs(later.bank) <= 0.65);
});

test('an attack raises a dive pulse that decays on later updates', () => {
  const spawned = updateGame(mission(29), liveView, 0.001);
  spawned.spawnTimer = 10;
  spawned.enemies[0].distance = 0.05;
  spawned.enemies[0].speed = 0;
  spawned.enemies[0].attackCooldown = 0;

  const attacked = updateGame(spawned, liveView, 0.01);
  assert.equal(attacked.enemies[0].divePulse, 1);
  assert.equal(attacked.enemies[0].distance, 0.3);
  assert.ok(attacked.events.some((event) => event.type === 'player-hit'));

  const recovering = updateGame(attacked, liveView, 0.1);
  assert.ok(recovering.enemies[0].divePulse >= 0);
  assert.ok(recovering.enemies[0].divePulse < 1);
});

test('rejects non-finite update deltas without throwing', () => {
  const state = mission(31);
  assert.equal(updateGame(state, liveView, Symbol('dt')), state);
});

test('normalizes malformed flight metadata to finite world coordinates', () => {
  const state = updateGame(mission(37), liveView, 0.001);
  state.spawnTimer = 10;
  Object.assign(state.enemies[0], {
    baseYaw: Symbol('baseYaw'),
    basePitch: Symbol('basePitch'),
    orbit: Symbol('orbit'),
    orbitSpeed: Symbol('orbitSpeed'),
    bob: Symbol('bob'),
    bobSpeed: Symbol('bobSpeed'),
    phase: Symbol('phase')
  });

  const enemy = updateGame(state, liveView, 0.1).enemies[0];
  assert.equal(Number.isFinite(enemy.yaw), true);
  assert.equal(Number.isFinite(enemy.pitch), true);
  assert.equal(Number.isFinite(enemy.bank), true);
});

test('elite spawn uses the live view and advances exactly four RNG calls', () => {
  const state = mission(123456);
  state.elapsed = 75;
  state.remaining = 15;
  state.spawnTimer = 10;

  const next = updateGame(state, { yaw: 133, pitch: -3, sensorFresh: true }, 0.001);
  const enemy = next.enemies[0];
  assert.equal(enemy.elite, true);
  assert.equal(enemy.baseYaw, 65);
  assert.equal(enemy.spawnSide, 'left');
  assert.equal(enemy.entryYawOffset, -18);
  assert.equal(next.rngState, 2406627700);
});

test('ordinary spawn advances exactly six RNG calls including its timer roll', () => {
  const next = updateGame(mission(123456), { yaw: 0, pitch: 0, sensorFresh: true }, 0.001);
  assert.equal(next.enemies.length, 1);
  assert.equal(next.rngState, 62768838);
});

test('the elite transition never exceeds six live enemies', () => {
  const state = mission(77);
  state.elapsed = 75;
  state.remaining = 15;
  state.enemies = Array.from({ length: 5 }, (_, index) => ({
    id: index + 1,
    type: 'stinger',
    hp: 2,
    maxHp: 2,
    baseYaw: -70 + index * 35,
    yaw: -70 + index * 35,
    basePitch: 0,
    pitch: 0,
    distance: 0.8,
    entryYawOffset: 0,
    speed: 0,
    damage: 0,
    points: 100,
    size: 1,
    age: 1,
    phase: 0,
    orbit: 0,
    orbitSpeed: 0,
    bob: 0,
    bobSpeed: 0,
    bank: 0,
    divePulse: 0,
    attackCooldown: 1,
    hitFlash: 0,
    spawnProgress: 1,
    elite: false
  }));

  const next = updateGame(state, liveView, 0.001);
  assert.equal(next.enemies.length, 6);
  assert.equal(next.enemies.filter((enemy) => enemy.elite).length, 1);

  const full = structuredClone(state);
  full.enemies.push({ ...full.enemies[0], id: 6 });
  const capped = updateGame(full, liveView, 0.001);
  assert.equal(capped.enemies.length, 6);
  assert.equal(capped.eliteSpawned, false);
});

test('successive spawns disperse across available bearings deterministically', () => {
  const view = { yaw: 0, pitch: 0, sensorFresh: true };
  let first = mission(99);
  let second = mission(99);
  for (let index = 0; index < 4; index += 1) {
    first.spawnTimer = 0;
    second.spawnTimer = 0;
    first = updateGame(first, view, 0.001);
    second = updateGame(second, view, 0.001);
  }
  assert.deepEqual(first.enemies, second.enemies);
  const bearings = first.enemies.map((enemy) => enemy.baseYaw);
  assert.equal(new Set(bearings).size, bearings.length);
});

test('a fixed changing live-view sequence has exact deterministic placements', () => {
  const views = [
    { yaw: 10, pitch: 1, sensorFresh: true },
    { yaw: 95, pitch: -2, sensorFresh: true },
    { yaw: -170, pitch: 3, sensorFresh: true },
    { yaw: 42, pitch: 0, sensorFresh: true }
  ];
  const runSequence = () => {
    let state = mission(20260812);
    state.elapsed = 61;
    state.remaining = 29;
    const placements = [];
    for (const view of views) {
      state.spawnTimer = 0;
      state = updateGame(state, view, 0.001);
      const enemy = state.enemies.at(-1);
      placements.push({
        baseYaw: enemy.baseYaw,
        spawnSide: enemy.spawnSide,
        rngState: state.rngState
      });
    }
    return placements;
  };
  const expected = [
    { baseYaw: -36, spawnSide: 'left', rngState: 3995189490 },
    { baseYaw: 141, spawnSide: 'right', rngState: 1564576104 },
    { baseYaw: -124, spawnSide: 'right', rngState: 4150436526 },
    { baseYaw: 88, spawnSide: 'right', rngState: 1135755844 }
  ];
  assert.deepEqual(runSequence(), expected);
  assert.deepEqual(runSequence(), expected);
});

test('fireWeapon targets the same eased yaw rendered for a fresh spawn', () => {
  const spawned = updateGame(mission(123), { yaw: 0, pitch: 0, sensorFresh: true }, 0.001);
  const enemy = spawned.enemies[0];
  const aimed = fireWeapon(spawned, { yaw: enemy.yaw, pitch: enemy.pitch });
  const hit = aimed.events.find((event) => event.type === 'hit' || event.type === 'critical-hit');
  assert.equal(hit?.enemyId, enemy.id);
  const falseCenter = fireWeapon(spawned, { yaw: 0, pitch: enemy.pitch });
  assert.ok(falseCenter.events.some((event) => event.type === 'miss'));
});

test('bounds presentation event history while retaining the newest shoot and miss', () => {
  let state = mission(101);
  state.spawnTimer = 100;

  for (let shot = 0; shot < 49; shot += 1) {
    state.weapon.cooldown = 0;
    state.ammo = 8;
    state = fireWeapon(state, { yaw: 45, pitch: 20 });
  }

  assert.equal(state.events.length, 96);
  assert.deepEqual(state.events.map((event) => event.id),
    Array.from({ length: 96 }, (_, index) => index + 4));
  assert.ok(state.events[0].id > 1);
  assert.equal(state.events.at(-1).id, state.nextEventId - 1);
  assert.deepEqual(state.events.slice(-2).map((event) => event.type), ['shoot', 'miss']);
});

test('accepted shots carry one authoritative pose and seed while rejected shots carry none', () => {
  const fired = fireWeapon(targetState(), { yaw: 17, pitch: -3 });
  assert.deepEqual(
    eventsOf(fired, 'shoot').map(({ yaw, pitch, effectSeed }) => ({ yaw, pitch, effectSeed })),
    [{ yaw: 17, pitch: -3, effectSeed: 1013904226 }]
  );
  assert.equal(eventsOf(fireWeapon(fired, { yaw: 17, pitch: -3 }), 'shoot').length, 1);
});

test('body-hit events retain the shot direction and their own deterministic seed', () => {
  const state = targetState({ hp: 2 });
  const fired = fireWeapon(state, { yaw: 0, pitch: 4 });

  assert.deepEqual(
    eventsOf(fired, 'hit').map(({ id, yaw, pitch, effectSeed }) => ({ id, yaw, pitch, effectSeed })),
    [{ id: 3, yaw: 0, pitch: 4, effectSeed: 3668339987 }]
  );
  assert.equal(fired.rngState, state.rngState);
});

test('critical and kill events reuse one sampled shot pose with event-specific seeds', () => {
  let yawReads = 0;
  let pitchReads = 0;
  const changingView = {
    get yaw() {
      yawReads += 1;
      return yawReads === 1 ? 0 : 120;
    },
    get pitch() {
      pitchReads += 1;
      return pitchReads === 1 ? 0 : 45;
    }
  };

  const fired = fireWeapon(targetState({ hp: 1 }), changingView);

  assert.deepEqual(
    fired.events
      .filter((event) => event.type === 'critical-hit' || event.type === 'kill')
      .map(({ id, type, yaw, pitch, effectSeed }) => ({ id, type, yaw, pitch, effectSeed })),
    [
      { id: 3, type: 'critical-hit', yaw: 0, pitch: 0, effectSeed: 3668339987 },
      { id: 4, type: 'kill', yaw: 0, pitch: 0, effectSeed: 2027808452 }
    ]
  );
  assert.equal(yawReads, 1);
  assert.equal(pitchReads, 1);
});

test('one sampled shot pose controls its event, target selection, and critical result', () => {
  let yawReads = 0;
  let pitchReads = 0;
  const changingView = {
    get yaw() {
      yawReads += 1;
      return yawReads === 1 ? 0 : 120;
    },
    get pitch() {
      pitchReads += 1;
      return pitchReads === 1 ? 0 : 45;
    }
  };

  const fired = fireWeapon(targetState({ hp: 3 }), changingView);

  assert.deepEqual(
    eventsOf(fired, 'shoot').map(({ yaw, pitch }) => ({ yaw, pitch })),
    [{ yaw: 0, pitch: 0 }]
  );
  assert.deepEqual(eventsOf(fired, 'critical-hit').map(({ enemyId }) => enemyId), [1]);
  assert.equal(fired.enemies[0].hp, 1);
  assert.equal(eventsOf(fired, 'miss').length, 0);
  assert.equal(yawReads, 1);
  assert.equal(pitchReads, 1);
});

test('miss events preserve the accepted shot direction with their own deterministic seed', () => {
  const missed = fireWeapon(targetState(), { yaw: -37, pitch: 11 });
  assert.deepEqual(
    eventsOf(missed, 'miss').map(({ yaw, pitch, effectSeed }) => ({ yaw, pitch, effectSeed })),
    [{ yaw: -37, pitch: 11, effectSeed: 3668339987 }]
  );
});

test('one sampled off-target pose controls both shoot and miss events', () => {
  let yawReads = 0;
  let pitchReads = 0;
  const changingView = {
    get yaw() {
      yawReads += 1;
      return yawReads === 1 ? -37 : 0;
    },
    get pitch() {
      pitchReads += 1;
      return pitchReads === 1 ? 11 : 0;
    }
  };

  const missed = fireWeapon(targetState(), changingView);

  assert.deepEqual(
    eventsOf(missed, 'shoot').map(({ yaw, pitch }) => ({ yaw, pitch })),
    [{ yaw: -37, pitch: 11 }]
  );
  assert.deepEqual(
    eventsOf(missed, 'miss').map(({ yaw, pitch }) => ({ yaw, pitch })),
    [{ yaw: -37, pitch: 11 }]
  );
  assert.equal(eventsOf(missed, 'critical-hit').length, 0);
  assert.equal(missed.enemies[0].hp, 2);
  assert.equal(yawReads, 1);
  assert.equal(pitchReads, 1);
});

test('weak-point hits use critical-hit and criticalHits', () => {
  const result = fireWeapon(targetState(), centeredView);
  assert.equal(eventsOf(result, 'critical-hit').length, 1);
  assert.equal(result.stats.criticalHits, 1);
  assert.equal('headshots' in result.stats, false);
});

test('a kill creates one exact deterministic corpse snapshot and removes the live threat', () => {
  const state = targetState({ hp: 1, type: 'swarmer' });
  const rngState = state.rngState;
  const killed = fireWeapon(state, centeredView);

  assert.equal(killed.enemies.length, 0);
  assert.deepEqual(killed.corpses, [{
    id: 100,
    enemyId: 1,
    type: 'swarmer',
    elite: false,
    yaw: 0,
    pitch: 0,
    distance: 0.6,
    size: 1,
    phase: 0,
    age: 0,
    lifetime: 8,
    seed: 2027808452,
    fallVelocity: -10,
    roll: 0
  }]);
  assert.equal(killed.nextCorpseId, 101);
  assert.equal(killed.rngState, rngState);
  assert.deepEqual(fireWeapon(targetState({ hp: 1, type: 'swarmer' }), centeredView).corpses, killed.corpses);

  const kill = eventsOf(killed, 'kill')[0];
  assert.equal(kill.corpseId, killed.corpses[0].id);
  assert.deepEqual(kill.corpse, killed.corpses[0]);
  assert.notEqual(kill.corpse, killed.corpses[0]);
  assert.equal(kill.criticalHit, true);
  assert.equal('headshot' in kill, false);
});

test('new missions start with an empty corpse lifecycle and reset its cursor', () => {
  const initial = createInitialState({ seed: 5 });
  assert.deepEqual(initial.corpses, []);
  assert.equal(initial.nextCorpseId, 1);

  initial.corpses.push({ id: 17 });
  initial.nextCorpseId = 18;
  const started = startMission(initial);
  assert.deepEqual(started.corpses, []);
  assert.equal(started.nextCorpseId, 1);
});

test('a queen corpse receives the twelve-second elite lifetime', () => {
  const killed = fireWeapon(targetState({ hp: 1, type: 'bulwark', elite: true }), centeredView);
  assert.equal(killed.corpses[0].elite, true);
  assert.equal(killed.corpses[0].lifetime, 12);
});

test('corpse and kill snapshots canonicalize circular enemy types without losing elite lifetime', () => {
  const circularType = {};
  circularType.self = circularType;
  const killed = fireWeapon(
    targetState({ hp: 1, type: circularType, elite: true }),
    centeredView
  );
  const kill = eventsOf(killed, 'kill')[0];

  assert.equal(killed.corpses[0].type, 'stinger');
  assert.equal(killed.corpses[0].elite, true);
  assert.equal(killed.corpses[0].lifetime, 12);
  assert.equal(kill.enemyType, 'stinger');
  assert.equal(kill.corpse.type, 'stinger');
  assert.doesNotThrow(() => JSON.stringify({ corpses: killed.corpses, kill }));
});

test('corpse and kill snapshots retain no mutable enemy type reference after a kill', () => {
  const mutableType = { label: 'swarmer' };
  const killed = fireWeapon(targetState({ hp: 1, type: mutableType }), centeredView);
  const kill = eventsOf(killed, 'kill')[0];

  mutableType.label = 'bulwark';

  assert.deepEqual(
    [killed.corpses[0].type, kill.enemyType, kill.corpse.type],
    ['stinger', 'stinger', 'stinger']
  );
});

test('corpse cap evicts the oldest non-elite before a queen', () => {
  const corpses = [
    { id: 1, enemyId: 11, type: 'stinger', elite: false, age: 7, lifetime: 8 },
    { id: 2, enemyId: 12, type: 'bulwark', elite: true, age: 6, lifetime: 12 },
    { id: 3, enemyId: 13, type: 'stinger', elite: false, age: 5, lifetime: 8 },
    { id: 4, enemyId: 14, type: 'swarmer', elite: false, age: 4, lifetime: 8 }
  ];
  const state = targetState({ hp: 1, type: 'swarmer', corpses });
  const capped = fireWeapon(state, centeredView);
  assert.equal(capped.corpses.length, 4);
  assert.ok(capped.corpses.some((corpse) => corpse.elite));
  assert.equal(capped.corpses.some((corpse) => corpse.id === 1), false);
  assert.deepEqual(state.corpses, corpses);
});

test('corpse cap evicts the oldest corpse when every snapshot is elite', () => {
  const corpses = [
    { id: 1, enemyId: 11, type: 'bulwark', elite: true, age: 4, lifetime: 12 },
    { id: 2, enemyId: 12, type: 'bulwark', elite: true, age: 9, lifetime: 12 },
    { id: 3, enemyId: 13, type: 'bulwark', elite: true, age: 6, lifetime: 12 },
    { id: 4, enemyId: 14, type: 'bulwark', elite: true, age: 7, lifetime: 12 }
  ];
  const capped = fireWeapon(
    targetState({ hp: 1, type: 'bulwark', corpses, elite: true }),
    centeredView
  );
  assert.equal(capped.corpses.length, 4);
  assert.equal(capped.corpses.some((corpse) => corpse.id === 2), false);
});

test('corpse motion is deterministic, bounded, and does not mutate prior state', () => {
  const state = mission(17);
  state.spawnTimer = 100;
  state.corpses = [{
    id: 1, enemyId: 7, type: 'stinger', elite: false, yaw: 3, pitch: 4,
    distance: 0.6, size: 1, phase: 0.2, age: 0, lifetime: 8, seed: 17,
    fallVelocity: -10, roll: 0
  }];
  const before = structuredClone(state.corpses);

  const advanced = updateGame(state, centeredView, 0.2);
  assert.deepEqual(advanced.corpses, [{
    id: 1, enemyId: 7, type: 'stinger', elite: false, yaw: 3, pitch: 2,
    distance: 0.6, size: 1, phase: 0.2, age: 0.2, lifetime: 8, seed: 17,
    fallVelocity: -13, roll: 0.48
  }]);
  assert.deepEqual(state.corpses, before);
  assert.deepEqual(updateGame(structuredClone(state), centeredView, 0.2).corpses, advanced.corpses);
});

test('normal corpses expire at eight seconds while queens last until twelve', () => {
  const state = mission(19);
  state.spawnTimer = 100;
  state.corpses = [
    { id: 1, elite: false, age: 7.9, lifetime: 8, pitch: -28, fallVelocity: -24, roll: 0, seed: 2 },
    { id: 2, elite: true, age: 7.9, lifetime: 12, pitch: -28, fallVelocity: -24, roll: 0, seed: 3 }
  ];

  let advanced = updateGame(state, centeredView, 0.2);
  assert.deepEqual(advanced.corpses.map(({ id }) => id), [2]);
  advanced = updateGame(advanced, centeredView, 2);
  advanced = updateGame(advanced, centeredView, 1.9);
  assert.equal(advanced.corpses.length, 0);
});

test('malformed shot and corpse numerics fall back without throwing or leaking NaN', () => {
  const fired = fireWeapon(targetState(), { yaw: Symbol('yaw'), pitch: Symbol('pitch') });
  assert.deepEqual(
    eventsOf(fired, 'shoot').map(({ yaw, pitch }) => ({ yaw, pitch })),
    [{ yaw: 0, pitch: 0 }]
  );

  const state = mission(23);
  state.spawnTimer = 100;
  state.corpses = [{
    id: 1,
    elite: false,
    age: Symbol('age'),
    lifetime: Infinity,
    pitch: Symbol('pitch'),
    fallVelocity: { valueOf() { throw new Error('fallVelocity'); } },
    roll: NaN,
    seed: Symbol('seed')
  }];
  const corpse = updateGame(state, centeredView, 0.1).corpses[0];
  for (const field of ['age', 'lifetime', 'pitch', 'fallVelocity', 'roll', 'seed']) {
    assert.equal(Number.isFinite(corpse[field]), true, `${field} must be finite`);
  }
  assert.equal(corpse.lifetime, 8);
});

test('fireWeapon rejects the old far-target edge after sharing the visual boost', () => {
  const state = startMission(createInitialState({ seed: 88, duration: 90 }));
  state.enemies = [{
    id: 88,
    type: 'stinger',
    size: 1,
    distance: 1.09,
    yaw: 10.2,
    pitch: 0,
    hp: 2,
    maxHp: 2,
    points: 100,
    hitFlash: 0,
    phase: 0,
    orbit: 0,
    orbitSpeed: 0,
    bob: 0,
    bobSpeed: 0,
    bank: 0,
    divePulse: 0,
    attackCooldown: 0
  }];

  const shot = fireWeapon(state, { yaw: 0, pitch: 0 });

  assert.ok(shot.events.some((event) => event.type === 'miss'));
  assert.equal(shot.enemies[0].hp, 2);
});

test('burst consumes three rounds and emits three weapon-tagged shots', () => {
  const state = targetState({ hp: 9 });
  state.selectedWeapon = 'burst';
  state.weaponAmmo.burst = 24;
  state.ammo = 24;

  const next = fireWeapon(state, centeredView);

  assert.equal(next.ammo, 21);
  assert.equal(next.weaponAmmo.burst, 21);
  assert.equal(next.stats.shots, 3);
  assert.equal(eventsOf(next, 'shoot').length, 3);
  assert.ok(eventsOf(next, 'shoot').every((event) => event.weaponId === 'burst'));
  assert.equal(next.enemies[0].hp, 3);
});

test('scatter emits six bounded pellet poses from one shell', () => {
  const state = targetState({ hp: 20 });
  state.selectedWeapon = 'scatter';
  state.weaponAmmo.scatter = 6;
  state.ammo = 6;

  const next = fireWeapon(state, centeredView);
  const shots = eventsOf(next, 'shoot');

  assert.equal(next.ammo, 5);
  assert.equal(next.stats.shots, 6);
  assert.equal(shots.length, 6);
  assert.equal(new Set(shots.map((event) => event.weaponId)).size, 1);
  assert.ok(shots.every((event) => Math.abs(event.yaw) <= 5.5));
  assert.ok(shots.some((event) => event.yaw < 0) && shots.some((event) => event.yaw > 0));
});

test('rail damages up to three aligned enemies in distance order', () => {
  const state = targetState({ hp: 6 });
  state.selectedWeapon = 'rail';
  state.weaponAmmo.rail = 3;
  state.ammo = 3;
  state.enemies[0].pitch = 4;
  state.enemies.push(
    { ...state.enemies[0], id: 2, distance: 0.8 },
    { ...state.enemies[0], id: 3, distance: 1 }
  );

  const next = fireWeapon(state, { yaw: 0, pitch: 8 });

  assert.deepEqual(eventsOf(next, 'hit').map((event) => event.enemyId), [1, 2, 3]);
  assert.ok(next.enemies.every((enemy) => enemy.hp === 1));
  assert.ok(eventsOf(next, 'shoot').every((event) => event.weaponId === 'rail'));
});

test('cryo hit applies a bounded slow effect and update expires it', () => {
  const state = targetState({ hp: 3 });
  state.selectedWeapon = 'cryo';
  state.weaponAmmo.cryo = 12;
  state.ammo = 12;

  const frozen = fireWeapon(state, centeredView);
  assert.equal(frozen.enemies[0].slowTimer, 2.5);
  assert.equal(frozen.enemies[0].slowFactor, 0.35);
  assert.equal(eventsOf(frozen, 'freeze').length, 1);

  const thawed = updateGame(updateGame(frozen, centeredView, 2), centeredView, 0.6);
  assert.equal(thawed.enemies[0].slowTimer, 0);
  assert.equal(thawed.enemies[0].slowFactor, 1);
});

test('selectWeapon preserves independent magazines and uses a safe fallback', () => {
  const state = targetState();
  state.weaponAmmo.sidearm = 4;
  state.weaponAmmo.burst = 19;

  const selected = selectWeapon(state, 'burst');
  assert.equal(selected.selectedWeapon, 'burst');
  assert.equal(selected.ammo, 19);
  assert.equal(selectWeapon(selected, 'hostile').selectedWeapon, 'sidearm');
  assert.equal(selectWeapon(selected, 'hostile').ammo, 4);
});
