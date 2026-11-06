import { getThreatIndicator, projectWorldPoint } from './ar-geometry.mjs';
import { createCombatEffects } from './combat-effects.mjs';
import { createCorpseVisual, createLiveInsectVisual } from './insect-visuals.mjs';
import { SPECIES_PROFILES, speciesForEnemy, speciesProfile } from './species-profile.mjs';

const TAU = Math.PI * 2;
const MAX_PARTICLES = 110;
const MAX_PIXEL_RATIO = 2;
const MAX_CAMERA_PIXEL_RATIO = 1.5;
const AMBIENT_REFRESH_MS = 100;
const PSEUDO_SURFACE_DEPTH = 0.72;
const INSECT_PALETTES = Object.freeze(Object.fromEntries(
  Object.entries(SPECIES_PROFILES).map(([species, profile]) => [species, profile.canvasPalette])
));
const DEFAULT_SILHOUETTE = Object.freeze({
  bodyWidth: 1,
  bodyHeight: 1,
  headScale: 1,
  abdomenScale: 1,
  wingSpan: 1,
  wingDepth: 1,
  weakPointScale: 1
});

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function propertyOf(source, key, fallback) {
  try {
    return source == null ? fallback : source[key];
  } catch {
    return fallback;
  }
}

function renderProfile(enemy) {
  const species = speciesForEnemy(propertyOf(enemy, 'type', 'stinger'), propertyOf(enemy, 'elite', false) === true);
  return speciesProfile(species);
}

function enemyIsLocked(enemy, projection) {
  const size = Math.max(0.3, projection.scale * finiteNumber(enemy.size, 1));
  const yawLocked = Math.abs(projection.relativeYaw) <= 4.6 / size;
  const bodyLocked = Math.abs(projection.relativePitch) <= 6.8 / size;
  const headPitch = finiteNumber(enemy.pitch) + 3.2 / size;
  const headRelativePitch = headPitch - (finiteNumber(enemy.pitch) - projection.relativePitch);
  const headLocked = Math.abs(headRelativePitch) <= 2.1 / size;
  return yawLocked && (bodyLocked || headLocked);
}

