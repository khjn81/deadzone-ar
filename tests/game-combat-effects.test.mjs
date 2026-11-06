import assert from 'node:assert/strict';
import test from 'node:test';

import { createCombatEffects } from '../public/game/src/combat-effects.mjs';

test('one accepted shoot event creates one casing exactly once', () => {
  const effects = createCombatEffects();
  effects.present({ id: 10, type: 'shoot', yaw: 3, pitch: 2, effectSeed: 19 });
  effects.present({ id: 10, type: 'shoot', yaw: 3, pitch: 2, effectSeed: 19 });
  assert.equal(effects.snapshot().casings.length, 1);
});

test('retains weapon identity across casings, impacts, and particles', () => {
  const effects = createCombatEffects();
  effects.present({ id: 10, type: 'shoot', weaponId: 'rail', yaw: 3, pitch: 2, effectSeed: 19 });
  effects.present({ id: 11, type: 'miss', weaponId: 'cryo', yaw: 4, pitch: 1, effectSeed: 20 });
  effects.present({ id: 12, type: 'hit', weaponId: 'cryo', yaw: 5, pitch: 0, effectSeed: 21 });
  const view = effects.snapshot();

  assert.equal(view.casings[0].weaponId, 'rail');
  assert.equal(view.impacts[0].weaponId, 'cryo');
  assert.ok(view.fragments.every(({ weaponId }) => weaponId === 'cryo'));
  assert.ok(view.fluids.every(({ weaponId }) => weaponId === 'cryo'));
});

test('effect pools enforce every global cap', () => {
  const effects = createCombatEffects();
  for (let id = 1; id <= 60; id += 1) {
    effects.present({ id, type: 'shoot', yaw: 0, pitch: 0, effectSeed: id });
    effects.present({ id: id + 100, type: 'miss', yaw: id, pitch: 0, effectSeed: id });
    effects.present({ id: id + 200, type: 'hit', yaw: id, pitch: 0, effectSeed: id });
  }
  const view = effects.snapshot();
  assert.equal(view.casings.length, 20);
  assert.equal(view.impacts.length, 8);
  assert.ok(view.fragments.length + view.fluids.length <= 36);
});

test('particle cap survives expiry filtering before later misses', () => {
  const effects = createCombatEffects();
  for (let id = 1; id <= 6; id += 1) {
    effects.present({ id, type: 'miss', yaw: id, pitch: 0, effectSeed: id });
  }
  assert.equal(effects.snapshot().fragments.length, 36);

  effects.update(0.1);
  for (let id = 7; id <= 10; id += 1) {
    effects.present({ id, type: 'miss', yaw: id, pitch: 0, effectSeed: id });
  }
  const view = effects.snapshot();
  assert.equal(view.fragments.length + view.fluids.length, 36);
});

test('casings bounce once and expire by 1.4 seconds', () => {
  const effects = createCombatEffects();
  effects.present({ id: 1, type: 'shoot', yaw: 0, pitch: 0, effectSeed: 9 });
  effects.update(0.8);
  assert.equal(effects.snapshot().casings[0].bounceCount, 1);
  effects.update(0.61);
  assert.equal(effects.snapshot().casings.length, 0);
});

test('miss impacts preserve authoritative yaw and pitch', () => {
  const effects = createCombatEffects();
  effects.present({ id: 4, type: 'miss', yaw: -37, pitch: 11, effectSeed: 8 });
  assert.deepEqual(
    effects.snapshot().impacts.map(({ yaw, pitch }) => ({ yaw, pitch })),
    [{ yaw: -37, pitch: 11 }]
  );
});

test('impact marks vary by seed, flash briefly, and fade near their bounded expiry', () => {
  const effects = createCombatEffects();
  effects.present({ id: 1, type: 'miss', yaw: 0, pitch: 0, effectSeed: 8 });
  effects.present({ id: 2, type: 'miss', yaw: 2, pitch: -1, effectSeed: 8000 });

  let impacts = effects.snapshot().impacts;
  assert.ok(impacts.every(({ lifetime }) => lifetime >= 10 && lifetime <= 14));
  assert.ok(impacts.every(({ opacity, flashOpacity }) => opacity === 1 && flashOpacity === 1));
  assert.notEqual(impacts[0].rotation, impacts[1].rotation);
  assert.notEqual(impacts[0].markScale, impacts[1].markScale);
  assert.ok(impacts.every(({ rotation }) => rotation >= -Math.PI && rotation <= Math.PI));
  assert.ok(impacts.every(({ markScale }) => markScale >= 0.86 && markScale <= 1.18));

  effects.update(0.2);
  impacts = effects.snapshot().impacts;
  assert.ok(impacts.every(({ opacity }) => opacity === 1));
  assert.ok(impacts.every(({ flashOpacity }) => flashOpacity === 0));

  effects.update(9.3);
  impacts = effects.snapshot().impacts;
  assert.ok(impacts[0].opacity > 0 && impacts[0].opacity < 0.5);
});

