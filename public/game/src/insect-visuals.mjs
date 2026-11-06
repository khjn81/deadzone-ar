import { insectAppearance } from './insect-appearance.mjs';
import { speciesForEnemy, speciesProfile } from './species-profile.mjs';

const TAU = Math.PI * 2;

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function finiteNumber(value, fallback = 0) {
  try {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  } catch {
    return fallback;
  }
}

function phaseRatio(phase) {
  return ((finiteNumber(phase) % TAU) + TAU) % TAU / TAU;
}

function propertyOf(source, key, fallback) {
  try {
    return source == null ? fallback : source[key];
  } catch {
    return fallback;
  }
}

export function createLiveInsectVisual(enemy, projection) {
  const type = propertyOf(enemy, 'type', 'stinger');
  const elite = propertyOf(enemy, 'elite', false) === true;
  const species = speciesForEnemy(type, elite);
  const shape = speciesProfile(species);
  const height = clamp(
    74 * finiteNumber(propertyOf(projection, 'scale', 1), 1)
      * finiteNumber(propertyOf(enemy, 'size', 1), 1) * shape.bodyScale,
    34,
    176
  );
  return {
    id: propertyOf(enemy, 'id'),
    x: finiteNumber(propertyOf(projection, 'x')),
    centerY: finiteNumber(propertyOf(projection, 'y')),
    height,
    widthScale: shape.widthScale,
    wingRate: shape.wingRate,
    wingPhase: phaseRatio(propertyOf(enemy, 'phase')),
    depth: finiteNumber(propertyOf(enemy, 'distance', 1), 1),
    bank: clamp(finiteNumber(propertyOf(enemy, 'bank')), -0.65, 0.65),
    hitFlash: clamp(finiteNumber(propertyOf(enemy, 'hitFlash')) / 0.16, 0, 1),
    elite,
    species,
    modelKind: shape.modelKind,
    silhouette: shape.silhouette,
    wingStyle: shape.wingStyle,
    weakPointStyle: shape.weakPointStyle,
    deathStyle: shape.deathStyle,
    appearance: insectAppearance(propertyOf(enemy, 'id'), type, elite),
    visible: Boolean(propertyOf(projection, 'visible', false))
  };
}

export function createCorpseVisual(corpse, projection) {
  const age = Math.max(0, finiteNumber(propertyOf(corpse, 'age')));
  const lifetime = Math.max(0.1, finiteNumber(propertyOf(corpse, 'lifetime'), 8));
  const fallProgress = clamp(age / 0.9, 0, 1);
  const fade = clamp((lifetime - age) / 1.25, 0, 1);
  const twitch = age >= 1.05 && age <= 1.25
    ? Math.sin((age - 1.05) / 0.2 * Math.PI) * 0.16
    : 0;
  const type = propertyOf(corpse, 'type', 'stinger');
  const elite = propertyOf(corpse, 'elite', false) === true;
  const species = speciesForEnemy(type, elite);
  const shape = speciesProfile(species);

  return {
    id: propertyOf(corpse, 'id'),
    enemyId: propertyOf(corpse, 'enemyId'),
    x: finiteNumber(propertyOf(projection, 'x')),
    centerY: finiteNumber(propertyOf(projection, 'y')),
    height: clamp(
      74 * finiteNumber(propertyOf(projection, 'scale', 1), 1) * finiteNumber(propertyOf(corpse, 'size', 1), 1)
        * shape.bodyScale,
      30,
      176
    ),
    widthScale: shape.widthScale,
    depth: finiteNumber(propertyOf(corpse, 'distance', 1), 1),
    rotation: finiteNumber(propertyOf(corpse, 'roll')) + twitch,
    curl: fallProgress,
    opacity: fade,
    state: fallProgress < 1 ? 'falling' : 'resting',
    elite,
    species,
    modelKind: shape.modelKind,
    silhouette: shape.silhouette,
    wingStyle: shape.wingStyle,
    weakPointStyle: shape.weakPointStyle,
    deathStyle: shape.deathStyle,
    appearance: insectAppearance(propertyOf(corpse, 'enemyId'), type, elite),
    visible: Boolean(propertyOf(projection, 'visible', false))
  };
}