function drawCameraGrade(ctx, width, height, time, reducedMotion) {
  const vertical = ctx.createLinearGradient(0, 0, 0, height);
  vertical.addColorStop(0, 'rgba(2, 12, 11, .42)');
  vertical.addColorStop(0.28, 'rgba(4, 18, 16, .08)');
  vertical.addColorStop(0.72, 'rgba(4, 16, 15, .12)');
  vertical.addColorStop(1, 'rgba(1, 8, 8, .52)');
  ctx.fillStyle = vertical;
  ctx.fillRect(0, 0, width, height);

  const glowX = width * (0.52 + (reducedMotion ? 0 : Math.sin(time * 0.00018) * 0.06));
  const glow = ctx.createRadialGradient(glowX, height * 0.42, 0, glowX, height * 0.42, width * 0.78);
  glow.addColorStop(0, 'rgba(132, 255, 87, .035)');
  glow.addColorStop(0.66, 'rgba(8, 30, 25, .025)');
  glow.addColorStop(1, 'rgba(0, 7, 7, .3)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);
}

function drawWorldGrid(ctx, width, height, view, time, reducedMotion) {
  const horizon = height * 0.61 + clamp(finiteNumber(view.pitch), -25, 25) * height * 0.006;
  const yawOffset = (finiteNumber(view.yaw) % 12) / 12;
  ctx.save();
  ctx.strokeStyle = 'rgba(184, 255, 61, .075)';
  ctx.lineWidth = 1;

  for (let index = 0; index < 7; index += 1) {
    const progress = index / 6;
    const eased = progress * progress;
    const y = horizon + eased * (height - horizon);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }

  const drift = reducedMotion ? 0 : ((time * 0.000015) % 1) * width * 0.08;
  for (let index = -5; index <= 5; index += 1) {
    const bottomX = width * 0.5 + (index + yawOffset) * width * 0.22 + drift;
    ctx.beginPath();
    ctx.moveTo(width * 0.5, horizon);
    ctx.lineTo(bottomX, height);
    ctx.stroke();
  }
  ctx.restore();
}

function drawInsect(ctx, enemy, projection, now, reducedMotion) {
  const profile = renderProfile(enemy);
  const palette = INSECT_PALETTES[profile.modelKind] || INSECT_PALETTES.stinger;
  const silhouette = profile.silhouette || DEFAULT_SILHOUETTE;
  const shapeScale = profile.bodyScale;
  const widthScale = profile.widthScale;
  const isElite = propertyOf(enemy, 'elite', false) === true;
  const size = clamp(62 * finiteNumber(projection?.scale, 1) * finiteNumber(propertyOf(enemy, 'size', 1), 1) * shapeScale, 30, 156);
  const corpseAge = Math.max(0, finiteNumber(propertyOf(enemy, 'age')));
  const lifetime = Math.max(0.1, finiteNumber(propertyOf(enemy, 'lifetime', 8), 8));
  const opacity = 'lifetime' in enemy ? clamp((lifetime - corpseAge) / 1.25, 0, 1) : 1;
  const bank = clamp(finiteNumber(propertyOf(enemy, 'bank')), -0.65, 0.65) + finiteNumber(propertyOf(enemy, 'roll'));
  const wingBeat = reducedMotion || 'lifetime' in enemy
    ? 0
    : Math.sin(now * 0.025 + finiteNumber(propertyOf(enemy, 'phase'))) * size * 0.045;
  const flash = clamp(finiteNumber(propertyOf(enemy, 'hitFlash')) / 0.16, 0, 1);

  ctx.save();
  ctx.translate(projection.x, projection.y);
  ctx.rotate(bank);
  ctx.globalAlpha = opacity;
  ctx.shadowColor = flash > 0 ? '#f4ffca' : palette.edge;
  ctx.shadowBlur = flash > 0 ? 22 * flash : isElite ? 13 : 3;

  ctx.fillStyle = palette.wing;
  const wingSpread = (profile.wingStyle === 'shell' ? 0.16 : profile.wingStyle === 'queen' ? 0.34 : 0.24)
    * silhouette.wingSpan;
  const wingLength = (profile.wingStyle === 'shell' ? 0.28 : profile.wingStyle === 'queen' ? 0.52 : 0.42)
    * silhouette.wingSpan;
  const wingDepth = (profile.wingStyle === 'queen' ? 0.19 : 0.15) * silhouette.wingDepth;
  for (const side of [-1, 1]) {
    ctx.save();
    ctx.translate(side * size * wingSpread, -size * 0.08);
    ctx.rotate(side * (0.38 + wingBeat / size));
    ctx.beginPath();
    ctx.ellipse(side * size * (wingLength * 0.43), 0, size * wingLength, size * wingDepth, 0, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  ctx.shadowBlur = 0;
  ctx.strokeStyle = palette.edge;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(1.2, size * 0.035);
  for (const side of [-1, 1]) {
    for (const offset of [-0.24, 0, 0.24]) {
      ctx.beginPath();
      ctx.moveTo(side * size * 0.13, offset * size);
      ctx.lineTo(side * size * 0.48, (offset - 0.08) * size);
      ctx.lineTo(side * size * 0.7, (offset + 0.15) * size);
      ctx.stroke();
    }
  }

  const bodyWidth = widthScale * silhouette.bodyWidth;
  const bodyHeight = silhouette.bodyHeight;
  const abdomenWidth = bodyWidth * silhouette.abdomenScale;
  ctx.fillStyle = flash > 0 ? '#f5ffd8' : palette.edge;
  ctx.beginPath();
  ctx.ellipse(0, size * 0.31, size * 0.23 * abdomenWidth, size * 0.27 * bodyHeight, 0, 0, TAU);
  ctx.fill();

  ctx.fillStyle = flash > 0 ? '#f5ffd8' : palette.body;
  ctx.beginPath();
  ctx.ellipse(0, size * 0.08, size * 0.22 * bodyWidth, size * 0.34 * bodyHeight, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = isElite ? '#4f551d' : palette.edge;
  ctx.beginPath();
  ctx.ellipse(
    0,
    -size * 0.27,
    size * 0.24 * bodyWidth * silhouette.headScale,
    size * 0.2 * bodyHeight * silhouette.headScale,
    0,
    0,
    TAU
  );
  ctx.fill();

  ctx.fillStyle = palette.eye;
  ctx.shadowColor = palette.eye;
  ctx.shadowBlur = 8;
  ctx.beginPath();
  ctx.arc(-size * 0.09 * silhouette.headScale, -size * 0.31, size * 0.045 * silhouette.headScale, 0, TAU);
  ctx.arc(size * 0.09 * silhouette.headScale, -size * 0.31, size * 0.045 * silhouette.headScale, 0, TAU);
  ctx.fill();

  ctx.strokeStyle = palette.eye;
  ctx.lineWidth = Math.max(1, size * 0.018);
  ctx.globalAlpha = opacity * (flash > 0 ? 1 : 0.72);
  ctx.beginPath();
  if (profile.weakPointStyle === 'side-plate') {
    ctx.arc(size * 0.2 * bodyWidth, size * 0.1, size * 0.085 * silhouette.weakPointScale, 0, TAU);
  } else if (profile.weakPointStyle === 'thorax-core') {
    ctx.arc(0, size * 0.01, size * 0.1 * silhouette.weakPointScale, 0, TAU);
  } else {
    ctx.arc(0, size * 0.31, size * 0.07 * silhouette.weakPointScale, 0, TAU);
  }
  ctx.stroke();
  ctx.globalAlpha = opacity;

  ctx.shadowBlur = 0;
  ctx.strokeStyle = palette.edge;
  ctx.lineWidth = Math.max(1, size * 0.026);
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(side * size * 0.07 * bodyWidth, -size * 0.4 * bodyHeight);
    ctx.lineTo(side * size * 0.19 * bodyWidth * silhouette.headScale, -size * 0.52 * bodyHeight);
    ctx.stroke();
  }
  ctx.restore();
}

function drawThreat(ctx, indicator, enemy, time) {
  const profile = renderProfile(enemy);
  const palette = INSECT_PALETTES[profile.modelKind] || INSECT_PALETTES.stinger;
  const urgency = clamp(1 - finiteNumber(propertyOf(enemy, 'distance', 1), 1), 0, 1);
  const pulse = 0.78 + Math.sin(time * 0.009 + finiteNumber(propertyOf(enemy, 'id'))) * 0.18;
  ctx.save();
  ctx.translate(indicator.x, indicator.y);
  ctx.rotate(indicator.angle);
  ctx.globalAlpha = pulse;
  ctx.fillStyle = urgency > 0.55 ? '#ff4d5f' : palette.eye;
  ctx.shadowColor = ctx.fillStyle;
  ctx.shadowBlur = 12;
  ctx.beginPath();
  ctx.moveTo(13, 0);
  ctx.lineTo(-7, -9);
  ctx.lineTo(-3, 0);
  ctx.lineTo(-7, 9);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.fillStyle = 'rgba(236, 255, 223, .82)';
  ctx.font = '700 9px ui-monospace, monospace';
  ctx.textAlign = indicator.edge === 'left' ? 'left' : indicator.edge === 'right' ? 'right' : 'center';
  const labelX = indicator.edge === 'left' ? indicator.x + 17 : indicator.edge === 'right' ? indicator.x - 17 : indicator.x;
  ctx.fillText(`${Math.max(2, Math.round(finiteNumber(propertyOf(enemy, 'distance', 1), 1) * 18 + 2))}m`, labelX, indicator.y + 3);
  ctx.restore();
}

function drawReticle(ctx, width, height, locked, recoil, time, reducedMotion) {
  const x = width / 2;
  const y = height / 2 - clamp(finiteNumber(recoil), 0, 1) * (reducedMotion ? 0 : 8);
  const color = locked ? '#b8ff3d' : 'rgba(232, 255, 221, .88)';
  const radius = locked ? 20 : 25 + (reducedMotion ? 0 : Math.sin(time * 0.004) * 1.5);
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = locked ? 2 : 1.35;
  ctx.shadowColor = color;
  ctx.shadowBlur = locked ? 14 : 4;
  ctx.setLineDash(locked ? [] : [4, 5]);
  ctx.beginPath();
  ctx.arc(0, 0, radius * 0.46, 0, TAU);
  ctx.stroke();
  ctx.setLineDash([]);

  for (let index = 0; index < 4; index += 1) {
    ctx.save();
    ctx.rotate(index * Math.PI / 2);
    ctx.beginPath();
    ctx.moveTo(radius, -7);
    ctx.lineTo(radius, 7);
    ctx.lineTo(radius - 6, 7);
    ctx.stroke();
    ctx.restore();
  }
  ctx.beginPath();
  ctx.arc(0, 0, locked ? 2.4 : 1.7, 0, TAU);
  ctx.fill();
  ctx.restore();
}

function drawParticles(ctx, particles, delta) {
  for (let index = particles.length - 1; index >= 0; index -= 1) {
    const particle = particles[index];
    particle.life -= delta;
    if (particle.life <= 0) {
      particles.splice(index, 1);
      continue;
    }
    particle.vy += particle.gravity * delta;
    particle.x += particle.vx * delta;
    particle.y += particle.vy * delta;
    const alpha = clamp(particle.life / particle.maxLife, 0, 1);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = particle.color;
    ctx.shadowColor = particle.color;
    ctx.shadowBlur = 7;
    ctx.translate(particle.x, particle.y);
    ctx.rotate(particle.angle + particle.spin * (particle.maxLife - particle.life));
    ctx.fillRect(-particle.size * 0.5, -particle.size * 0.16, particle.size, particle.size * 0.32);
    ctx.restore();
  }
}

function drawScanOverlay(ctx, width, height, time, reducedMotion) {
  ctx.save();
  ctx.fillStyle = 'rgba(176, 255, 117, .025)';
  for (let y = 0; y < height; y += 7) ctx.fillRect(0, y, width, 1);
  const scanY = reducedMotion ? height * 0.34 : (time * 0.055) % (height + 120) - 60;
  const scan = ctx.createLinearGradient(0, scanY - 35, 0, scanY + 35);
  scan.addColorStop(0, 'rgba(184, 255, 61, 0)');
  scan.addColorStop(0.5, 'rgba(184, 255, 61, .08)');
  scan.addColorStop(1, 'rgba(184, 255, 61, 0)');
  ctx.fillStyle = scan;
  ctx.fillRect(0, scanY - 35, width, 70);
  ctx.restore();
}

function drawDamageVignette(ctx, width, height, shield, pulse) {
  const damage = clamp((100 - finiteNumber(shield, 100)) / 100 + pulse, 0, 0.8);
  if (damage <= 0.01) return;
  const gradient = ctx.createRadialGradient(width / 2, height / 2, Math.min(width, height) * 0.24, width / 2, height / 2, Math.max(width, height) * 0.72);
  gradient.addColorStop(0, 'rgba(255, 41, 67, 0)');
  gradient.addColorStop(0.7, `rgba(255, 41, 67, ${damage * 0.2})`);
  gradient.addColorStop(1, `rgba(112, 0, 20, ${damage * 0.62})`);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
}

function diagnosticPrimitive(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function diagnosticItem(item, fields) {
  const copy = {};
  for (const field of fields) {
    if (field === 'visible') copy.visible = item?.visible === true;
    else if (field === 'id' || field === 'enemyId') copy[field] = diagnosticPrimitive(item?.[field]);
    else copy[field] = finiteNumber(item?.[field]);
  }
  return copy;
}

function copyDiagnosticFrame(frame) {
  if (!frame) return null;
  return {
    insects: frame.insects.map((item) => ({ ...item })),
    corpses: frame.corpses.map((item) => ({ ...item })),
    effects: {
      casings: frame.effects.casings.map((item) => ({ ...item })),
      impacts: frame.effects.impacts.map((item) => ({ ...item })),
      fragments: frame.effects.fragments.map((item) => ({ ...item })),
      fluids: frame.effects.fluids.map((item) => ({ ...item }))
    }
  };
}

function createDiagnosticFrame(frame) {
  return {
    insects: frame.insects.map((item) => diagnosticItem(item, ['id', 'x', 'centerY', 'visible'])),
    corpses: frame.corpses.map((item) => diagnosticItem(item, ['id', 'enemyId', 'x', 'centerY', 'visible'])),
    effects: {
      casings: frame.effects.casings.map((item) => diagnosticItem(item, ['id', 'x', 'y', 'visible'])),
      impacts: frame.effects.impacts.map((item) => diagnosticItem(item, ['id', 'x', 'y', 'visible'])),
      fragments: frame.effects.fragments.map((item) => diagnosticItem(item, ['id', 'x', 'y', 'visible'])),
      fluids: frame.effects.fluids.map((item) => diagnosticItem(item, ['id', 'x', 'y', 'visible']))
    }
  };
}

export function createRenderer(canvas, {
  combatEffectsFactory = createCombatEffects,
  exposeDiagnostics = false,
  globalObject = globalThis,
  worldCanvas,
  worldLayerFactory
} = {}) {
  const ctx = canvas?.getContext?.('2d');
  if (!ctx) throw new Error('Canvas 2D context is unavailable');

  const reducedMotion = Boolean(globalObject?.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches);
  let width = 390;
  let height = 844;
  let pixelRatio = 1;
  let cameraBudgetActive = false;
  let lastTimestamp = 0;
  let damagePulse = 0;
  let destroyed = false;
  let enemyLayer = null;
  let retiredLayerDiagnostics = null;
  let enemyLayerFailure = null;
  let enemyRenderMode = worldCanvas ? 'loading' : 'disabled';
  let effectTimestamp = null;
  let diagnosticFrame = null;
  let qaSeedGeneration = 0;
  let gradeCanvas = null;
  let gradeContext = null;
  let gradeSize = '';
  let gradeTimestamp = -Infinity;
  let gradeUnavailable = false;
  const effects = combatEffectsFactory();
  const AbortControllerClass = globalObject?.AbortController || globalThis.AbortController;
  const worldLayerController = typeof AbortControllerClass === 'function'
    ? new AbortControllerClass()
    : null;
  const particles = [];

  function releaseGradeCache() {
    if (gradeCanvas) {
      try { gradeCanvas.width = 0; gradeCanvas.height = 0; } catch {}
    }
    gradeCanvas = null;
    gradeContext = null;
    gradeSize = '';
    gradeTimestamp = -Infinity;
  }

  function drawAmbientGrade(now) {
    if (!gradeContext && !gradeUnavailable) {
      try {
        gradeCanvas = canvas.ownerDocument?.createElement?.('canvas') || null;
        gradeContext = gradeCanvas?.getContext?.('2d') || null;
      } catch {}
      if (!gradeContext) { releaseGradeCache(); gradeUnavailable = true; }
    }
    if (gradeContext) {
      try {
        const size = `${width}:${height}:${pixelRatio}`;
        if (size !== gradeSize) {
          gradeCanvas.width = Math.max(1, Math.round(width * pixelRatio));
          gradeCanvas.height = Math.max(1, Math.round(height * pixelRatio));
          gradeSize = size;
          gradeTimestamp = -Infinity;
        }
        if (!Number.isFinite(gradeTimestamp)
          || (!reducedMotion && (now < gradeTimestamp || now - gradeTimestamp >= AMBIENT_REFRESH_MS))) {
          gradeContext.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
          gradeContext.clearRect(0, 0, width, height);
          drawCameraGrade(gradeContext, width, height, now, reducedMotion);
          gradeTimestamp = now;
        }
        ctx.drawImage(gradeCanvas, 0, 0, width, height);
        return;
      } catch {
        releaseGradeCache();
        gradeUnavailable = true;
      }
    }
    drawCameraGrade(ctx, width, height, now, reducedMotion);
  }

  function disposeEnemyLayer(layer) {
    try {
      layer?.destroy?.();
    } catch {
      // A failed WebGL layer must not take down the procedural renderer.
    }
    try {
      retiredLayerDiagnostics = layer?.getDiagnostics?.() || retiredLayerDiagnostics;
    } catch {
      // Teardown evidence is diagnostic-only and must stay non-fatal.
    }
  }

  function fallbackFromEnemyLayer(layer = enemyLayer, error = null) {
    if (layer === enemyLayer) enemyLayer = null;
    disposeEnemyLayer(layer);
    if (!destroyed) {
      enemyLayerFailure = error instanceof Error ? error.message : error ? String(error) : enemyLayerFailure;
      enemyRenderMode = 'fallback';
    }
  }

  function resolveCameraBudget(view = {}) {
    cameraBudgetActive = view?.cameraActive === true;
    return cameraBudgetActive;
  }

  function resize(view = {}) {
    width = Math.max(1, finiteNumber(canvas.clientWidth, 390));
    height = Math.max(1, finiteNumber(canvas.clientHeight, 844));
    const maxPixelRatio = resolveCameraBudget(view) ? MAX_CAMERA_PIXEL_RATIO : MAX_PIXEL_RATIO;
    pixelRatio = clamp(finiteNumber(globalObject?.devicePixelRatio, 1), 1, maxPixelRatio);
    canvas.width = Math.max(1, Math.round(width * pixelRatio));
    canvas.height = Math.max(1, Math.round(height * pixelRatio));
    ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    if (enemyLayer) {
      try {
        enemyLayer.resize(width, height, pixelRatio);
      } catch (error) {
        fallbackFromEnemyLayer(enemyLayer, error);
      }
    }
  }

  function resizeIfNeeded(view = {}) {
    const nextWidth = Math.max(1, finiteNumber(canvas.clientWidth, 390));
    const nextHeight = Math.max(1, finiteNumber(canvas.clientHeight, 844));
    const maxPixelRatio = resolveCameraBudget(view) ? MAX_CAMERA_PIXEL_RATIO : MAX_PIXEL_RATIO;
    const nextRatio = clamp(finiteNumber(globalObject?.devicePixelRatio, 1), 1, maxPixelRatio);
    if (nextWidth !== width || nextHeight !== height || nextRatio !== pixelRatio) {
      resize({ cameraActive: cameraBudgetActive });
    }
  }

  const handleResize = () => resizeIfNeeded({ cameraActive: cameraBudgetActive });

  function burst(kind, point = {}) {
    const specs = {
      muzzle: { count: 6, color: '#ffd27a', speed: 95, life: 0.18, gravity: 30 },
      rail: { count: 12, color: '#88e8ff', speed: 210, life: 0.28, gravity: 8 },
      freeze: { count: 12, color: '#9deeff', speed: 76, life: 0.7, gravity: -18 },
      hit: { count: 10, color: '#b8ff3d', speed: 105, life: 0.34, gravity: 110 },
      'critical-hit': { count: 18, color: '#dfff73', speed: 155, life: 0.48, gravity: 145 },
      'player-hit': { count: 14, color: '#ff4d5f', speed: 135, life: 0.4, gravity: 40 }
    };
    const spec = specs[kind];
    if (!spec) return;
    if (kind === 'player-hit') damagePulse = 0.52;
    const count = reducedMotion ? Math.min(4, spec.count) : spec.count;
    const originX = finiteNumber(point.x, width / 2);
    const originY = finiteNumber(point.y, height / 2);
    for (let index = 0; index < count; index += 1) {
      const angle = Math.random() * TAU;
      const velocity = spec.speed * (0.45 + Math.random() * 0.75);
      particles.push({
        x: originX,
        y: originY,
        vx: Math.cos(angle) * velocity,
        vy: Math.sin(angle) * velocity,
        gravity: spec.gravity,
        life: spec.life * (0.7 + Math.random() * 0.5),
        maxLife: spec.life * 1.2,
        size: 2 + Math.random() * (kind === 'critical-hit' ? 8 : 5),
        color: spec.color,
        angle,
        spin: (Math.random() - 0.5) * 9
      });
    }
    if (particles.length > MAX_PARTICLES) particles.splice(0, particles.length - MAX_PARTICLES);
  }

  function present(event) {
    if (destroyed) return;
    effects.present(event);
  }

  function resetMission() {
    if (destroyed) return;
    effects.clear();
    particles.length = 0;
    lastTimestamp = 0;
    effectTimestamp = null;
    damagePulse = 0;
    diagnosticFrame = null;
    try { enemyLayer?.resetMission?.(); } catch {}
  }

  function seedMaximumEffectsForQa() {
    qaSeedGeneration += 1;
    const eventBase = 9_000_000_000 + qaSeedGeneration * 100;
    for (let index = 0; index < 20; index += 1) {
      effects.present({
        id: eventBase + index,
        type: 'shoot',
        yaw: 0,
        pitch: 0,
        effectSeed: index + 1
      });
    }
    for (let index = 0; index < 8; index += 1) {
      effects.present({
        id: eventBase + 20 + index,
        type: 'miss',
        yaw: index * 3 - 10.5,
        pitch: index % 2 === 0 ? -3 : 3,
        effectSeed: index + 101
      });
    }
    return true;
  }

  function render(state = {}, view = {}, timestamp = 0) {
    resizeIfNeeded(view);
    const now = finiteNumber(timestamp);
    const delta = lastTimestamp > 0 ? clamp((now - lastTimestamp) / 1000, 0, 0.05) : 0.016;
    const effectDelta = effectTimestamp === null
      ? 0
      : Math.max(0, (now - effectTimestamp) / 1000);
    lastTimestamp = now;
    effectTimestamp = now;
    effects.update(effectDelta);
    damagePulse = Math.max(0, damagePulse - delta * 2.8);

    ctx.save();
    ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    ctx.clearRect(0, 0, width, height);
    drawAmbientGrade(now);
    drawWorldGrid(ctx, width, height, view, now, reducedMotion);

    const visible = [];
    const threats = [];
    const locked = [];
    const projectionViewport = {
      width,
      height,
      horizontalFov: view.horizontalFov,
      verticalFov: view.verticalFov
    };
    const enemies = [...(state.enemies || [])];
    const projectedEnemies = enemies.map((enemy) => ({
      enemy,
      projection: projectWorldPoint(enemy, view, projectionViewport)
    }));
    const corpses = [...(state.corpses || [])];
    const projectedCorpses = corpses.map((corpse) => ({
      corpse,
      projection: projectWorldPoint(corpse, view, projectionViewport)
    }));
    const effectSnapshot = effects.snapshot();
    const projectParticle = (particle) => {
      const anchor = projectWorldPoint(
        // Direction-only pseudo surface: no camera pixels or surface classification are used.
        { yaw: particle.yaw, pitch: particle.pitch, distance: PSEUDO_SURFACE_DEPTH },
        view,
        projectionViewport
      );
      return {
        ...particle,
        x: (anchor.x + (particle.x - 0.5) * width) / width,
        y: (anchor.y + (particle.y - 0.5) * height) / height,
        visible: anchor.visible
      };
    };
    const worldFrame = {
      insects: projectedEnemies.map(({ enemy, projection }) => createLiveInsectVisual(enemy, projection)),
      corpses: projectedCorpses.map(({ corpse, projection }) => createCorpseVisual(corpse, projection)),
      effects: {
        ...effectSnapshot,
        impacts: effectSnapshot.impacts.map((impact) => ({
          ...impact,
          ...projectWorldPoint(
            { yaw: impact.yaw, pitch: impact.pitch, distance: PSEUDO_SURFACE_DEPTH },
            view,
            projectionViewport
          )
        })),
        fragments: effectSnapshot.fragments.map(projectParticle),
        fluids: effectSnapshot.fluids.map(projectParticle)
      }
    };
    if (exposeDiagnostics === true) diagnosticFrame = createDiagnosticFrame(worldFrame);
    let confirmedThreeFrame = false;
    if (enemyLayer && enemyRenderMode !== 'fallback') {
      try {
        confirmedThreeFrame = enemyLayer.render(worldFrame, now) === true;
        if (confirmedThreeFrame) enemyRenderMode = 'ready';
        else fallbackFromEnemyLayer(enemyLayer, new Error('Three.js world rendering failed'));
      } catch (error) {
        fallbackFromEnemyLayer(enemyLayer, error);
      }
    }

    for (const { enemy, projection } of projectedEnemies) {
      if (projection.visible) {
        visible.push(enemy.id);
        if (enemyIsLocked(enemy, projection)) locked.push(enemy);
      } else {
        const indicator = getThreatIndicator({ ...projection, distance: enemy.distance }, { width, height });
        if (indicator) {
          threats.push({ enemyId: enemy.id, edge: indicator.edge, distance: enemy.distance });
          drawThreat(ctx, indicator, enemy, now);
        }
      }
    }

    if (!confirmedThreeFrame) {
      const proceduralInsects = [
        ...projectedEnemies.map(({ enemy, projection }) => ({ body: enemy, projection })),
        ...projectedCorpses.map(({ corpse, projection }) => ({ body: corpse, projection }))
      ].sort((left, right) => finiteNumber(right.body.distance, 1) - finiteNumber(left.body.distance, 1));
      for (const { body, projection } of proceduralInsects) {
        if (projection.visible) drawInsect(ctx, body, projection, now, reducedMotion);
      }
    }

    drawParticles(ctx, particles, delta);
    locked.sort((left, right) => left.distance - right.distance);
    const lockedEnemyId = locked[0]?.id ?? null;
    drawReticle(ctx, width, height, lockedEnemyId !== null, state.weapon?.recoil, now, reducedMotion);
    drawScanOverlay(ctx, width, height, now, reducedMotion);
    drawDamageVignette(ctx, width, height, state.shield, damagePulse);
    ctx.restore();

    return {
      lockedEnemyId,
      visibleEnemyIds: visible,
      threats,
      particleCount: particles.length,
      enemyRenderMode
    };
  }

  function getViewport() {
    return { width, height };
  }

  function getDiagnostics() {
    let layer = null;
    try {
      layer = enemyLayer?.getDiagnostics?.() || retiredLayerDiagnostics;
    } catch {
      // QA diagnostics must not affect production rendering.
    }
    return exposeDiagnostics === true
      ? { enemyLayerFailure, enemyRenderMode, layer, frame: copyDiagnosticFrame(diagnosticFrame) }
      : { enemyLayerFailure, enemyRenderMode, layer };
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    releaseGradeCache();
    gradeUnavailable = true;
    worldLayerController?.abort();
    globalObject?.removeEventListener?.('resize', handleResize);
    const activeLayer = enemyLayer;
    enemyLayer = null;
    disposeEnemyLayer(activeLayer);
    effects.clear();
    particles.length = 0;
    diagnosticFrame = null;
  }

  globalObject?.addEventListener?.('resize', handleResize, { passive: true });
  resize();
  if (worldCanvas) {
    const factory = worldLayerFactory || ((target, options) => import('./three-world-layer.mjs')
      .then(({ createThreeWorldLayer }) => createThreeWorldLayer(target, options)));
    let pendingLayer;
    try {
      pendingLayer = factory(worldCanvas, exposeDiagnostics === true
        ? { exposeDiagnostics: true, reducedMotion, signal: worldLayerController?.signal }
        : { reducedMotion, signal: worldLayerController?.signal });
    } catch (error) {
      fallbackFromEnemyLayer(enemyLayer, error);
    }
    Promise.resolve(pendingLayer).then((layer) => {
      if (destroyed || enemyRenderMode === 'fallback') {
        disposeEnemyLayer(layer);
        return;
      }
      try {
        layer.resize(width, height, pixelRatio);
        enemyLayer = layer;
      } catch (error) {
        fallbackFromEnemyLayer(layer, error);
      }
    }, (error) => {
      if (!destroyed) fallbackFromEnemyLayer(enemyLayer, error);
    });
  }
  return {
    resize,
    render,
    resetMission,
    present,
    burst,
    destroy,
    getViewport,
    getDiagnostics,
    ...(exposeDiagnostics === true ? { seedMaximumEffectsForQa } : {})
  };
}
