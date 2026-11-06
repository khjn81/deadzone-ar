import assert from 'node:assert/strict';
import test from 'node:test';

import { createCorpseVisual, createLiveInsectVisual } from '../public/game/src/insect-visuals.mjs';
import { speciesProfile } from '../public/game/src/species-profile.mjs';

const visibleProjection = Object.freeze({ x: 195, y: 360, scale: 1, visible: true });

function makeCorpse(overrides = {}) {
  return {
    id: 1, enemyId: 4, type: 'stinger', elite: false, size: 1,
    yaw: 0, pitch: 0, distance: 0.7, phase: 0, age: 0, lifetime: 8, seed: 17,
    ...overrides
  };
}

function assertFiniteNumericFields(descriptor) {
  for (const value of Object.values(descriptor)) {
    if (typeof value === 'number') assert.ok(Number.isFinite(value));
  }
  for (const value of Object.values(descriptor.appearance)) {
    if (typeof value === 'number') assert.ok(Number.isFinite(value));
  }
}

test('live insects use their projected center without a ground contact', () => {
  const visual = createLiveInsectVisual(
    { id: 4, type: 'stinger', size: 1, distance: 0.7, phase: Math.PI, hitFlash: 0, bank: 0.2 },
    { x: 195, y: 360, scale: 1, visible: true }
  );

  assert.equal(visual.centerY, 360);
  assert.equal(visual.species, 'stinger');
  assert.equal(visual.modelKind, 'stinger');
  assert.equal(visual.wingStyle, 'wasp');
  assert.equal(visual.weakPointStyle, 'abdomen');
  assert.equal(visual.deathStyle, 'curl');
  assert.deepEqual(visual.silhouette, speciesProfile('stinger').silhouette);
  assert.equal(visual.wingPhase, 0.5);
  assert.equal('footY' in visual, false);
});

test('corpse descriptors tumble, settle, and fade deterministically', () => {
  const falling = createCorpseVisual(makeCorpse({ age: 0.4 }), visibleProjection);
  const resting = createCorpseVisual(makeCorpse({ age: 2 }), visibleProjection);
  const fading = createCorpseVisual(makeCorpse({ age: 7.8 }), visibleProjection);

  assert.equal(falling.state, 'falling');
  assert.equal(resting.state, 'resting');
  assert.ok(fading.opacity < resting.opacity);
  assert.deepEqual(falling, createCorpseVisual(makeCorpse({ age: 0.4 }), visibleProjection));
});

test('descriptor inputs tolerate Symbols and throwing numeric coercion', () => {
  const throwingNumber = {
    valueOf() {
      throw new Error('uncooperative number');
    }
  };
  const throwingType = {
    [Symbol.toPrimitive]() {
      throw new Error('uncooperative type');
    }
  };

  const live = createLiveInsectVisual(
    { id: Symbol('enemy'), type: throwingType, size: throwingNumber, distance: throwingNumber, phase: throwingNumber, bank: throwingNumber, hitFlash: throwingNumber },
    { x: throwingNumber, y: Symbol('point'), scale: throwingNumber, visible: true }
  );
  const corpse = createCorpseVisual(
    makeCorpse({ id: Symbol('corpse'), enemyId: Symbol('enemy'), age: throwingNumber, lifetime: Symbol('life'), size: throwingNumber, distance: throwingNumber, roll: throwingNumber }),
    { x: Symbol('point'), y: throwingNumber, scale: throwingNumber, visible: true }
  );

  assert.deepEqual(
    { x: live.x, centerY: live.centerY, height: live.height, depth: live.depth, bank: live.bank, hitFlash: live.hitFlash, wingPhase: live.wingPhase },
    { x: 0, centerY: 0, height: 74, depth: 1, bank: 0, hitFlash: 0, wingPhase: 0 }
  );
  assert.deepEqual(
    { x: corpse.x, centerY: corpse.centerY, height: corpse.height, depth: corpse.depth, rotation: corpse.rotation, curl: corpse.curl, opacity: corpse.opacity, state: corpse.state },
    { x: 0, centerY: 0, height: 74, depth: 1, rotation: 0, curl: 0, opacity: 1, state: 'falling' }
  );
});

