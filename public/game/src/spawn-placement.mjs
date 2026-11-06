import { shortestAngleDelta } from './ar-geometry.mjs';

const NORMAL_LANES = Object.freeze([-46, 46, -58, 58, -72, 72]);
const ELITE_LANES = Object.freeze([-68, 68, -78, 78]);
const TOUCH_YAW_LIMIT = 76;
const MIN_VIEW_SEPARATION = 38;

function finiteNumber(value, fallback = 0) {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'string' && value.trim() === '') return fallback;
  try {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  } catch {
    return fallback;
  }
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function unitRoll(value) {
  return clamp(finiteNumber(value, 0.5), 0, 1);
}

function bearingFor(enemy) {
  const baseYaw = finiteNumber(enemy?.baseYaw, null);
  if (baseYaw !== null) return baseYaw;
  return finiteNumber(enemy?.yaw, null);
}

export function planEnemySpawn(options = {}) {
  const input = options && typeof options === 'object' ? options : {};
  const {
    view: suppliedView = {},
    enemies = [],
    elite = false,
    laneRoll,
    pitchRoll,
    distanceRoll
  } = input;
  const view = suppliedView && typeof suppliedView === 'object' ? suppliedView : {};
  const viewYaw = finiteNumber(view.yaw);
  const touchMode = view.sensorFresh !== true;
  const lanes = elite ? ELITE_LANES : NORMAL_LANES;
  const laneValue = unitRoll(laneRoll);
  const entryYawMagnitude = elite ? 18 : 12 + laneValue * 4;
  const start = Math.min(lanes.length - 1, Math.floor(laneValue * lanes.length));
  const existingBearings = (Array.isArray(enemies) ? enemies : [])
    .map(bearingFor)
    .filter((bearing) => bearing !== null);
  const candidates = lanes.map((_, index) => lanes[(start + index) % lanes.length])
    .map((offset, order) => {
      const unbounded = viewYaw + offset;
      const baseYaw = touchMode
        ? clamp(unbounded, -TOUCH_YAW_LIMIT, TOUCH_YAW_LIMIT)
        : shortestAngleDelta(unbounded, 0);
      const relative = shortestAngleDelta(baseYaw, viewYaw);
      if (Math.abs(relative) < MIN_VIEW_SEPARATION) return null;
      const direction = relative < 0 ? -1 : 1;
      const entryRoom = direction < 0
        ? baseYaw + TOUCH_YAW_LIMIT
        : TOUCH_YAW_LIMIT - baseYaw;
      const separation = existingBearings.length === 0
        ? 180
        : Math.min(...existingBearings.map((bearing) =>
          Math.abs(shortestAngleDelta(baseYaw, bearing))));
      return { baseYaw, order, relative, separation, entryRoom };
    })
    .filter(Boolean)
    .sort((left, right) => (
      right.separation - left.separation
      || Math.abs(left.relative) - Math.abs(right.relative)
      || left.order - right.order
    ));
  const reachableCandidates = touchMode
    ? candidates.filter((candidate) => candidate.entryRoom >= entryYawMagnitude)
    : candidates;
  const fallbackYaw = touchMode
    ? viewYaw >= 0 ? -TOUCH_YAW_LIMIT : TOUCH_YAW_LIMIT
    : shortestAngleDelta(viewYaw + (laneValue < 0.5 ? -58 : 58), 0);
  const baseYaw = reachableCandidates[0]?.baseYaw ?? candidates[0]?.baseYaw ?? fallbackYaw;
  const relative = shortestAngleDelta(baseYaw, viewYaw);
  const spawnSide = relative < 0 ? 'left' : 'right';
  const direction = spawnSide === 'left' ? -1 : 1;
  const entryRoom = direction < 0
    ? baseYaw + TOUCH_YAW_LIMIT
    : TOUCH_YAW_LIMIT - baseYaw;
  const entryYawOffset = direction * (touchMode
    ? Math.min(entryYawMagnitude, entryRoom)
    : entryYawMagnitude);
  const basePitch = -12 + unitRoll(pitchRoll) * 30;

  return {
    baseYaw,
    yaw: shortestAngleDelta(baseYaw + entryYawOffset, 0),
    basePitch,
    pitch: basePitch,
    distance: 1.03 + unitRoll(distanceRoll) * 0.12,
    entryYawOffset,
    spawnSide,
    spawnKind: 'air-edge'
  };
}
