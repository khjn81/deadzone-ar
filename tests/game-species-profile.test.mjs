import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SPECIES_PROFILES,
  speciesForEnemy,
  speciesProfile
} from '../public/game/src/species-profile.mjs';

const EXPECTED_SPECIES = ['swarmer', 'stinger', 'bulwark', 'queen'];
const NUMERIC_FIELDS = [
  'widthScale',
  'bodyScale',
  'wingRate',
  'baseColor',
  'fluidColor',
  'wingTint',
  'roughness',
  'metalness',
  'weakPointColor'
];

test('species profiles expose bounded render metadata and local model URLs', () => {
  assert.deepEqual(Object.keys(SPECIES_PROFILES), EXPECTED_SPECIES);

  for (const species of EXPECTED_SPECIES) {
    const profile = speciesProfile(species);
    assert.equal(Object.isFrozen(profile), true);
    assert.equal(profile.modelKind, species);
    assert.match(profile.modelUrl, /\/assets\/models\/infected-[a-z-]+\.glb$/);
    assert.equal(profile.modelUrl.includes('://'), true);
    assert.ok(profile.displayName.length > 0);
    for (const field of ['wingStyle', 'weakPointStyle', 'deathStyle']) {
      assert.equal(typeof profile[field], 'string');
      assert.ok(profile[field].length > 0);
    }
    for (const field of NUMERIC_FIELDS) {
      assert.equal(Number.isFinite(profile[field]), true, `${species}.${field} must be finite`);
    }
    assert.ok(profile.widthScale >= 0.5 && profile.widthScale <= 2.2);
    assert.ok(profile.bodyScale >= 0.5 && profile.bodyScale <= 2.2);
    assert.ok(profile.wingRate >= 0 && profile.wingRate <= 2.5);
    assert.ok(profile.roughness >= 0.45 && profile.roughness <= 0.95);
    assert.ok(profile.metalness >= 0 && profile.metalness <= 0.3);
    assert.equal(Object.isFrozen(profile.canvasPalette), true);
  }
});

test('enemy types map to matching species while elite always maps to queen', () => {
  assert.equal(speciesForEnemy('swarmer', false), 'swarmer');
  assert.equal(speciesForEnemy('stinger', false), 'stinger');
  assert.equal(speciesForEnemy('bulwark', false), 'bulwark');
  assert.equal(speciesForEnemy('bulwark', true), 'queen');
  assert.equal(speciesForEnemy('stinger', true), 'queen');
});

test('unknown or hostile species keys normalize to stinger without throwing', () => {
  const throwingType = {
    [Symbol.toPrimitive]() {
      throw new Error('uncooperative type');
    }
  };

  for (const value of [undefined, null, '', '__proto__', 'toString', throwingType]) {
    assert.doesNotThrow(() => speciesForEnemy(value, false));
    assert.equal(speciesForEnemy(value, false), 'stinger');
    assert.doesNotThrow(() => speciesProfile(value));
    assert.equal(speciesProfile(value).modelKind, 'stinger');
  }

  assert.equal(speciesForEnemy('stinger', 1), 'stinger');
  assert.equal(speciesForEnemy('stinger', true), 'queen');
});