test('live and corpse descriptors reject inherited type keys without mutating inputs', () => {
  const projection = Object.freeze({ x: 195, y: 360, scale: 1, visible: true });
  const enemy = Object.freeze({ id: 4, size: 1, distance: 0.7, phase: Math.PI, hitFlash: 0, bank: 0.2 });
  const corpse = Object.freeze(makeCorpse({ age: 2, roll: 0.3 }));
  const enemySnapshot = { ...enemy };
  const corpseSnapshot = { ...corpse };
  const expectedLive = createLiveInsectVisual({ ...enemy, type: 'stinger' }, projection);
  const expectedCorpse = createCorpseVisual({ ...corpse, type: 'stinger' }, projection);

  for (const type of ['__proto__', 'toString']) {
    const live = createLiveInsectVisual({ ...enemy, type }, projection);
    const fallen = createCorpseVisual({ ...corpse, type }, projection);

    assert.deepEqual(live, expectedLive);
    assert.deepEqual(fallen, expectedCorpse);
    assertFiniteNumericFields(live);
    assertFiniteNumericFields(fallen);
    assert.notEqual(live.appearance, expectedLive.appearance);
    assert.notEqual(fallen.appearance, expectedCorpse.appearance);
  }

  assert.deepEqual(enemy, enemySnapshot);
  assert.deepEqual(corpse, corpseSnapshot);
});

test('each gameplay role receives a distinct species descriptor and elite renders as queen', () => {
  const projection = Object.freeze({ x: 195, y: 360, scale: 1, visible: true });
  const roles = [
    ['swarmer', 'swarmer'],
    ['stinger', 'stinger'],
    ['bulwark', 'bulwark'],
    ['bulwark', 'queen', true]
  ];

  for (const [type, species, elite = false] of roles) {
    const live = createLiveInsectVisual({
      id: `${type}-${elite}`,
      type,
      elite,
      size: 1,
      distance: 0.7,
      phase: 0,
      hitFlash: 0,
      bank: 0
    }, projection);
    const corpse = createCorpseVisual(makeCorpse({ type, elite } ), projection);
    assert.equal(live.species, species);
    assert.equal(live.modelKind, species);
    assert.equal(corpse.species, species);
    assert.equal(corpse.modelKind, species);
    assert.equal(corpse.widthScale, live.widthScale);
    assert.equal(live.wingStyle, live.appearance.wingStyle);
    assert.equal(live.weakPointStyle, live.appearance.weakPointStyle);
    assert.equal(live.deathStyle, live.appearance.deathStyle);
    assert.deepEqual(live.silhouette, speciesProfile(species).silhouette);
    assert.deepEqual(corpse.silhouette, speciesProfile(species).silhouette);
  }
});

test('species silhouettes keep body, wing, and weak-point proportions intentionally distinct', () => {
  const silhouettes = ['swarmer', 'stinger', 'bulwark', 'queen'].map((species) => speciesProfile(species).silhouette);
  assert.equal(new Set(silhouettes.map(({ bodyWidth }) => bodyWidth)).size, silhouettes.length);
  assert.equal(new Set(silhouettes.map(({ bodyHeight }) => bodyHeight)).size, silhouettes.length);
  assert.equal(new Set(silhouettes.map(({ wingSpan }) => wingSpan)).size, silhouettes.length);
  assert.ok(silhouettes.every(({ weakPointScale }) => weakPointScale >= 0.7 && weakPointScale <= 1.2));
});

test('captures hostile type and elite getters once for a consistent visual profile', () => {
  const projection = Object.freeze({ x: 195, y: 360, scale: 1, visible: true });
  let liveTypeReads = 0;
  let corpseTypeReads = 0;
  const live = createLiveInsectVisual({
    id: 77,
    get type() {
      liveTypeReads += 1;
      return liveTypeReads === 1 ? 'bulwark' : 'stinger';
    },
    elite: false,
    size: 1,
    distance: 0.7,
    phase: 0,
    hitFlash: 0,
    bank: 0
  }, projection);
  const corpse = createCorpseVisual({
    id: 88,
    enemyId: 77,
    get type() {
      corpseTypeReads += 1;
      return corpseTypeReads === 1 ? 'bulwark' : 'stinger';
    },
    elite: false,
    size: 1,
    distance: 0.7,
    age: 2,
    lifetime: 8,
    roll: 0
  }, projection);

  assert.equal(liveTypeReads, 1);
  assert.equal(corpseTypeReads, 1);
  assert.equal(live.species, 'bulwark');
  assert.equal(live.appearance.species, 'bulwark');
  assert.equal(corpse.species, 'bulwark');
  assert.equal(corpse.appearance.species, 'bulwark');
});

test('non-boolean elite flags cannot promote a live or corpse descriptor to queen', () => {
  const projection = Object.freeze({ x: 195, y: 360, scale: 1, visible: true });
  for (const elite of [1, 'true', {}, []]) {
    const live = createLiveInsectVisual({
      id: `malformed-${String(elite)}`,
      type: 'bulwark',
      elite,
      size: 1,
      distance: 0.7,
      phase: 0,
      hitFlash: 0,
      bank: 0
    }, projection);
    const fallen = createCorpseVisual(makeCorpse({ type: 'bulwark', elite } ), projection);
    assert.equal(live.elite, false);
    assert.equal(live.species, 'bulwark');
    assert.equal(fallen.elite, false);
    assert.equal(fallen.species, 'bulwark');
  }
});
