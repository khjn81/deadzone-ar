import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright-core';

const MAX_AVERAGE_FRAME_MS = 25;
const MAX_P95_FRAME_MS = 50;
const MODEL_PATH = '/game/assets/models/infected-swarmer.glb';
const MODEL_PATHS = Object.freeze([
  MODEL_PATH,
  '/game/assets/models/infected-stinger.glb',
  '/game/assets/models/infected-bulwark.glb',
  '/game/assets/models/infected-queen.glb'
]);
const LEGACY_MODEL_PATTERN = /(zombie|undead|possessed)/i;
const MIME_TYPES = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.glb', 'model/gltf-binary'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.webmanifest', 'application/manifest+json; charset=utf-8']
]);

const positiveFinite = (value) => Number.isFinite(value) && value > 0;

export function isVerifiedLoadedModelAbort(candidate, runtimeProof) {
  return candidate?.request != null
    && candidate.request === candidate.responseRequest
    && candidate.request === candidate.terminalRequest
    && MODEL_PATHS.includes(candidate.pathname)
    && candidate.responseStatus === 200
    && candidate.errorText === 'net::ERR_ABORTED'
    && runtimeProof?.modelReady === true
    && runtimeProof.destroyed === false
    && runtimeProof.contextLost === false
    && positiveFinite(runtimeProof.renderCount)
    && positiveFinite(runtimeProof.programCount)
    && positiveFinite(runtimeProof.sourceGeometryCount)
    && positiveFinite(runtimeProof.sourceMaterialCount)
    && Number.isFinite(runtimeProof.sourceTextureCount);
}

function gameRootFor(cwd) {
  const candidates = [path.join(cwd, 'public', 'game'), cwd];
  const root = candidates.find((candidate) => (
    existsSync(path.join(candidate, 'index.html'))
    && existsSync(path.join(candidate, 'src', 'three-world-layer.mjs'))
  ));
  if (!root) throw new Error(`Could not find a game root beneath ${cwd}`);
  return path.resolve(root);
}

function chromeExecutable() {
  return [
    process.env.DEADZONE_CHROME_PATH,
    chromium.executablePath(),
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    chromium.executablePath()
  ].filter(Boolean).find((candidate) => existsSync(candidate));
}

async function createStaticServer(root, requests) {
  const server = createServer(async (request, response) => {
    let pathname = '/';
    try {
      pathname = decodeURIComponent(new URL(request.url || '/', 'http://127.0.0.1').pathname);
      const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
      let target = path.resolve(root, relative);
      if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
        response.writeHead(403).end('Forbidden');
        requests.push({ bytes: 0, contentType: 'text/plain', pathname, status: 403 });
        return;
      }
      if (pathname === '/game/sw.js' && !existsSync(target)) {
        const body = Buffer.from('');
        const contentType = 'text/javascript; charset=utf-8';
        response.writeHead(200, {
          'Cache-Control': 'no-store',
          'Content-Length': body.length,
          'Content-Type': contentType
        });
        response.end(body);
        requests.push({ bytes: body.length, contentType, pathname, status: 200 });
        return;
      }
      if ((await stat(target)).isDirectory()) target = path.join(target, 'index.html');
      const body = await readFile(target);
      const contentType = MIME_TYPES.get(path.extname(target).toLowerCase()) || 'application/octet-stream';
      response.writeHead(200, {
        'Cache-Control': 'no-store',
        'Content-Length': body.length,
        'Content-Type': contentType
      });
      response.end(body);
      requests.push({ bytes: body.length, contentType, pathname, status: 200 });
    } catch {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
      requests.push({ bytes: 0, contentType: 'text/plain; charset=utf-8', pathname, status: 404 });
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return server;
}

export function watchPage(page, label, failures) {
  let pageClosing = false;
  const pageFailures = { consoleErrors: [], pageErrors: [], requestFailures: [] };
  const pendingModelRequests = new Set();
  const idleWaiters = new Set();
  const modelRequests = new Map();
  const modelIds = new WeakMap();
  const modelLifecycle = [];
  let nextModelId = 1;
  const isModelRequest = (request) => new URL(request.url()).pathname.endsWith('.glb');
  const modelId = (request) => {
    if (!modelIds.has(request)) modelIds.set(request, nextModelId++);
    return modelIds.get(request);
  };
  const finishModelRequest = (request) => {
    pendingModelRequests.delete(request);
    if (pendingModelRequests.size === 0) {
      for (const resolve of idleWaiters) resolve();
      idleWaiters.clear();
    }
  };
  const recordRequestFailure = (request, errorText) => {
    const record = `${label}: ${request.url()}: ${errorText}`;
    pageFailures.requestFailures.push(record);
    failures.requestFailures.push(record);
  };
  const settleModelFailures = async ({ allowRuntimeProof = true } = {}) => {
    const unsettled = [...modelRequests.values()].filter((record) => (
      record.errorText && !record.failureRecorded && !record.verifiedArtifact
    ));
    if (unsettled.length === 0) return;
    let runtimeProof = null;
    if (allowRuntimeProof) {
      try {
        runtimeProof = await page.evaluate(() => globalThis.__DEADZONE__?.getRendererDiagnostics?.().layer || null);
      } catch {
        // A missing runtime proof must leave every failed request fatal.
      }
    }
    for (const record of unsettled) {
      if (isVerifiedLoadedModelAbort(record, runtimeProof)) {
        record.verifiedArtifact = true;
        failures.verifiedModelAborts.push({
          errorText: record.errorText,
          label,
          pathname: record.pathname,
          status: record.responseStatus
        });
      } else {
        record.failureRecorded = true;
        recordRequestFailure(record.request, record.errorText);
      }
    }
  };
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const record = `${label}: ${message.text()}`;
    pageFailures.consoleErrors.push(record);
    failures.consoleErrors.push(record);
  });
  page.on('pageerror', (error) => {
    const record = `${label}: ${error.message}`;
    pageFailures.pageErrors.push(record);
    failures.pageErrors.push(record);
  });
  page.on('request', (request) => {
    if (isModelRequest(request)) {
      modelLifecycle.push(`request:${modelId(request)}`);
      pendingModelRequests.add(request);
      modelRequests.set(request, {
        errorText: null,
        failureRecorded: false,
        pathname: new URL(request.url()).pathname,
        request,
        responseRequest: null,
        responseStatus: null,
        terminalRequest: null,
        verifiedArtifact: false
      });
    }
  });
  page.on('requestfinished', (request) => {
    if (isModelRequest(request)) {
      modelLifecycle.push(`finished:${modelId(request)}`);
      const record = modelRequests.get(request);
      if (record) record.terminalRequest = request;
      finishModelRequest(request);
    }
  });
  page.on('requestfailed', (request) => {
    const errorText = request.failure()?.errorText || 'failed';
    const expectedPageCloseCancellation = pageClosing && errorText === 'net::ERR_ABORTED';
    if (isModelRequest(request)) modelLifecycle.push(`failed:${modelId(request)}:${errorText}`);
    if (!expectedPageCloseCancellation) {
      const modelRequest = modelRequests.get(request);
      if (modelRequest) {
        modelRequest.errorText = errorText;
        modelRequest.terminalRequest = request;
      } else {
        recordRequestFailure(request, errorText);
      }
    }
    if (isModelRequest(request)) finishModelRequest(request);
  });
  page.on('response', (response) => {
    const pathname = new URL(response.url()).pathname;
    if (pathname.endsWith('.glb')) {
      const request = response.request();
      modelLifecycle.push(`response:${modelId(request)}:${response.status()}`);
      const record = modelRequests.get(request);
      if (record) {
        record.responseRequest = request;
        record.responseStatus = response.status();
      }
      failures.modelResponses.push({ label, pathname, status: response.status() });
    }
  });
  return {
    async assertNoErrors() {
      await settleModelFailures({ allowRuntimeProof: page.isClosed?.() !== true });
      assert.deepEqual(pageFailures, {
        consoleErrors: [],
        pageErrors: [],
        requestFailures: []
      }, `${label} browser failures; model lifecycle=${JSON.stringify(modelLifecycle)}`);
    },
    beginPageClose() { pageClosing = true; },
    async waitForModelIdle() {
      await page.waitForLoadState('networkidle');
      if (pendingModelRequests.size > 0) {
        await Promise.race([
          new Promise((resolve) => idleWaiters.add(resolve)),
          page.waitForTimeout(5_000).then(() => {
            throw new Error(`${label} model requests did not become idle before teardown`);
          })
        ]);
      }
      await settleModelFailures();
    }
  };
}

