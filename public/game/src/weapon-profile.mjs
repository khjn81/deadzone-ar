const PROFILE_DATA = {
  sidearm: {
    id: 'sidearm',
    label: 'SIDEARM',
    subtitle: '9MM',
    role: '정밀 단발',
    color: '#b8ff3d',
    accent: 'toxic',
    magazine: 8,
    reloadDuration: 1.35,
    fireCooldown: 0.16,
    ammoPerTrigger: 1,
    projectiles: 1,
    spreadDegrees: 0,
    damage: 1,
    criticalDamage: 2,
    pierceTargets: 1,
    slowFactor: 1,
    slowDuration: 0
  },
  burst: {
    id: 'burst',
    label: 'BURST SMG',
    subtitle: '5.56',
    role: '안정적인 3점사',
    color: '#5fe4d1',
    accent: 'cyan',
    magazine: 24,
    reloadDuration: 1.75,
    fireCooldown: 0.36,
    ammoPerTrigger: 3,
    projectiles: 3,
    spreadDegrees: 0.7,
    damage: 1,
    criticalDamage: 2,
    pierceTargets: 1,
    slowFactor: 1,
    slowDuration: 0
  },
  scatter: {
    id: 'scatter',
    label: 'SCATTER',
    subtitle: '12G',
    role: '근거리 산탄',
    color: '#ffb15c',
    accent: 'orange',
    magazine: 6,
    reloadDuration: 1.6,
    fireCooldown: 0.65,
    ammoPerTrigger: 1,
    projectiles: 6,
    spreadDegrees: 5.5,
    damage: 1,
    criticalDamage: 2,
    pierceTargets: 1,
    slowFactor: 1,
    slowDuration: 0
  },
  rail: {
    id: 'rail',
    label: 'RAIL',
    subtitle: 'HV',
    role: '고위력 관통',
    color: '#dfff73',
    accent: 'rail',
    magazine: 3,
    reloadDuration: 2.05,
    fireCooldown: 0.9,
    ammoPerTrigger: 1,
    projectiles: 1,
    spreadDegrees: 0,
    damage: 5,
    criticalDamage: 8,
    pierceTargets: 3,
    slowFactor: 1,
    slowDuration: 0
  },
  cryo: {
    id: 'cryo',
    label: 'CRYO',
    subtitle: 'FROST',
    role: '적 감속 제어',
    color: '#8ad9ff',
    accent: 'ice',
    magazine: 12,
    reloadDuration: 1.5,
    fireCooldown: 0.28,
    ammoPerTrigger: 1,
    projectiles: 1,
    spreadDegrees: 0,
    damage: 1,
    criticalDamage: 2,
    pierceTargets: 1,
    slowFactor: 0.35,
    slowDuration: 2.5
  }
};

export const WEAPON_IDS = Object.freeze(Object.keys(PROFILE_DATA));
export const DEFAULT_WEAPON_ID = 'burst';
export const WEAPON_PROFILES = Object.freeze(Object.fromEntries(
  WEAPON_IDS.map((id) => [id, Object.freeze({ ...PROFILE_DATA[id] })])
));

export function normalizeWeaponId(value) {
  return typeof value === 'string' && Object.hasOwn(WEAPON_PROFILES, value)
    ? value
    : 'sidearm';
}

export function weaponProfile(value) {
  return WEAPON_PROFILES[normalizeWeaponId(value)];
}

export function createWeaponAmmo() {
  return Object.fromEntries(WEAPON_IDS.map((id) => [id, weaponProfile(id).magazine]));
}
