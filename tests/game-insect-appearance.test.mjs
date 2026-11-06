import assert from 'node:assert/strict';
import test from 'node:test';

import { insectAppearance } from '../public/game/src/insect-appearance.mjs';

test('appearance is deterministic, bounded, and role-specific', () => {
  assert.deepEqual(insectAppearance(7, 'stinger', false), insectAppearance(7, 'stinger', false));
  assert.notDeepEqual(insectAppearance(7, 'stinger', false), insectAppearance(8, 'stinger', false));

  const queen = insectAppearance(7, 'bulwark', true);
  assert.equal(queen.species, 'queen');
  assert.equal(queen.baseColor, 0x241a14);
  assert.equal(queen.fluidColor, 0xd46b1f);
  assert.equal(queen.wingTint, 0xc8b7a2);
  assert.equal(queen.weakPointColor, 0xff7a32);
  assert.ok(queen.roughness >= 0.58 && queen.roughness <= 0.88);
  assert.ok(queen.metalness >= 0 && queen.metalness <= 0.18);
});

test('appearance safely normalizes malformed ids and unknown types', () => {
  const throwingId = {
    toString() {
      throw new Error('uncooperative id');
    }
  };
  const throwingType = {
    [Symbol.toPrimitive]() {
      throw new Error('uncooperative type');
    }
  };

  assert.doesNotThrow(() => insectAppearance(Symbol('insect'), 'unknown'));
  assert.deepEqual(
    insectAppearance(throwingId, 'unknown'),
    insectAppearance(throwingId, 'unknown')
  );
  assert.equal(insectAppearance(4, 'unknown').baseColor, 0x302a19);
  assert.equal(insectAppearance(4, throwingType).baseColor, 0x302a19);
});

test('appearance treats inherited type keys as the complete stinger fallback', () => {
  const expected = insectAppearance(12, 'stinger', true);

  for (const type of ['__proto__', 'toString']) {
    const appearance = insectAppearance(12, type, true);

    assert.deepEqual(appearance, expected);
    for (const value of Object.values(appearance)) {
      if (typeof value === 'number') assert.ok(Number.isFinite(value));
    }
  }
});

test('appearance only treats a strict true elite flag as the queen variant', () => {
  const ordinary = insectAppearance(12, 'bulwark', false);
  for (const value of [1, 'true', {}, [], null]) {
    const appearance = insectAppearance(12, 'bulwark', value);
    assert.equal(appearance.species, 'bulwark');
    assert.equal(appearance.roughness, ordinary.roughness);
    assert.equal(appearance.metalness, ordinary.metalness);
  }
  assert.equal(insectAppearance(12, 'bulwark', true).species, 'queen');
});