async function installBrowserGuards(context, { syntheticCamera = false } = {}) {
  await context.addInitScript(() => {
    globalThis.__DEADZONE_NATIVE_CAMERA_CALLS__ = 0;
    globalThis.__DEADZONE_CAMERA_FRAME_UPLOADS__ = 0;
    globalThis.__DEADZONE_INSECT_ELLIPSE_DRAWS__ = 0;
    const worldContexts = new Set();
    const originalGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function getContext(kind, ...args) {
      const context = originalGetContext.call(this, kind, ...args);
      if (this.id === 'worldCanvas' && (kind === 'webgl' || kind === 'webgl2') && context) {
        worldContexts.add(context);
      }
      return context;
    };
    globalThis.__DEADZONE_WEBGL_CONTEXT_DIAGNOSTICS__ = () => ({
      uniqueCount: worldContexts.size
    });
    const originalEllipse = CanvasRenderingContext2D.prototype.ellipse;
    CanvasRenderingContext2D.prototype.ellipse = function ellipse(...args) {
      globalThis.__DEADZONE_INSECT_ELLIPSE_DRAWS__ += 1;
      return originalEllipse.apply(this, args);
    };
    for (const Context of [globalThis.WebGLRenderingContext, globalThis.WebGL2RenderingContext]) {
      if (!Context?.prototype?.texImage2D) continue;
      const originalTexImage2D = Context.prototype.texImage2D;
      Context.prototype.texImage2D = function texImage2D(...args) {
        if (args.some((value) => value instanceof HTMLVideoElement || value?.id === 'cameraFeed')) {
          globalThis.__DEADZONE_CAMERA_FRAME_UPLOADS__ += 1;
        }
        return originalTexImage2D.apply(this, args);
      };
    }
    const mediaDevicesPrototype = globalThis.MediaDevices?.prototype;
    if (mediaDevicesPrototype?.getUserMedia) {
      Object.defineProperty(mediaDevicesPrototype, 'getUserMedia', {
        configurable: true,
        value() {
          globalThis.__DEADZONE_NATIVE_CAMERA_CALLS__ += 1;
          throw new Error('Browser smoke forbids native getUserMedia');
        }
      });
    }

    const trackedWindowTypes = new Set(['orientationchange', 'pagehide', 'resize']);
    const shouldTrack = (target, type) => {
      if (target === globalThis) return trackedWindowTypes.has(type);
      if (target === document) return type === 'visibilitychange';
      if (target?.id === 'worldCanvas') return type === 'webglcontextlost';
      if (target?.id === 'arCanvas') return type.startsWith('pointer');
      return type === 'click' && typeof target?.id === 'string' && target.id.endsWith('Button');
    };
    const registrations = [];
    const originalAdd = EventTarget.prototype.addEventListener;
    const originalRemove = EventTarget.prototype.removeEventListener;
    EventTarget.prototype.addEventListener = function addEventListener(type, handler, options) {
      if (shouldTrack(this, type)) registrations.push({ target: this, type, handler, options, active: true });
      return originalAdd.call(this, type, handler, options);
    };
    EventTarget.prototype.removeEventListener = function removeEventListener(type, handler, options) {
      const record = registrations.findLast((candidate) => (
        candidate.active && candidate.target === this && candidate.type === type && candidate.handler === handler
      ));
      if (record) record.active = false;
      return originalRemove.call(this, type, handler, options);
    };
    globalThis.__DEADZONE_LISTENER_DIAGNOSTICS__ = () => ({
      active: registrations.filter(({ active }) => active).length,
      activeRecords: registrations.filter(({ active }) => active).map(({ target, type }) => ({
        target: target === globalThis ? 'window' : target === document ? 'document' : target?.id || target?.constructor?.name || 'unknown',
        type
      })),
      added: registrations.length
    });
  });
  if (syntheticCamera) {
    await context.addInitScript(() => {
      globalThis.__DEADZONE_SYNTHETIC_CAMERA_CALLS__ = 0;
      Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
        configurable: true,
        value: async () => {
          globalThis.__DEADZONE_SYNTHETIC_CAMERA_CALLS__ += 1;
          const canvas = document.createElement('canvas');
          canvas.width = 640;
          canvas.height = 480;
          const context = canvas.getContext('2d');
          const gradient = context.createLinearGradient(0, 0, canvas.width, canvas.height);
          gradient.addColorStop(0, '#173d35');
          gradient.addColorStop(1, '#091411');
          context.fillStyle = gradient;
          context.fillRect(0, 0, canvas.width, canvas.height);
          context.fillStyle = '#b8ff3d';
          context.fillRect(280, 200, 80, 80);
          const stream = canvas.captureStream(5);
          globalThis.__DEADZONE_SYNTHETIC_CAMERA_CANVAS__ = canvas;
          globalThis.__DEADZONE_SYNTHETIC_CAMERA_STREAM__ = stream;
          return stream;
        }
      });
    });
  }
}

