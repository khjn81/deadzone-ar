import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_WEAPON_ID,
  WEAPON_IDS,
  createWeaponAmmo,
  normalizeWeaponId,
  weaponProfile
} from '../public/game/src/weapon-profile.mjs';

test('exposes exactly five distinct weapon contracts', () => {
  assert.deepEqual(WEAPON_IDS, ['sidearm', 'burst', 'scatter', 'rail', 'cryo']);
  assert.equal(DEFAULT_WEAPON_ID, 'burst');
  assert.equal(weaponProfile('burst').projectiles, 3);
  assert.equal(weaponProfile('scatter').spreadDegrees, 5.5);
  assert.equal(weaponProfile('rail').pierceTargets, 3);
  assert.equal(weaponProfile('cryo').slowFactor, 0.35);
  assert.notEqual(weaponProfile('sidearm').magazine, weaponProfile('burst').magazine);
});

test('normalizes hostile IDs and returns independent magazines', () => {
  assert.equal(normalizeWeaponId('unknown'), 'sidearm');
  assert.equal(normalizeWeaponId(Symbol('hostile')), 'sidearm');
  const first = createWeaponAmmo();
  const second = createWeaponAmmo();
  first.burst = 0;
  assert.equal(second.burst, weaponProfile('burst').magazine);
});

test('profiles and nested metadata are immutable', () => {
  const profile = weaponProfile('cryo');
  assert.equal(Object.isFrozen(profile), true);
  assert.equal(Object.isFrozen(weaponProfile('rail')), true);
  assert.throws(() => { profile.magazine = 99; }, TypeError);
});
