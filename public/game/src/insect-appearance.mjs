import { speciesForEnemy, speciesProfile } from './species-profile.mjs';

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function hashId(id) {
  let text = '';
  try {
    text = String(id);
  } catch {
    // Keep unusable IDs deterministic without allowing descriptor creation to throw.
  }

  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function insectAppearance(id, type = 'stinger', elite = false) {
  const isElite = elite === true;
  const species = speciesForEnemy(type, isElite);
  const profile = speciesProfile(species);
  const variation = ((hashId(id) & 255) / 255 - 0.5) * 0.08;

  return {
    species,
    modelKind: profile.modelKind,
    wingStyle: profile.wingStyle,
    weakPointStyle: profile.weakPointStyle,
    deathStyle: profile.deathStyle,
    baseColor: profile.baseColor,
    fluidColor: profile.fluidColor,
    wingTint: profile.wingTint,
    colorLift: variation,
    roughness: clamp(profile.roughness - (isElite ? 0.04 : 0), 0.58, 0.88),
    metalness: clamp(profile.metalness + (isElite ? 0.04 : 0), 0, 0.18),
    weakPointColor: profile.weakPointColor
  };
}