async function waitForQaApp(page, url, { camera = false } = {}) {
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => (
    typeof globalThis.__DEADZONE__?.seedMaximumWorldForQa === 'function'
    && typeof globalThis.__DEADZONE__?.seedEffectsForQa === 'function'
  ));
  if (camera) await page.getByRole('button', { name: /작전 시작/ }).click();
  else await page.evaluate(() => globalThis.__DEADZONE__.startTraining());
  await page.waitForFunction(() => globalThis.__DEADZONE__?.getState?.().phase === 'playing');
  await page.waitForFunction(() => globalThis.__DEADZONE__?.getRendererDiagnostics?.().layer?.modelReady === true, null, { timeout: 12_000 });
}

async function seedMaximumScene(page) {
  const seeded = await page.evaluate(() => {
    globalThis.__DEADZONE__.setView(0, 0);
    const worldSeeded = globalThis.__DEADZONE__.seedMaximumWorldForQa();
    const afterWorld = globalThis.__DEADZONE__.getRendererDiagnostics();
    const effectsSeeded = globalThis.__DEADZONE__.seedEffectsForQa();
    const afterEffects = globalThis.__DEADZONE__.getRendererDiagnostics();
    return { afterEffects, afterWorld, effectsSeeded, worldSeeded };
  });
  try {
    await page.waitForFunction(() => {
      const layer = globalThis.__DEADZONE__?.getRendererDiagnostics?.().layer;
      return layer?.liveInsectCount === 6
        && layer?.corpseCount === 4
        && layer?.casingCount === 20
        && layer?.impactCount === 8
        && layer?.fragmentCount === 36
        && layer?.programCount > 0
        && layer?.shaderErrorCount === 0;
    }, null, { timeout: 8_000 });
  } catch (error) {
    const diagnostics = await page.evaluate(() => globalThis.__DEADZONE__?.getRendererDiagnostics?.());
    throw new Error(`maximum fixture did not converge: seeded=${JSON.stringify(seeded)} final=${JSON.stringify(diagnostics)}; ${error.message}`);
  }
}

