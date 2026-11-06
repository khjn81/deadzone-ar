import assert from 'node:assert/strict';
import test from 'node:test';

import { shortestAngleDelta } from '../public/game/src/ar-geometry.mjs';
import { planEnemySpawn } from '../public/game/src/spawn-placement.mjs';

const rolls = Object.freeze({ laneRoll: 0.17, pitchRoll: 0.25, distanceRoll: 0.75 });
const freshView = Object.freeze({ yaw: 0, pitch: 0, sensorFresh: true });

test('keeps AR spawns outside the current view across angle wrapping', () => {
  for (const yaw of [0, 77, 170, -175]) {
    const placement = planEnemySpawn({
      view: { yaw, sensorFresh: true },
      enemies: [],
      elite: false,
      ...rolls
    });
    assert.ok(Math.abs(shortestAngleDelta(placement.baseYaw, yaw)) >= 38);
    assert.ok(Math.abs(shortestAngleDelta(placement.yaw, yaw)) >
      Math.abs(shortestAngleDelta(placement.baseYaw, yaw)));
    assert.ok(placement.baseYaw >= -180 && placement.baseYaw < 180);
  }
});

test('uses deterministic airborne metadata without retaining a ground spawn kind', () => {
  const input = { view: freshView, enemies: [], elite: false, ...rolls };
  const first = planEnemySpawn(input);
  assert.deepEqual(planEnemySpawn(input), first);
  assert.ok(first.basePitch >= -12 && first.basePitch <= 18);
  assert.equal(first.pitch, first.basePitch);
  assert.ok(first.distance >= 1.03 && first.distance <= 1.15);
  assert.ok(Math.abs(first.entryYawOffset) >= 12 && Math.abs(first.entryYawOffset) <= 16);
  assert.equal(first.spawnSide, first.entryYawOffset < 0 ? 'left' : 'right');
  assert.equal(first.spawnKind, 'air-edge');
  assert.equal(JSON.stringify(first).includes('ground-edge'), false);
});

test('uses every exact normal and elite AR lane with required entry metadata', () => {
  const laneSets = [
    { elite: false, lanes: [-46, 46, -58, 58, -72, 72], entryMagnitude: 14 },
    { elite: true, lanes: [-68, 68, -78, 78], entryMagnitude: 18 }
  ];

  for (const { elite, lanes, entryMagnitude } of laneSets) {
    for (const expectedBaseYaw of lanes) {
      const placement = planEnemySpawn({
        view: { yaw: 0, sensorFresh: true },
        enemies: lanes
          .filter((lane) => lane !== expectedBaseYaw)
          .map((baseYaw) => ({ baseYaw })),
        elite,
        laneRoll: 0.5,
        pitchRoll: 0.5,
        distanceRoll: 0.5
      });
      const direction = expectedBaseYaw < 0 ? -1 : 1;
      assert.deepEqual(placement, {
        baseYaw: expectedBaseYaw,
        yaw: expectedBaseYaw + direction * entryMagnitude,
        basePitch: 3,
        pitch: 3,
        distance: 1.09,
        entryYawOffset: direction * entryMagnitude,
        spawnSide: direction < 0 ? 'left' : 'right',
        spawnKind: 'air-edge'
      });
    }
  }
});

test('uses offscreen airborne lanes across the full vertical combat band', () => {
  const low = planEnemySpawn({
    view: freshView,
    laneRoll: 0,
    pitchRoll: 0,
    distanceRoll: 0
  });
  assert.deepEqual(low, {
    baseYaw: -46,
    yaw: -58,
    basePitch: -12,
    pitch: -12,
    distance: 1.03,
    entryYawOffset: -12,
    spawnSide: 'left',
    spawnKind: 'air-edge'
  });

  const high = planEnemySpawn({
    view: freshView,
    laneRoll: 1,
    pitchRoll: 1,
    distanceRoll: 1
  });
  assert.deepEqual(high, {
    baseYaw: -46,
    yaw: -62,
    basePitch: 18,
    pitch: 18,
    distance: 1.15,
    entryYawOffset: -16,
    spawnSide: 'left',
    spawnKind: 'air-edge'
  });
  assert.ok(Math.abs(shortestAngleDelta(low.yaw, freshView.yaw)) >= 38);
  assert.ok(Math.abs(shortestAngleDelta(high.yaw, freshView.yaw)) >= 38);
});

test('selects a less crowded lane without mutating existing enemies', () => {
  const existing = [{ baseYaw: -46 }, { yaw: -58 }, { baseYaw: 46 }];
  const snapshot = structuredClone(existing);
  const placement = planEnemySpawn({
    view: { yaw: 0, sensorFresh: true },
    enemies: existing,
    elite: false,
    ...rolls
  });
  assert.ok(Math.min(...existing.map((enemy) =>
    Math.abs(shortestAngleDelta(placement.baseYaw, enemy.baseYaw ?? enemy.yaw)))) >= 12);
  assert.deepEqual(existing, snapshot);
});

