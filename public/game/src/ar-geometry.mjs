export const DEFAULT_VIEWPORT = Object.freeze({
  horizontalFov: 60,
  verticalFov: 48
});

export const ENEMY_VISUAL_SCALE_BOOST = 1.12;

const TAU = Math.PI * 2;

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function shortestAngleDelta(next, previous) {
  const difference = finiteNumber(next) - finiteNumber(previous);
  return ((difference + 540) % 360) - 180;
}

export function clampPitch(value) {
  return clamp(finiteNumber(value), -55, 70);
}

export function cameraViewportFromCover(source = {}, viewport = {}, longEdgeFov = 67) {
  const sourceWidth = Number(source.width);
  const sourceHeight = Number(source.height);
  const viewportWidth = Number(viewport.width);
  const viewportHeight = Number(viewport.height);
  const fieldOfView = Number(longEdgeFov);
  const dimensions = [sourceWidth, sourceHeight, viewportWidth, viewportHeight];
  if (!dimensions.every((value) => Number.isFinite(value) && value > 0)
    || !Number.isFinite(fieldOfView)
    || fieldOfView <= 0
    || fieldOfView >= 180) {
    return { ...DEFAULT_VIEWPORT };
  }

  const degreesToRadians = Math.PI / 180;
  const radiansToDegrees = 180 / Math.PI;
  const focalLength = Math.max(sourceWidth, sourceHeight)
    / (2 * Math.tan(fieldOfView * degreesToRadians / 2));
  const coverScale = Math.max(viewportWidth / sourceWidth, viewportHeight / sourceHeight);
  const visibleWidth = viewportWidth / coverScale;
  const visibleHeight = viewportHeight / coverScale;
  const fieldOfViewFor = (dimension) => clamp(
    2 * Math.atan(dimension / (2 * focalLength)) * radiansToDegrees,
    12,
    100
  );

  return {
    horizontalFov: fieldOfViewFor(visibleWidth),
    verticalFov: fieldOfViewFor(visibleHeight)
  };
}

export function cameraPoseFromDeviceOrientation(alpha, beta, gamma, fallbackYaw = 0) {
  if (![alpha, beta, gamma].every((value) => typeof value === 'number' && Number.isFinite(value))) {
    return null;
  }

  const degreesToRadians = Math.PI / 180;
  const alphaRadians = alpha * degreesToRadians;
  const betaRadians = beta * degreesToRadians;
  const gammaRadians = gamma * degreesToRadians;
  const cosAlpha = Math.cos(alphaRadians);
  const sinAlpha = Math.sin(alphaRadians);
  const cosBeta = Math.cos(betaRadians);
  const sinBeta = Math.sin(betaRadians);
  const cosGamma = Math.cos(gammaRadians);
  const sinGamma = Math.sin(gammaRadians);

  // W3C Z-X'-Y'' device rotation applied to the rear-camera vector [0, 0, -1].
  const forwardX = -cosAlpha * sinGamma - sinAlpha * sinBeta * cosGamma;
  const forwardY = -sinAlpha * sinGamma + cosAlpha * sinBeta * cosGamma;
  const forwardZ = -cosBeta * cosGamma;
  const horizontal = Math.hypot(forwardX, forwardY);
  const stableYaw = typeof fallbackYaw === 'number' && Number.isFinite(fallbackYaw) ? fallbackYaw : 0;
  const yaw = horizontal > 1e-6
    ? Math.atan2(forwardX, forwardY) / degreesToRadians
    : stableYaw;
  const pitch = Math.atan2(forwardZ, horizontal) / degreesToRadians;

  return {
    yaw: shortestAngleDelta(yaw, 0),
    pitch,
    forward: {
      x: forwardX,
      y: forwardY,
      z: forwardZ
    }
  };
}

export function projectWorldPoint(target = {}, view = {}, viewport = {}) {
  const width = Math.max(1, finiteNumber(viewport.width, 390));
  const height = Math.max(1, finiteNumber(viewport.height, 844));
  const horizontalFov = clamp(finiteNumber(viewport.horizontalFov, DEFAULT_VIEWPORT.horizontalFov), 12, 100);
  const verticalFov = clamp(finiteNumber(viewport.verticalFov, DEFAULT_VIEWPORT.verticalFov), 12, 100);
  const relativeYaw = shortestAngleDelta(target.yaw, view.yaw);
  const relativePitch = finiteNumber(target.pitch) - finiteNumber(view.pitch);
  const x = width * (0.5 + relativeYaw / horizontalFov);
  const y = height * (0.5 - relativePitch / verticalFov);
  const visible = Math.abs(relativeYaw) <= horizontalFov * 0.57
    && Math.abs(relativePitch) <= verticalFov * 0.57;
  const distance = clamp(finiteNumber(target.distance, 1), 0, 1.2);
  const baseScale = clamp(0.5 + (1 - distance) * 1.15, 0.42, 1.65);
  const scale = clamp(baseScale * ENEMY_VISUAL_SCALE_BOOST, 0.42, 1.65);

  return {
    x,
    y,
    visible,
    relativeYaw,
    relativePitch,
    scale
  };
}

export function getThreatIndicator(projection, viewport = {}) {
  if (!projection || projection.visible) return null;

  const width = Math.max(1, finiteNumber(viewport.width, 390));
  const height = Math.max(1, finiteNumber(viewport.height, 844));
  const margin = Math.min(24, width * 0.08, height * 0.08);
  const centerX = width / 2;
  const centerY = height / 2;
  const deltaX = finiteNumber(projection.x, centerX) - centerX;
  const deltaY = finiteNumber(projection.y, centerY) - centerY;
  const horizontalPressure = Math.abs(deltaX) / Math.max(1, centerX - margin);
  const verticalPressure = Math.abs(deltaY) / Math.max(1, centerY - margin);
  let x;
  let y;
  let edge;

  if (horizontalPressure >= verticalPressure) {
    edge = deltaX < 0 ? 'left' : 'right';
    x = edge === 'left' ? margin : width - margin;
    const multiplier = Math.abs(deltaX) > 0 ? (centerX - margin) / Math.abs(deltaX) : 0;
    y = clamp(centerY + deltaY * multiplier, height * 0.2, height * 0.8);
  } else {
    edge = deltaY < 0 ? 'top' : 'bottom';
    y = edge === 'top' ? margin : height - margin;
    const multiplier = Math.abs(deltaY) > 0 ? (centerY - margin) / Math.abs(deltaY) : 0;
    x = clamp(centerX + deltaX * multiplier, width * 0.14, width * 0.86);
  }

  let angle = Math.atan2(deltaY, deltaX);
  if (angle >= Math.PI) angle -= TAU;

  return {
    x,
    y,
    edge,
    angle,
    distance: clamp(finiteNumber(projection.distance, 1), 0, 1)
  };
}