async function inspectMaximumScene(page, viewport, measurePerformance) {
  return page.evaluate(async ({ maxAverageFrameMs, maxP95FrameMs, measure, viewport }) => {
    const qa = globalThis.__DEADZONE__;
    const state = qa.getState();
    const target = state.enemies[0];
    const maximumDiagnostics = qa.getRendererDiagnostics();
    const projectionViewport = {
      width: document.getElementById('arCanvas').clientWidth,
      height: document.getElementById('arCanvas').clientHeight
    };
    qa.setView(target.yaw + 90, target.pitch);
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const away = qa.getRendererDiagnostics().frame.insects.find(({ id }) => id === target.id);
    qa.setView(target.yaw, target.pitch);
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const aimed = qa.getRendererDiagnostics().frame.insects.find(({ id }) => id === target.id);

    const frameTimes = [];
    const renderCountBefore = qa.getRendererDiagnostics().layer.renderCount;
    const samples = measure ? 30 : 4;
    for (let index = 0; index < samples; index += 1) {
      const started = performance.now();
      qa.setView(target.yaw + Math.sin(index * 0.2) * 0.25, target.pitch);
      await new Promise((resolve) => requestAnimationFrame(resolve));
      frameTimes.push(performance.now() - started);
    }
    const sorted = [...frameTimes].sort((left, right) => left - right);
    const averageFrameMs = frameTimes.reduce((sum, value) => sum + value, 0) / frameTimes.length;
    const p95FrameMs = sorted[Math.ceil(sorted.length * 0.95) - 1];
    const postPerformanceDiagnostics = qa.getRendererDiagnostics();
    const worldCanvas = document.getElementById('worldCanvas');
    const arCanvas = document.getElementById('arCanvas');
    const camera = document.getElementById('cameraFeed');
    const worldContext = worldCanvas.getContext('webgl2') || worldCanvas.getContext('webgl');
    const app = document.getElementById('gameApp');
    return {
      cameraDirection: {
        aimedOffset: Math.hypot(
          (aimed.x - projectionViewport.width / 2) / projectionViewport.width,
          (aimed.centerY - projectionViewport.height / 2) / projectionViewport.height
        ),
        targetId: target.id,
        aimedVisible: aimed.visible,
        awayVisible: away.visible
      },
      composition: {
        arZIndex: getComputedStyle(arCanvas).zIndex,
        cameraBehindWorld: Number(getComputedStyle(camera).zIndex) < Number(getComputedStyle(worldCanvas).zIndex),
        contextAlpha: worldContext?.getContextAttributes?.().alpha === true,
        cameraActive: app.dataset.camera === 'true',
        cameraOpacity: Number(getComputedStyle(camera).opacity),
        syntheticStreamAttached: camera.srcObject === globalThis.__DEADZONE_SYNTHETIC_CAMERA_STREAM__,
        syntheticTrackCount: camera.srcObject?.getVideoTracks?.().length || 0,
        trainingOpacity: Number(getComputedStyle(document.querySelector('.training-world')).opacity),
        worldBackgroundColor: getComputedStyle(worldCanvas).backgroundColor,
        worldPointerEvents: getComputedStyle(worldCanvas).pointerEvents,
        worldZIndex: getComputedStyle(worldCanvas).zIndex
      },
      diagnostics: maximumDiagnostics,
      cameraFrameUploads: globalThis.__DEADZONE_CAMERA_FRAME_UPLOADS__,
      nativeCameraCalls: globalThis.__DEADZONE_NATIVE_CAMERA_CALLS__,
      syntheticCameraCalls: globalThis.__DEADZONE_SYNTHETIC_CAMERA_CALLS__ || 0,
      webglContexts: globalThis.__DEADZONE_WEBGL_CONTEXT_DIAGNOSTICS__(),
      performance: {
        averageFrameMs,
        maxAverageFrameMs,
        maxP95FrameMs,
        p95FrameMs,
        positiveRenderDelta: postPerformanceDiagnostics.layer.renderCount - renderCountBefore,
        sampleCount: frameTimes.length
      },
      renderSize: {
        width: worldCanvas.clientWidth,
        height: worldCanvas.clientHeight,
        arBackingRatio: arCanvas.width / arCanvas.clientWidth,
        worldBackingRatio: worldCanvas.width / worldCanvas.clientWidth
      },
      viewport
    };
  }, {
    maxAverageFrameMs: MAX_AVERAGE_FRAME_MS,
    maxP95FrameMs: MAX_P95_FRAME_MS,
    measure: measurePerformance,
    viewport
  });
}