test('keeps touch spawn base and initial yaw reachable across the yaw range', () => {
  for (const yaw of [-75, 30, 75]) {
    const placement = planEnemySpawn({ view: { yaw, sensorFresh: false }, ...rolls });
    assert.ok(placement.baseYaw >= -76 && placement.baseYaw <= 76);
    assert.ok(placement.yaw >= -76 && placement.yaw <= 76);
    assert.ok(Math.abs(placement.baseYaw - yaw) >= 38);
  }
});

test('prefers a touch lane with the full entry offset over a room-limited lane', () => {
  const placement = planEnemySpawn({
    view: { yaw: 20, sensorFresh: false },
    enemies: [-26, -38, 76, -52].map((baseYaw) => ({ baseYaw })),
    laneRoll: 0.5,
    pitchRoll: 0.5,
    distanceRoll: 0.5
  });
  assert.equal(placement.baseYaw, -26);
  assert.equal(placement.entryYawOffset, -14);
  assert.equal(placement.yaw, -40);
});

test('caps a touch elite offset only when no full-offset lane fits', () => {
  const placement = planEnemySpawn({
    view: { yaw: 0, sensorFresh: false },
    elite: true,
    ...rolls
  });
  assert.equal(placement.baseYaw, -68);
  assert.equal(placement.entryYawOffset, -8);
  assert.equal(placement.yaw, -76);
});

test('uses safe defaults for null planner and view inputs', () => {
  const defaults = planEnemySpawn();
  assert.deepEqual(planEnemySpawn(null), defaults);
  assert.deepEqual(planEnemySpawn({ view: null }), defaults);
});

test('uses midpoint defaults for null rolls instead of endpoint values', () => {
  const placement = planEnemySpawn({
    view: { yaw: 0, sensorFresh: true },
    laneRoll: null,
    pitchRoll: null,
    distanceRoll: null
  });
  assert.equal(placement.entryYawOffset, -14);
  assert.equal(placement.basePitch, 3);
  assert.equal(placement.pitch, 3);
  assert.equal(placement.distance, 1.09);
});

test('ignores null blank and non-numeric base bearings before falling through to yaw', () => {
  for (const baseYaw of [null, '', '   ', 'not-a-bearing']) {
    const placement = planEnemySpawn({
      view: { yaw: 0, sensorFresh: true },
      enemies: [{ baseYaw, yaw: -72 }],
      laneRoll: 0,
      pitchRoll: 0.5,
      distanceRoll: 0.5
    });
    assert.equal(placement.baseYaw, 72);
  }
});

test('normalizes Symbol values without throwing or losing deterministic fallbacks', () => {
  const input = {
    view: { yaw: Symbol('yaw'), sensorFresh: true },
    enemies: [{ baseYaw: Symbol('bearing'), yaw: -72 }],
    laneRoll: Symbol('lane'),
    pitchRoll: Symbol('pitch'),
    distanceRoll: Symbol('distance')
  };
  const expected = {
    baseYaw: 72,
    yaw: 86,
    basePitch: 3,
    pitch: 3,
    distance: 1.09,
    entryYawOffset: 14,
    spawnSide: 'right',
    spawnKind: 'air-edge'
  };
  assert.deepEqual(planEnemySpawn(input), expected);
  assert.deepEqual(planEnemySpawn(input), expected);
  assert.deepEqual(planEnemySpawn(Symbol('options')), planEnemySpawn());
  assert.deepEqual(planEnemySpawn({ view: Symbol('view') }), planEnemySpawn());
});

test('normalizes throwing numeric conversions without throwing or changing results', () => {
  const throwing = {
    valueOf() {
      throw new Error('conversion exploded');
    }
  };
  const input = {
    view: { yaw: throwing, sensorFresh: true },
    enemies: [{ baseYaw: throwing, yaw: -72 }],
    laneRoll: throwing,
    pitchRoll: throwing,
    distanceRoll: throwing
  };
  const expected = {
    baseYaw: 72,
    yaw: 86,
    basePitch: 3,
    pitch: 3,
    distance: 1.09,
    entryYawOffset: 14,
    spawnSide: 'right',
    spawnKind: 'air-edge'
  };
  assert.deepEqual(planEnemySpawn(input), expected);
  assert.deepEqual(planEnemySpawn(input), expected);
  assert.deepEqual(planEnemySpawn(throwing), planEnemySpawn());
  assert.deepEqual(planEnemySpawn({ view: throwing }), planEnemySpawn());
});

test('uses wider elite lanes and safe midpoint fallbacks', () => {
  const normal = planEnemySpawn({ view: { yaw: 0, sensorFresh: true }, ...rolls });
  const elite = planEnemySpawn({
    view: { yaw: 0, sensorFresh: true },
    elite: true,
    laneRoll: Number.NaN,
    pitchRoll: Number.NaN,
    distanceRoll: Number.NaN
  });
  assert.ok(Math.abs(elite.baseYaw) >= 68);
  assert.ok(Math.abs(elite.baseYaw) > Math.abs(normal.baseYaw));
  assert.equal(Math.abs(elite.entryYawOffset), 18);
  assert.equal(elite.basePitch, 3);
  assert.equal(elite.pitch, 3);
  assert.equal(elite.distance, 1.09);
});