test('all combat particles retain their sanitized event direction', () => {
  const effects = createCombatEffects();
  effects.present({ id: 1, type: 'miss', yaw: -37, pitch: 11, effectSeed: 8 });
  effects.present({ id: 2, type: 'hit', yaw: 4, pitch: -2, effectSeed: 9 });
  effects.present({ id: 3, type: 'critical-hit', yaw: 5, pitch: -3, effectSeed: 10 });
  effects.present({ id: 4, type: 'kill', yaw: 6, pitch: -4, effectSeed: 11 });
  const view = effects.snapshot();

  assert.ok(view.fragments.length >= 6);
  assert.ok(view.fragments.every(({ yaw, pitch }) => yaw === -37 && pitch === 11));
  assert.deepEqual(
    view.fluids.map(({ id, yaw, pitch }) => ({ id, yaw, pitch })),
    [
      ...Array.from({ length: 4 }, () => ({ id: 2, yaw: 4, pitch: -2 })),
      ...Array.from({ length: 6 }, () => ({ id: 3, yaw: 5, pitch: -3 })),
      ...Array.from({ length: 8 }, () => ({ id: 4, yaw: 6, pitch: -4 }))
    ]
  );
});

test('the same event sequence creates identical seeded effects', () => {
  const first = createCombatEffects();
  const second = createCombatEffects();
  const events = [
    { id: 1, type: 'shoot', yaw: 2, pitch: -1, effectSeed: 44 },
    { id: 2, type: 'miss', yaw: -37, pitch: 11, effectSeed: 8 },
    { id: 3, type: 'critical-hit', yaw: 4, pitch: 3, effectSeed: 99 }
  ];
  for (const event of events) {
    first.present(event);
    second.present(event);
  }
  first.update(0.23);
  second.update(0.23);
  assert.deepEqual(first.snapshot(), second.snapshot());
});

test('rejected and malformed events leave isolated finite state', () => {
  const effects = createCombatEffects();
  const throwingEvent = {
    get id() { throw new Error('unreadable'); }
  };

  assert.doesNotThrow(() => {
    effects.present({ id: 1, type: 'shoot', accepted: false, effectSeed: 7 });
    effects.present({ id: Symbol('bad'), type: 'shoot', effectSeed: Symbol('bad') });
    effects.present(throwingEvent);
    effects.update(Symbol('dt'));
  });
  assert.deepEqual(effects.snapshot(), {
    casings: [], impacts: [], fragments: [], fluids: []
  });

  effects.present({ id: 2, type: 'miss', yaw: Symbol('yaw'), pitch: Infinity, effectSeed: 3 });
  const view = effects.snapshot();
  view.impacts[0].yaw = 999;
  assert.equal(effects.snapshot().impacts[0].yaw, 0);
  assert.ok(Object.values(effects.snapshot()).flat().every((record) =>
    Object.values(record).every((value) => typeof value !== 'number' || Number.isFinite(value))
  ));
});

test('only safe positive integer event ids can create or reserve effects', () => {
  const effects = createCombatEffects();
  const throwingEvent = {
    get id() { throw new Error('unreadable'); },
    type: 'shoot'
  };
  const invalidIds = [
    null, '1', 1n, 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, Symbol('bad')
  ];

  assert.doesNotThrow(() => {
    for (const id of invalidIds) effects.present({ id, type: 'shoot', effectSeed: 7 });
    effects.present(throwingEvent);
  });
  assert.equal(effects.snapshot().casings.length, 0);

  effects.present({ id: 1, type: 'shoot', effectSeed: 7 });
  effects.present({ id: 1, type: 'shoot', effectSeed: 7 });
  assert.equal(effects.snapshot().casings.length, 1);
});

test('clear removes active effects and permits a future event id to be presented', () => {
  const effects = createCombatEffects();
  effects.present({ id: 1, type: 'shoot', effectSeed: 2 });
  effects.clear();
  effects.present({ id: 1, type: 'shoot', effectSeed: 2 });
  assert.equal(effects.snapshot().casings.length, 1);
});