async function exerciseCriticalKillAndMiss(page) {
  return page.evaluate(async () => {
    const qa = globalThis.__DEADZONE__;
    // Keep this legacy combat probe deterministic: one projectile makes the
    // miss-impact reprojection assertion unambiguous while weapon-specific
    // behavior is covered by the app/core suites.
    qa.selectWeapon?.('sidearm');
    qa.seedMaximumWorldForQa();
    const initial = qa.getState();
    const initialCorpseIds = new Set(initial.corpses.map(({ id }) => id));
    const target = initial.enemies.find(({ type, elite }) => type === 'swarmer' && !elite);
    qa.setView(target.yaw, target.pitch);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const targetBeforeShot = qa.getRendererDiagnostics().frame.insects.find(({ id }) => id === target.id);
    const criticalAccepted = qa.shoot();
    await new Promise((resolve) => setTimeout(resolve, 350));
    qa.setView(target.yaw + 120, target.pitch + 18);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const missAccepted = qa.shoot();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const state = qa.getState();
    const critical = [...state.events].reverse().find(({ type }) => type === 'critical-hit');
    const kill = [...state.events].reverse().find(({ type }) => type === 'kill');
    const miss = [...state.events].reverse().find(({ type }) => type === 'miss');
    const viewport = {
      width: document.getElementById('arCanvas').clientWidth,
      height: document.getElementById('arCanvas').clientHeight
    };
    const centeredImpact = qa.getRendererDiagnostics().frame.effects.impacts.find(({ id }) => id === miss.id);
    const awayYaw = miss.yaw >= 0 ? miss.yaw - 90 : miss.yaw + 90;
    qa.setView(awayYaw, miss.pitch);
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const awayImpact = qa.getRendererDiagnostics().frame.effects.impacts.find(({ id }) => id === miss.id);
    qa.setView(miss.yaw, miss.pitch);
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const returnedImpact = qa.getRendererDiagnostics().frame.effects.impacts.find(({ id }) => id === miss.id);
    const effectDiagnostics = qa.getRendererDiagnostics().layer;
    const createdCorpse = state.corpses.find(({ id }) => id === kill?.corpseId);
    return {
      corpseCount: state.corpses.length,
      corpseMatchesKill: createdCorpse?.id === kill?.corpseId
        && createdCorpse?.enemyId === target.id
        && kill?.corpse?.id === kill?.corpseId
        && kill?.corpse?.enemyId === target.id,
      corpseNew: !initialCorpseIds.has(kill?.corpseId),
      criticalAccepted,
      criticalEventId: critical?.id || null,
      criticalHits: state.stats.criticalHits,
      killEventId: kill?.id || null,
      killCorpseId: kill?.corpseId || null,
      kills: state.stats.kills,
      missAccepted,
      missEventId: miss?.id || null,
      missImpactCount: effectDiagnostics?.impactCount || 0,
      missPose: miss ? { yaw: miss.yaw, pitch: miss.pitch } : null,
      missReprojection: {
        awayVisible: awayImpact?.visible === true,
        eventId: returnedImpact?.id ?? null,
        returnOffset: Math.hypot(
          (returnedImpact.x - viewport.width / 2) / viewport.width,
          (returnedImpact.y - viewport.height / 2) / viewport.height
        ),
        returnVisible: returnedImpact?.visible === true,
        sameCenter: centeredImpact?.x === returnedImpact?.x && centeredImpact?.y === returnedImpact?.y
      },
      targetId: target.id,
      targetRemoved: !state.enemies.some(({ id }) => id === target.id),
      targetVisibleBeforeShot: targetBeforeShot?.visible === true,
      uniqueEventIds: new Set(state.events.map(({ id }) => id)).size === state.events.length
    };
  });
}

async function triggerContextLossAndTeardown(page, pageWatch) {
  await pageWatch.waitForModelIdle();
  await pageWatch.assertNoErrors();
  const contextLoss = await page.evaluate(async () => {
    const canvas = document.getElementById('worldCanvas');
    const ellipseDrawsBefore = globalThis.__DEADZONE_INSECT_ELLIPSE_DRAWS__;
    const event = new Event('webglcontextlost', { cancelable: true });
    const prevented = !canvas.dispatchEvent(event);
    globalThis.__DEADZONE__.setView(0, 0);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    return {
      prevented,
      diagnostics: globalThis.__DEADZONE__.getRendererDiagnostics(),
      firstFallbackEllipseDrawDelta: globalThis.__DEADZONE_INSECT_ELLIPSE_DRAWS__ - ellipseDrawsBefore,
      webglContexts: globalThis.__DEADZONE_WEBGL_CONTEXT_DIAGNOSTICS__()
    };
  });
  await page.waitForFunction(() => globalThis.__DEADZONE__?.getRendererDiagnostics?.().enemyRenderMode === 'fallback');
  const teardown = await page.evaluate(() => {
    const qa = globalThis.__DEADZONE__;
    dispatchEvent(new PageTransitionEvent('pagehide'));
    const diagnostics = qa.getRendererDiagnostics();
    const syntheticTracks = globalThis.__DEADZONE_SYNTHETIC_CAMERA_STREAM__?.getTracks?.() || [];
    return {
      diagnostics,
      globalReleased: !globalThis.__DEADZONE__,
      listeners: globalThis.__DEADZONE_LISTENER_DIAGNOSTICS__(),
      nativeCameraCalls: globalThis.__DEADZONE_NATIVE_CAMERA_CALLS__,
      syntheticTrackStates: syntheticTracks.map(({ readyState }) => readyState),
      webglContexts: globalThis.__DEADZONE_WEBGL_CONTEXT_DIAGNOSTICS__()
    };
  });
  await page.waitForTimeout(0);
  await pageWatch.assertNoErrors();
  pageWatch.beginPageClose();
  await page.close();
  await pageWatch.assertNoErrors();
  return { contextLoss, teardown: { ...teardown, pageClosed: page.isClosed() } };
}

async function triggerNormalTeardown(page, pageWatch) {
  await pageWatch.waitForModelIdle();
  await pageWatch.assertNoErrors();
  const teardown = await page.evaluate(() => {
    const qa = globalThis.__DEADZONE__;
    dispatchEvent(new PageTransitionEvent('pagehide'));
    return {
      diagnostics: qa.getRendererDiagnostics(),
      globalReleased: !globalThis.__DEADZONE__,
      listeners: globalThis.__DEADZONE_LISTENER_DIAGNOSTICS__(),
      webglContexts: globalThis.__DEADZONE_WEBGL_CONTEXT_DIAGNOSTICS__()
    };
  });
  await page.waitForTimeout(0);
  await pageWatch.assertNoErrors();
  pageWatch.beginPageClose();
  await page.close();
  await pageWatch.assertNoErrors();
  return { ...teardown, pageClosed: page.isClosed() };
}

async function inspectModelFailure(browser, url, viewport, failures) {
  const context = await browser.newContext({ deviceScaleFactor: 1, viewport });
  await installBrowserGuards(context);
  await context.route('**/infected-swarmer.glb', (route) => route.fulfill({
    status: 200,
    contentType: 'model/gltf-binary',
    body: 'intentional invalid glTF payload'
  }));
  const page = await context.newPage();
  const pageWatch = watchPage(page, 'model-failure', failures);
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => typeof globalThis.__DEADZONE__?.seedMaximumWorldForQa === 'function');
  await page.evaluate(() => globalThis.__DEADZONE__.startTraining());
  await page.waitForFunction(() => globalThis.__DEADZONE__?.getState?.().phase === 'playing');
  await page.waitForFunction(() => {
    const layer = globalThis.__DEADZONE__?.getRendererDiagnostics?.().layer;
    return layer?.modelReady === true && layer.speciesSourceCount === 3 && layer.speciesFallbackCount === 1;
  });
  const result = await page.evaluate(async () => {
    const qa = globalThis.__DEADZONE__;
    const ellipseDrawsBefore = globalThis.__DEADZONE_INSECT_ELLIPSE_DRAWS__;
    qa.seedMaximumWorldForQa();
    await new Promise((resolve) => requestAnimationFrame(resolve));
    return {
      diagnostics: qa.getRendererDiagnostics(),
      insectEllipseDrawDelta: globalThis.__DEADZONE_INSECT_ELLIPSE_DRAWS__ - ellipseDrawsBefore,
      liveCount: qa.getState().enemies.length,
      nativeCameraCalls: globalThis.__DEADZONE_NATIVE_CAMERA_CALLS__,
      webglContexts: globalThis.__DEADZONE_WEBGL_CONTEXT_DIAGNOSTICS__()
    };
  });
  await pageWatch.waitForModelIdle();
  await pageWatch.assertNoErrors();
  await page.evaluate(() => dispatchEvent(new PageTransitionEvent('pagehide')));
  await page.waitForTimeout(0);
  await pageWatch.assertNoErrors();
  pageWatch.beginPageClose();
  await page.close();
  await pageWatch.assertNoErrors();
  await context.close();
  return result;
}

function assertMaximumResult(result, { cameraActive }) {
  const layer = result.diagnostics.layer;
  assert.equal(result.diagnostics.enemyRenderMode, 'ready');
  assert.equal(layer.liveInsectCount, 6);
  assert.equal(layer.corpseCount, 4);
  assert.equal(layer.casingCount, 20);
  assert.equal(layer.impactCount, 8);
  assert.equal(layer.fragmentCount, 36);
  assert.ok(layer.programCount > 0, 'real WebGL must link at least one shader program');
  assert.equal(layer.shaderErrorCount, 0);
  assert.ok(layer.sourceGeometryCount > 0);
  assert.ok(layer.sourceMaterialCount > 0);
  assert.ok(layer.sourceTextureCount > 0);
  assert.equal(layer.speciesSourceCount, 4);
  assert.equal(layer.speciesFallbackCount, 0);
  assert.deepEqual(layer.speciesModelKinds, ['swarmer', 'stinger', 'bulwark', 'queen']);
  assert.equal(result.cameraDirection.awayVisible, false);
  assert.equal(result.cameraDirection.aimedVisible, true);
  assert.ok(result.cameraDirection.aimedOffset <= 0.015);
  assert.deepEqual(result.composition, {
    arZIndex: '2',
    cameraBehindWorld: true,
    contextAlpha: true,
    cameraActive,
    cameraOpacity: cameraActive ? 1 : 0,
    syntheticStreamAttached: cameraActive,
    syntheticTrackCount: cameraActive ? 1 : 0,
    trainingOpacity: cameraActive ? 0 : 1,
    worldBackgroundColor: 'rgba(0, 0, 0, 0)',
    worldPointerEvents: 'none',
    worldZIndex: '1'
  });
  assert.equal(result.nativeCameraCalls, 0);
  assert.equal(result.cameraFrameUploads, 0);
  assert.equal(result.webglContexts.uniqueCount, 1, 'one world canvas owns one unique WebGL context');
  assert.equal(result.syntheticCameraCalls, cameraActive ? 1 : 0);
  assert.ok(result.performance.positiveRenderDelta > 0);
  assert.ok(result.performance.averageFrameMs <= MAX_AVERAGE_FRAME_MS);
  assert.ok(result.performance.p95FrameMs <= MAX_P95_FRAME_MS);
}

async function main() {
  const gameRoot = gameRootFor(process.cwd());
  const serveRoot = path.dirname(gameRoot);
  const executablePath = chromeExecutable();
  if (!executablePath) throw new Error('Chrome/Chromium is required; set DEADZONE_CHROME_PATH');
  const requests = [];
  const failures = {
    consoleErrors: [],
    modelResponses: [],
    pageErrors: [],
    requestFailures: [],
    verifiedModelAborts: []
  };
  const server = await createStaticServer(serveRoot, requests);
  const origin = `http://127.0.0.1:${server.address().port}`;
  const qaUrl = `${origin}/game/index.html?training=1&seed=424242&duration=8&diagnostics=1`;
  const screenshotFlag = process.argv.indexOf('--screenshot-dir');
  const artifactFlag = process.argv.indexOf('--artifact');
  const injectTeardownErrors = process.argv.includes('--inject-teardown-errors');
  let screenshotDirectory = null;
  if (screenshotFlag >= 0) {
    screenshotDirectory = path.resolve(process.argv[screenshotFlag + 1]);
    await mkdir(screenshotDirectory, { recursive: true });
  }
  let browser;
  try {
    browser = await chromium.launch({ executablePath, headless: true, args: ['--enable-webgl', '--ignore-gpu-blocklist'] });
    if (injectTeardownErrors) {
      process.stderr.write('[teardown probe] launching owned application\n');
      const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
      await installBrowserGuards(context);
      const page = await context.newPage();
      const pageWatch = watchPage(page, 'teardown-probe', failures);
      await waitForQaApp(page, qaUrl);
      const worldSeeded = await page.evaluate(() => globalThis.__DEADZONE__.seedMaximumWorldForQa());
      assert.equal(worldSeeded, true);
      await page.waitForFunction(() => {
        const layer = globalThis.__DEADZONE__?.getRendererDiagnostics?.().layer;
        return layer?.modelReady === true && layer.renderCount > 0
          && layer.programCount > 0 && layer.shaderErrorCount === 0;
      }, null, { timeout: 8_000 });
      process.stderr.write('[teardown probe] loaded models rendered; exercising pagehide\n');
      await page.evaluate(() => {
        addEventListener('pagehide', () => {
          console.error('intentional teardown console error');
          queueMicrotask(() => { throw new Error('intentional teardown page error'); });
        }, { once: true });
      });
      await triggerNormalTeardown(page, pageWatch);
      throw new Error('Teardown error injection was not rejected');
    }
    const mobileViewport = { width: 390, height: 844 };
    const mobileContext = await browser.newContext({ deviceScaleFactor: 2, viewport: mobileViewport });
    await installBrowserGuards(mobileContext, { syntheticCamera: true });
    const mobilePage = await mobileContext.newPage();
    const mobileWatch = watchPage(mobilePage, 'mobile', failures);
    await waitForQaApp(mobilePage, qaUrl, { camera: true });
    const combat = await exerciseCriticalKillAndMiss(mobilePage);
    await seedMaximumScene(mobilePage);
    const mobile = await inspectMaximumScene(mobilePage, mobileViewport, true);
    if (screenshotDirectory) await mobilePage.screenshot({ path: path.join(screenshotDirectory, 'insect-swarm-mobile.png') });
    const lifecycle = await triggerContextLossAndTeardown(mobilePage, mobileWatch);
    await mobileContext.close();

    const desktopViewport = { width: 1280, height: 800 };
    const desktopContext = await browser.newContext({ deviceScaleFactor: 1, viewport: desktopViewport });
    await installBrowserGuards(desktopContext);
    const desktopPage = await desktopContext.newPage();
    const desktopWatch = watchPage(desktopPage, 'desktop', failures);
    await waitForQaApp(desktopPage, qaUrl);
    await seedMaximumScene(desktopPage);
    const desktop = await inspectMaximumScene(desktopPage, desktopViewport, false);
    if (screenshotDirectory) await desktopPage.screenshot({ path: path.join(screenshotDirectory, 'insect-swarm-desktop.png') });
    const desktopTeardown = await triggerNormalTeardown(desktopPage, desktopWatch);
    await desktopContext.close();

    const modelFailure = await inspectModelFailure(browser, qaUrl, mobileViewport, failures);

    assertMaximumResult(mobile, { cameraActive: true });
    assertMaximumResult(desktop, { cameraActive: false });
    assert.deepEqual(mobile.renderSize, {
      width: 390,
      height: 844,
      arBackingRatio: 1.5,
      worldBackingRatio: 1.5
    });
    assert.deepEqual(desktop.viewport, desktopViewport);
    assert.ok(desktop.renderSize.width > 390 && desktop.renderSize.width <= 518);
    assert.equal(desktop.renderSize.height, 800);
    assert.equal(desktop.renderSize.arBackingRatio, 1);
    assert.equal(desktop.renderSize.worldBackingRatio, 1);
    assert.equal(combat.criticalAccepted, true);
    assert.equal(combat.missAccepted, true);
    assert.ok(combat.criticalEventId > 0 && combat.killEventId > 0 && combat.missEventId > 0);
    assert.ok(combat.criticalHits >= 1 && combat.kills >= 1);
    assert.equal(combat.corpseCount, 4);
    assert.equal(combat.corpseMatchesKill, true);
    assert.equal(combat.corpseNew, true);
    assert.ok(combat.killCorpseId > 0);
    assert.equal(combat.targetRemoved, true);
    assert.equal(combat.targetVisibleBeforeShot, true);
    assert.equal(combat.uniqueEventIds, true);
    assert.ok(Number.isFinite(combat.missPose?.yaw) && Number.isFinite(combat.missPose?.pitch));
    assert.equal(combat.missImpactCount, 1);
    assert.equal(combat.missReprojection.awayVisible, false);
    assert.equal(combat.missReprojection.returnVisible, true);
    assert.equal(combat.missReprojection.eventId, combat.missEventId);
    assert.equal(combat.missReprojection.sameCenter, true);
    assert.ok(combat.missReprojection.returnOffset <= 0.015);
    assert.equal(lifecycle.contextLoss.prevented, true);
    assert.equal(lifecycle.contextLoss.diagnostics.enemyRenderMode, 'fallback');
    assert.ok(lifecycle.contextLoss.firstFallbackEllipseDrawDelta >= 24);
    assert.equal(lifecycle.contextLoss.webglContexts.uniqueCount, 1);
    assert.equal(lifecycle.teardown.globalReleased, true);
    assert.equal(lifecycle.teardown.pageClosed, true);
    assert.equal(lifecycle.teardown.nativeCameraCalls, 0);
    assert.deepEqual(lifecycle.teardown.syntheticTrackStates, ['ended']);
    assert.equal(
      lifecycle.teardown.listeners.active,
      0,
      `application listeners after teardown: ${JSON.stringify(lifecycle.teardown.listeners.activeRecords)}`
    );
    assert.equal(lifecycle.teardown.diagnostics.layer.liveInsectCount, 0);
    assert.equal(lifecycle.teardown.diagnostics.layer.corpseCount, 0);
    assert.equal(lifecycle.teardown.diagnostics.layer.casingCount, 0);
    assert.equal(lifecycle.teardown.diagnostics.layer.impactCount, 0);
    assert.equal(lifecycle.teardown.diagnostics.layer.fragmentCount, 0);
    assert.equal(lifecycle.teardown.diagnostics.layer.sourceGeometryCount, 0);
    assert.equal(lifecycle.teardown.diagnostics.layer.sourceMaterialCount, 0);
    assert.equal(lifecycle.teardown.diagnostics.layer.sourceTextureCount, 0);
    assert.equal(lifecycle.teardown.diagnostics.layer.destroyed, true);
    assert.equal(lifecycle.teardown.diagnostics.frame, null);
    assert.equal(lifecycle.teardown.webglContexts.uniqueCount, 1);
    assert.equal(desktopTeardown.globalReleased, true);
    assert.equal(desktopTeardown.pageClosed, true);
    assert.equal(desktopTeardown.listeners.active, 0);
    assert.equal(desktopTeardown.diagnostics.layer.liveInsectCount, 0);
    assert.equal(desktopTeardown.diagnostics.layer.corpseCount, 0);
    assert.equal(desktopTeardown.diagnostics.layer.casingCount, 0);
    assert.equal(desktopTeardown.diagnostics.layer.impactCount, 0);
    assert.equal(desktopTeardown.diagnostics.layer.fragmentCount, 0);
    assert.equal(desktopTeardown.diagnostics.frame, null);
    assert.equal(desktopTeardown.webglContexts.uniqueCount, 1);
    assert.equal(modelFailure.diagnostics.enemyRenderMode, 'ready');
    assert.equal(modelFailure.diagnostics.layer.speciesSourceCount, 3);
    assert.equal(modelFailure.diagnostics.layer.speciesFallbackCount, 1);
    assert.equal(modelFailure.liveCount, 6);
    assert.equal(modelFailure.insectEllipseDrawDelta, 0, 'WebGL species fallback should keep the 2D body hidden');
    assert.equal(modelFailure.nativeCameraCalls, 0);
    assert.equal(modelFailure.webglContexts.uniqueCount, 1);
    assert.deepEqual(failures.consoleErrors, []);
    assert.deepEqual(failures.pageErrors, []);
    assert.deepEqual(failures.requestFailures, []);

    const successfulModels = failures.modelResponses.filter(({ label, status }) => label !== 'model-failure' && status === 200);
    assert.ok(successfulModels.length >= MODEL_PATHS.length * 2, 'each successful fixture loads all insect species models');
    assert.ok(successfulModels.every(({ pathname }) => MODEL_PATHS.includes(pathname)));
    assert.equal(new Set(successfulModels.map(({ label }) => label)).size, 2);
    assert.deepEqual(new Set(successfulModels.map(({ pathname }) => pathname)), new Set(MODEL_PATHS));
    assert.equal(
      requests.filter(({ pathname }) => MODEL_PATHS.includes(pathname) && !LEGACY_MODEL_PATTERN.test(pathname)).length >= MODEL_PATHS.length * 2,
      true,
      'each isolated successful fixture pre-caches and refreshes all insect species models',
    );
    assert.equal(requests.filter(({ pathname }) => LEGACY_MODEL_PATTERN.test(pathname)).length, 0);
    const modelRequest = requests.find(({ pathname }) => MODEL_PATHS.includes(pathname));
    assert.equal(modelRequest?.contentType, 'model/gltf-binary');
    const manifestRequest = requests.find(({ pathname }) => pathname === '/game/manifest.webmanifest');
    assert.equal(manifestRequest?.contentType, 'application/manifest+json; charset=utf-8');
    const workerRequests = requests.filter(({ pathname }) => pathname === '/game/sw.js');
    assert.ok(workerRequests.length > 0);
    assert.ok(workerRequests.every(({ bytes, contentType, status }) => (
      bytes > 0 && contentType === 'text/javascript; charset=utf-8' && status === 200
    )), 'browser smoke must serve the production module worker instead of the empty fallback');

    const result = {
      combat,
      desktop,
      desktopTeardown,
      executablePath,
      failures: {
        consoleErrors: failures.consoleErrors,
        pageErrors: failures.pageErrors,
        requestFailures: failures.requestFailures,
        verifiedModelAborts: failures.verifiedModelAborts
      },
      lifecycle,
      mobile,
      modelFailure,
      network: failures.modelResponses,
      origin,
      screenshots: screenshotDirectory
    };
    if (artifactFlag >= 0) {
      const artifactPath = process.argv[artifactFlag + 1];
      if (!artifactPath) throw new Error('--artifact requires a path');
      await mkdir(path.dirname(path.resolve(artifactPath)), { recursive: true });
      await writeFile(artifactPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    }
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

if (path.resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error}\n`);
    process.exitCode = 1;
  });
}
