import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { createApp, eventPresentation, shouldExposeDiagnostics } from '../public/game/src/app.mjs';
import { ARController } from '../public/game/src/ar-controller.mjs';
import { createRenderer } from '../public/game/src/renderer.mjs';

test('presents insect entries with their matching audio cues', () => {
  assert.deepEqual(eventPresentation({ type: 'spawn' }), {
    text: '', kind: 'info', audio: 'spawn'
  });
  assert.deepEqual(eventPresentation({ type: 'elite-spawn' }), {
    text: 'QUEEN SIGNAL', kind: 'danger', audio: 'elite-spawn', vibration: 'wave'
  });
});

test('enables browser diagnostics only for an explicit loopback QA query', () => {
  assert.equal(shouldExposeDiagnostics({ location: { hostname: '127.0.0.1', search: '?diagnostics=1' } }), true);
  assert.equal(shouldExposeDiagnostics({ location: { hostname: 'localhost', search: '?training=1' } }), false);
  assert.equal(shouldExposeDiagnostics({ location: { hostname: 'deadzone.example', search: '?diagnostics=1' } }), false);
});

test('presents insect weak points and extermination copy', () => {
  assert.deepEqual(eventPresentation({ type: 'shoot' }), {
    text: '', kind: 'info', audio: 'shoot', vibration: 'shoot', burst: 'muzzle'
  });
  assert.deepEqual(eventPresentation({ type: 'hit' }), {
    text: 'HIT', kind: 'success', audio: 'hit', vibration: 'hit', burst: 'hit'
  });
  assert.deepEqual(eventPresentation({ type: 'critical-hit' }), {
    text: 'CRITICAL', kind: 'success', audio: 'critical-hit', vibration: 'critical-hit', burst: 'critical-hit'
  });
  assert.equal(eventPresentation({ type: 'miss' }).audio, 'miss');
  assert.equal(eventPresentation({ type: 'headshot' }), null);
});

test('presents weapon-specific rail and cryo feedback', () => {
  assert.deepEqual(eventPresentation({ type: 'shoot', weaponId: 'rail' }), {
    text: '', kind: 'info', audio: 'rail', vibration: 'shoot', burst: 'rail'
  });
  assert.deepEqual(eventPresentation({ type: 'freeze', weaponId: 'cryo' }), {
    text: 'FROZEN', kind: 'info', audio: 'cryo', vibration: 'hit', burst: 'freeze'
  });
});

const root = new URL('../', import.meta.url);

async function gameFiles() {
  const [app, html, renderer, styles] = await Promise.all([
    readFile(new URL('public/game/src/app.mjs', root), 'utf8'),
    readFile(new URL('public/game/index.html', root), 'utf8'),
    readFile(new URL('public/game/src/renderer.mjs', root), 'utf8'),
    readFile(new URL('public/game/styles.css', root), 'utf8')
  ]);
  return { app, html, renderer, styles };
}

function fakeElement(id) {
  const listeners = new Map();
  const attributes = new Map();
  return {
    attributes,
    children: [],
    classList: { add() {}, remove() {}, toggle() {} },
    clientHeight: 844,
    clientWidth: 390,
    dataset: {},
    disabled: false,
    hidden: false,
    id,
    listeners,
    parentElement: { setAttribute() {} },
    style: {},
    addEventListener(type, handler) { listeners.set(type, handler); },
    click() { return listeners.get('click')?.({ currentTarget: this }); },
    closest() { return null; },
    play() { return Promise.resolve(); },
    querySelector() { return null; },
    removeEventListener(type, handler) {
      if (listeners.get(type) === handler) listeners.delete(type);
    },
    getAttribute(name) { return attributes.get(name) ?? null; },
    setAttribute(name, value) { attributes.set(name, String(value)); }
  };
}

function fakeAppDocument({ worldCanvas = null } = {}) {
  const elements = new Map();
  const listeners = new Map();
  return {
    hidden: false,
    addEventListener(type, handler) { listeners.set(type, handler); },
    dispatch(type) { return listeners.get(type)?.(); },
    getElementById(id) {
      if (id === 'worldCanvas') return worldCanvas;
      if (!elements.has(id)) elements.set(id, fakeElement(id));
      return elements.get(id);
    },
    removeEventListener(type, handler) {
      if (listeners.get(type) === handler) listeners.delete(type);
    }
  };
}

function installCanvasContext(canvas) {
  const gradient = { addColorStop() {} };
  const context = new Proxy({
    canvas,
    createLinearGradient() { return gradient; },
    createRadialGradient() { return gradient; }
  }, {
    get(target, property) {
      if (property in target) return target[property];
      return () => {};
    },
    set(target, property, value) {
      target[property] = value;
      return true;
    }
  });
  canvas.getContext = (kind) => kind === '2d' ? context : null;
}

function fakeAppGlobal({ syntheticCamera = false } = {}) {
  let nextFrameId = 0;
  let nextTimerId = 0;
  const frames = new Map();
  const timers = new Map();
  const globalObject = {
    location: { hostname: 'localhost', search: '' },
    performance: { now: () => 100 },
    addEventListener() {},
    cancelAnimationFrame(id) { frames.delete(id); },
    clearTimeout(id) { timers.delete(id); },
    matchMedia() { return { matches: false }; },
    removeEventListener() {},
    requestAnimationFrame(callback) {
      nextFrameId += 1;
      frames.set(nextFrameId, callback);
      return nextFrameId;
    },
    runAllTimers() {
      let remaining = 20;
      while (timers.size > 0 && remaining > 0) {
        const [id, callback] = timers.entries().next().value;
        timers.delete(id);
        callback();
        remaining -= 1;
      }
      assert.equal(timers.size, 0, 'fake timer queue drains without an infinite schedule');
    },
    runNextFrame(timestamp = 100) {
      const next = frames.entries().next().value;
      if (!next) return false;
      const [id, callback] = next;
      frames.delete(id);
      callback(timestamp);
      return true;
    },
    setTimeout(callback) {
      nextTimerId += 1;
      timers.set(nextTimerId, callback);
      return nextTimerId;
    },
    structuredClone(value) { return JSON.parse(JSON.stringify(value)); }
  };
  if (syntheticCamera) {
    globalObject.navigator = {
      mediaDevices: {
        async getUserMedia() {
          return { getTracks() { return []; } };
        }
      }
    };
  }
  return globalObject;
}

function installFakeAudioContext(globalObject) {
  const audioParam = () => ({
    exponentialRampToValueAtTime() {},
    linearRampToValueAtTime() {},
    setValueAtTime() {}
  });
  const audioNode = () => ({
    connect() {},
    disconnect() {},
    startCalls: [],
    stop() {},
    start(time) { this.startCalls.push(time); }
  });

  class FakeAudioContext {
    constructor() {
      this.state = 'suspended';
      this.currentTime = 0;
      this.sampleRate = 8000;
      this.destination = audioNode();
      this.sources = [];
      globalObject.audioContext = this;
    }

    async close() { this.state = 'closed'; }
    async resume() { this.state = 'running'; }

    createBuffer(_channels, length) {
      return { getChannelData() { return new Float32Array(length); } };
    }

    createBufferSource() {
      const source = { ...audioNode(), buffer: null };
      this.sources.push(source);
      return source;
    }

    createBiquadFilter() {
      return { ...audioNode(), frequency: audioParam(), Q: audioParam(), type: 'lowpass' };
    }

    createGain() {
      return { ...audioNode(), gain: audioParam() };
    }

    createOscillator() {
      const source = { ...audioNode(), frequency: audioParam(), type: 'sine' };
      this.sources.push(source);
      return source;
    }
  }

  globalObject.AudioContext = FakeAudioContext;
  globalObject.startedAudioSourceCount = () => (
    globalObject.audioContext?.sources.reduce((total, source) => total + source.startCalls.length, 0) || 0
  );
}

function rendererFactorySpy(calls) {
  return (canvas, options) => {
    const record = {
      canvas,
      options,
      presentedEvents: [],
      renderedViews: [],
      resizedViews: []
    };
    calls.push(record);
    return {
      burst() {},
      destroy() {},
      getDiagnostics() { return { enemyRenderMode: options.worldCanvas ? 'loading' : 'disabled' }; },
      getViewport() { return { width: 390, height: 844 }; },
      present(event) { record.presentedEvents.push(event); },
      ...(options.exposeDiagnostics === true ? {
        seedMaximumEffectsForQa() {
          record.maximumEffectSeedCalls = (record.maximumEffectSeedCalls || 0) + 1;
          return true;
        }
      } : {}),
      render(_state, view) {
        record.renderedViews.push(view);
        return { lockedEnemyId: null, visibleEnemyIds: [], threats: [], particleCount: 0 };
      },
      resize(view) { record.resizedViews.push(view); }
    };
  };
}

function audioControllerFactorySpy(calls) {
  return () => ({
    destroy() { calls.destroyed += 1; },
    play(cue) { calls.played.push(cue); },
    setEnabled(enabled) { calls.enabled?.push(enabled); },
    syncThreatBuzz(threats, viewYaw) {
      calls.synced.push({
        threatIds: threats.map(({ id }) => id),
        viewYaw
      });
    },
    unlock() {
      calls.unlocks = (calls.unlocks || 0) + 1;
      return Promise.resolve(true);
    },
    vibrate() {}
  });
}

function wakeLockFactorySpy(calls) {
  return () => ({
    acquire() {
      calls.acquired += 1;
      return Promise.resolve(true);
    },
    release() {
      calls.released += 1;
      return Promise.resolve();
    }
  });
}

test('initializes readiness, persisted sound, and service worker registration', async () => {
  const documentObject = fakeAppDocument();
  const globalObject = fakeAppGlobal();
  const audioCalls = { destroyed: 0, enabled: [], played: [], synced: [] };
  const registrations = [];
  const storageReads = [];
  globalObject.isSecureContext = true;
  globalObject.localStorage = {
    getItem(key) {
      storageReads.push(key);
      return key === 'deadzone-ar.sound-enabled.v1' ? 'false' : null;
    }
  };
  globalObject.navigator = {
    serviceWorker: {
      async register(...args) { registrations.push(args); }
    }
  };

  const app = createApp(documentObject, globalObject, {
    audioControllerFactory: audioControllerFactorySpy(audioCalls),
    rendererFactory: rendererFactorySpy([])
  });

  assert.equal(
    documentObject.getElementById('capabilityStatus').textContent,
    '카메라 미지원 · 센서/터치 훈련 가능'
  );
  assert.deepEqual(audioCalls.enabled, [false]);
  assert.ok(storageReads.includes('deadzone-ar.sound-enabled.v1'));
  assert.equal(documentObject.getElementById('soundButton').getAttribute('aria-pressed'), 'false');
  assert.equal(documentObject.getElementById('soundButton').getAttribute('aria-label'), '음향 켜기');
  assert.deepEqual(registrations, [['/game/sw.js', { scope: '/game/', type: 'module' }]]);
  app.destroy();
});

test('restores and persists the seated-turn preference with an accessible selector', async (t) => {
  const documentObject = fakeAppDocument();
  const globalObject = fakeAppGlobal();
  const writes = [];
  globalObject.localStorage = {
    getItem(key) {
      return key === 'deadzone-ar.aim-mode.v1' ? 'camera' : null;
    },
    setItem(key, value) {
      writes.push([key, value]);
    }
  };
  const originalSetAimMode = ARController.prototype.setAimMode;
  const aimModes = [];
  ARController.prototype.setAimMode = function setAimModeSpy(mode) {
    aimModes.push(mode);
    return originalSetAimMode.call(this, mode);
  };
  const originalGetView = ARController.prototype.getView;
  ARController.prototype.getView = function getViewSpy() {
    return { ...originalGetView.call(this), sensorFresh: true, aimMode: this.getAimMode() };
  };
  t.after(() => {
    ARController.prototype.setAimMode = originalSetAimMode;
    ARController.prototype.getView = originalGetView;
  });

  const app = createApp(documentObject, globalObject, { rendererFactory: rendererFactorySpy([]) });
  const cameraButton = documentObject.getElementById('cameraAimButton');
  const seatedButton = documentObject.getElementById('seatedTurnButton');
  assert.equal(cameraButton.getAttribute('aria-pressed'), 'true');
  assert.equal(seatedButton.getAttribute('aria-pressed'), 'false');
  assert.equal(aimModes[0], 'camera');

  seatedButton.click();
  assert.equal(seatedButton.getAttribute('aria-pressed'), 'true');
  assert.equal(cameraButton.getAttribute('aria-pressed'), 'false');
  assert.equal(aimModes.at(-1), 'seated');
  assert.deepEqual(writes.at(-1), ['deadzone-ar.aim-mode.v1', 'seated']);
  assert.equal(documentObject.getElementById('modeBadge').textContent, 'SEAT TURN');
  app.destroy();
});

test('restores burst, persists rail selection, and exposes pressed state for five weapon chips', () => {
  const documentObject = fakeAppDocument();
  const globalObject = fakeAppGlobal();
  const writes = [];
  globalObject.localStorage = {
    getItem(key) {
      return key === 'deadzone-ar.weapon.v1' ? 'burst' : null;
    },
    setItem(key, value) {
      writes.push([key, value]);
    }
  };

  const app = createApp(documentObject, globalObject, { rendererFactory: rendererFactorySpy([]) });
  assert.equal(documentObject.getElementById('weapon-burst').getAttribute('aria-pressed'), 'true');
  assert.equal(documentObject.getElementById('weapon-sidearm').getAttribute('aria-pressed'), 'false');
  documentObject.getElementById('weapon-rail').click();
  assert.equal(writes.at(-1)?.[0], 'deadzone-ar.weapon.v1');
  assert.equal(writes.at(-1)?.[1], 'rail');
  assert.equal(documentObject.getElementById('weapon-rail').getAttribute('aria-pressed'), 'true');
  assert.equal(app.getState().selectedWeapon, 'rail');
  app.destroy();
});

test('turn controls use a precise short tap and continuous hold input', (t) => {
  const documentObject = fakeAppDocument();
  const globalObject = fakeAppGlobal();
  const inputs = [];
  const nudges = [];
  let now = 100;
  globalObject.performance.now = () => now;
  const originalSetTurnInput = ARController.prototype.setTurnInput;
  const originalNudgeTurn = ARController.prototype.nudgeTurn;
  ARController.prototype.setTurnInput = function setTurnInputSpy(direction) {
    inputs.push(direction);
    return originalSetTurnInput.call(this, direction);
  };
  ARController.prototype.nudgeTurn = function nudgeTurnSpy(direction, degrees) {
    nudges.push([direction, degrees]);
    return originalNudgeTurn.call(this, direction, degrees);
  };
  t.after(() => {
    ARController.prototype.setTurnInput = originalSetTurnInput;
    ARController.prototype.nudgeTurn = originalNudgeTurn;
  });

  const app = createApp(documentObject, globalObject, { rendererFactory: rendererFactorySpy([]) });
  const right = documentObject.getElementById('turnRightButton');
  const left = documentObject.getElementById('turnLeftButton');
  right.listeners.get('pointerdown')({ pointerId: 7, preventDefault() {} });
  assert.equal(inputs.at(-1), 1);
  now = 180;
  right.listeners.get('pointerup')({ pointerId: 7 });
  assert.equal(inputs.at(-1), 0);
  assert.deepEqual(nudges, [[1, 7]]);

  right.listeners.get('pointerdown')({ pointerId: 9, preventDefault() {} });
  now = 500;
  right.listeners.get('pointerup')({ pointerId: 9 });
  assert.deepEqual(nudges, [[1, 7]]);

  left.listeners.get('pointerdown')({ pointerId: 8, preventDefault() {} });
  left.listeners.get('pointercancel')({ pointerId: 8 });
  assert.equal(inputs.at(-1), 0);
  app.destroy();
});

test('acquires and releases wake lock exactly once for each mission lifecycle transition', async () => {
  const documentObject = fakeAppDocument();
  const globalObject = fakeAppGlobal();
  const wakeCalls = { acquired: 0, released: 0 };
  const app = createApp(documentObject, globalObject, {
    rendererFactory: rendererFactorySpy([]),
    wakeLockFactory: wakeLockFactorySpy(wakeCalls)
  });

  await app.startTraining();
  globalObject.runAllTimers();
  assert.deepEqual(wakeCalls, { acquired: 1, released: 0 });

  assert.equal(app.pause(), true);
  assert.equal(app.pause(), false);
  assert.deepEqual(wakeCalls, { acquired: 1, released: 1 });
  assert.equal(app.resume(), true);
  assert.equal(app.resume(), false);
  assert.deepEqual(wakeCalls, { acquired: 2, released: 1 });

  documentObject.hidden = true;
  documentObject.dispatch('visibilitychange');
  documentObject.dispatch('visibilitychange');
  assert.equal(app.getState().phase, 'paused');
  assert.deepEqual(wakeCalls, { acquired: 2, released: 2 });
  documentObject.hidden = false;
  assert.equal(app.resume(), true);

  assert.equal(globalObject.__DEADZONE__.finish(), true);
  assert.equal(globalObject.__DEADZONE__.finish(), false);
  assert.deepEqual(wakeCalls, { acquired: 3, released: 3 });
  app.destroy();
  app.destroy();
  assert.deepEqual(wakeCalls, { acquired: 3, released: 4 });
});

test('shares the visible mission result and reports shared and copied outcomes', async () => {
  const sharedPayloads = [];
  const sharedDocument = fakeAppDocument();
  const sharedGlobal = fakeAppGlobal();
  sharedGlobal.location.href = 'https://deadzone.example/game/index.html?seed=7';
  sharedGlobal.navigator = { async share(payload) { sharedPayloads.push(payload); } };
  const sharedApp = createApp(sharedDocument, sharedGlobal, { rendererFactory: rendererFactorySpy([]) });
  await sharedApp.startTraining();
  sharedGlobal.runAllTimers();
  assert.equal(sharedGlobal.__DEADZONE__.finish(), true);

  await sharedDocument.getElementById('shareResultButton').click();
  assert.deepEqual(sharedPayloads, [{
    title: 'Deadzone AR 임무 결과',
    text: `${sharedDocument.getElementById('resultGrade').textContent}등급 · ${sharedDocument.getElementById('resultScore').textContent}점 · 처치 ${sharedDocument.getElementById('resultKills').textContent} · 명중률 ${sharedDocument.getElementById('resultAccuracy').textContent} · 최고 콤보 ${sharedDocument.getElementById('resultCombo').textContent}`,
    url: 'https://deadzone.example/game/index.html'
  }]);
  assert.equal(sharedDocument.getElementById('permissionToast').textContent, '결과를 공유했습니다');
  sharedApp.destroy();

  const copied = [];
  const copiedDocument = fakeAppDocument();
  const copiedGlobal = fakeAppGlobal();
  copiedGlobal.location.href = 'https://deadzone.example/game/index.html';
  copiedGlobal.navigator = {
    async share() { throw new Error('fixture share failure'); },
    clipboard: { async writeText(text) { copied.push(text); } }
  };
  const copiedApp = createApp(copiedDocument, copiedGlobal, { rendererFactory: rendererFactorySpy([]) });
  await copiedApp.startTraining();
  copiedGlobal.runAllTimers();
  copiedGlobal.__DEADZONE__.finish();
  await copiedDocument.getElementById('shareResultButton').click();
  assert.deepEqual(copied, [`${sharedPayloads[0].text}\n${sharedPayloads[0].url}`]);
  assert.equal(copiedDocument.getElementById('permissionToast').textContent, '결과를 복사했습니다');
  copiedApp.destroy();
});

test('retry reconnects access while paused and refreshes the calibrated camera view', async (t) => {
  const documentObject = fakeAppDocument();
  const globalObject = fakeAppGlobal({ syntheticCamera: true });
  const rendererCalls = [];
  let cameraRequests = 0;
  let calibrations = 0;
  const originalCalibrate = ARController.prototype.calibrate;
  ARController.prototype.calibrate = function calibrateSpy() {
    calibrations += 1;
    return originalCalibrate.call(this);
  };
  t.after(() => { ARController.prototype.calibrate = originalCalibrate; });
  globalObject.navigator.mediaDevices.getUserMedia = async () => {
    cameraRequests += 1;
    return { getTracks() { return []; } };
  };
  const app = createApp(documentObject, globalObject, {
    rendererFactory: rendererFactorySpy(rendererCalls)
  });
  await app.startTraining();
  globalObject.runAllTimers();
  assert.equal(app.pause(), true);
  calibrations = 0;
  const resizeCount = rendererCalls[0].resizedViews.length;

  const retry = documentObject.getElementById('retryAccessButton');
  await retry.click();

  assert.equal(app.getState().phase, 'paused');
  assert.equal(cameraRequests, 1);
  assert.equal(documentObject.getElementById('gameApp').dataset.camera, 'true');
  assert.equal(rendererCalls[0].resizedViews.length, resizeCount + 1);
  assert.equal(rendererCalls[0].resizedViews.at(-1).cameraActive, true);
  assert.equal(calibrations, 1);
  assert.equal(retry.disabled, false);
  app.destroy();
});

test('retry re-enables its control when access rejects', async () => {
  const documentObject = fakeAppDocument();
  const globalObject = fakeAppGlobal();
  const app = createApp(documentObject, globalObject, { rendererFactory: rendererFactorySpy([]) });
  await app.startTraining();
  globalObject.runAllTimers();
  app.pause();
  let accessReads = 0;
  globalObject.navigator = {
    mediaDevices: {
      async getUserMedia() {
        accessReads += 1;
        throw new Error('fixture access rejection');
      }
    }
  };

  const retry = documentObject.getElementById('retryAccessButton');
  await retry.click();
  assert.equal(accessReads, 1);
  assert.equal(app.getState().phase, 'paused');
  assert.equal(retry.disabled, false);
  app.destroy();
});

test('retry contains a throwing sensor getter while paused', async () => {
  const documentObject = fakeAppDocument();
  const globalObject = fakeAppGlobal();
  const app = createApp(documentObject, globalObject, { rendererFactory: rendererFactorySpy([]) });
  await app.startTraining();
  globalObject.runAllTimers();
  assert.equal(app.pause(), true);
  let sensorReads = 0;
  Object.defineProperty(globalObject, 'DeviceOrientationEvent', {
    configurable: true,
    get() {
      sensorReads += 1;
      throw new Error('fixture sensor getter rejection');
    }
  });

  const retry = documentObject.getElementById('retryAccessButton');
  try {
    await assert.doesNotReject(() => retry.click());
    assert.equal(sensorReads, 1);
    assert.equal(app.getState().phase, 'paused');
    assert.equal(documentObject.getElementById('gameApp').dataset.camera, 'false');
    assert.equal(retry.disabled, false);
  } finally {
    app.destroy();
  }
});

test('places a decorative 3D world canvas directly under the AR HUD canvas', async () => {
  const { html, styles } = await gameFiles();

  assert.match(
    html,
    /<canvas id="worldCanvas" class="world-canvas"[^>]*aria-hidden="true"[^>]*><\/canvas>\s*<canvas id="arCanvas" class="ar-canvas"/
  );
  assert.match(styles, /\.world-canvas\s*\{[^}]*z-index:\s*1;[^}]*pointer-events:\s*none;[^}]*\}/s);
  assert.match(styles, /\.ar-canvas\s*\{[^}]*z-index:\s*2;/s);
});

test('removes expensive compositor effects only during active-camera gameplay', async () => {
  const { styles } = await gameFiles();
  const activeCameraGame = String.raw`\.game-app\[data-camera="true"\]\[data-phase="game"\]`;

  assert.match(
    styles,
    new RegExp(`${activeCameraGame} \\.camera-feed\\s*\\{[^}]*filter:\\s*none;[^}]*transform:\\s*none;[^}]*\\}`, 's')
  );
  assert.match(
    styles,
    new RegExp(`${activeCameraGame} \\.scene-noise\\s*\\{[^}]*mix-blend-mode:\\s*normal;[^}]*\\}`, 's')
  );
  for (const panel of ['hud-icon-button', 'hud-block', 'shield-card', 'mode-badge', 'ammo-panel', 'reload-button']) {
    assert.match(
      styles,
      new RegExp(`${activeCameraGame} \\.${panel}[^}]*\\{[^}]*backdrop-filter:\\s*none;[^}]*\\}`, 's'),
      `active-camera gameplay disables backdrop filtering on .${panel}`
    );
  }
});

test('looks up the optional world canvas and hands it to the local renderer', async () => {
  const { app, renderer } = await gameFiles();

  assert.match(app, /worldCanvas:\s*element\('worldCanvas'\)/);
  assert.match(app, /if \(!elements\.app \|\| !elements\.canvas \|\| !elements\.video\) return null;/);
  assert.match(app, /rendererFactory\s*=\s*createRenderer/);
  assert.match(app, /rendererFactory\(elements\.canvas,\s*\{\s*globalObject,\s*worldCanvas:\s*elements\.worldCanvas\s*\}\)/s);
  assert.match(renderer, /import\('\.\/three-world-layer\.mjs'\)/);
});

test('createApp behavior preserves an absent world canvas and hands an available canvas to the renderer', () => {
  const absentCalls = [];
  const absentGlobal = fakeAppGlobal();
  const absentApp = createApp(fakeAppDocument(), absentGlobal, {
    rendererFactory: rendererFactorySpy(absentCalls)
  });

  assert.equal(absentCalls.length, 1);
  assert.equal(absentCalls[0].options.worldCanvas, null);
  assert.deepEqual(absentGlobal.__DEADZONE__.getRendererDiagnostics(), { enemyRenderMode: 'disabled' });
  absentApp.destroy();

  const worldCanvas = fakeElement('worldCanvas');
  const availableCalls = [];
  const availableGlobal = fakeAppGlobal();
  const availableApp = createApp(fakeAppDocument({ worldCanvas }), availableGlobal, {
    rendererFactory: rendererFactorySpy(availableCalls)
  });

  assert.equal(availableCalls.length, 1);
  assert.equal(availableCalls[0].options.worldCanvas, worldCanvas);
  assert.deepEqual(availableGlobal.__DEADZONE__.getRendererDiagnostics(), { enemyRenderMode: 'loading' });
  availableApp.destroy();
});

test('passes the explicit diagnostics flag and hides QA effect seeding from ordinary app construction', () => {
  const ordinaryCalls = [];
  const ordinaryGlobal = fakeAppGlobal();
  const ordinaryApp = createApp(fakeAppDocument(), ordinaryGlobal, {
    rendererFactory: rendererFactorySpy(ordinaryCalls)
  });

  assert.equal(ordinaryCalls[0].options.exposeDiagnostics, undefined);
  assert.equal('seedEffectsForQa' in ordinaryGlobal.__DEADZONE__, false);
  assert.equal('seedMaximumWorldForQa' in ordinaryGlobal.__DEADZONE__, false);
  ordinaryApp.destroy();

  const diagnosticCalls = [];
  const diagnosticGlobal = fakeAppGlobal();
  const diagnosticApp = createApp(fakeAppDocument(), diagnosticGlobal, {
    exposeDiagnostics: true,
    rendererFactory: rendererFactorySpy(diagnosticCalls)
  });

  assert.equal(diagnosticCalls[0].options.exposeDiagnostics, true);
  assert.equal(typeof diagnosticGlobal.__DEADZONE__.seedEffectsForQa, 'function');
  assert.equal(typeof diagnosticGlobal.__DEADZONE__.seedMaximumWorldForQa, 'function');
  const rendersBeforeEffects = diagnosticCalls[0].renderedViews.length;
  assert.equal(diagnosticGlobal.__DEADZONE__.seedEffectsForQa(), true);
  assert.equal(diagnosticCalls[0].maximumEffectSeedCalls, 1);
  assert.equal(diagnosticCalls[0].renderedViews.length, rendersBeforeEffects + 1);
  assert.equal(diagnosticGlobal.__DEADZONE__.seedMaximumWorldForQa(), true);
  assert.equal(diagnosticGlobal.__DEADZONE__.getState().enemies.length, 6);
  assert.equal(diagnosticGlobal.__DEADZONE__.getState().corpses.length, 4);
  diagnosticApp.destroy();
});

test('immediately handled shot and spawned-enemy audio are not replayed on the next frame', async () => {
  const documentObject = fakeAppDocument();
  const globalObject = fakeAppGlobal();
  installFakeAudioContext(globalObject);
  const app = createApp(documentObject, globalObject, {
    rendererFactory: rendererFactorySpy([])
  });

  await app.startTraining();
  globalObject.runAllTimers();
  assert.equal(app.getState().phase, 'playing');

  assert.equal(globalObject.runNextFrame(100), true);
  const beforeShot = globalObject.startedAudioSourceCount();
  assert.equal(app.shoot(), true);
  const afterImmediateShot = globalObject.startedAudioSourceCount();
  assert.ok(afterImmediateShot > beforeShot, 'the immediate handler dispatches the shot cue');

  assert.equal(globalObject.runNextFrame(150), true);
  assert.equal(globalObject.startedAudioSourceCount(), afterImmediateShot);

  let timestamp = 150;
  let remainingFrames = 12;
  while (app.getState().enemies.length === 0 && remainingFrames > 0) {
    timestamp += 50;
    assert.equal(globalObject.runNextFrame(timestamp), true);
    remainingFrames -= 1;
  }
  assert.ok(app.getState().enemies.length > 0, 'a frame emits the first spawn event');
  const afterSpawnFrame = globalObject.startedAudioSourceCount();
  assert.ok(afterSpawnFrame > afterImmediateShot);

  assert.equal(globalObject.runNextFrame(timestamp + 50), true);
  assert.equal(globalObject.startedAudioSourceCount(), afterSpawnFrame);
  app.destroy();
});

test('the existing event cursor presents one casing and one corpse snapshot without replay', async () => {
  const calls = [];
  const documentObject = fakeAppDocument();
  const globalObject = fakeAppGlobal();
  const app = createApp(documentObject, globalObject, {
    rendererFactory: rendererFactorySpy(calls)
  });

  await app.startTraining();
  globalObject.runAllTimers();
  assert.equal(globalObject.runNextFrame(100), true);
  app.selectWeapon('sidearm');

  let timestamp = 100;
  let remainingFrames = 12;
  while (app.getState().enemies.length === 0 && remainingFrames > 0) {
    timestamp += 50;
    assert.equal(globalObject.runNextFrame(timestamp), true);
    remainingFrames -= 1;
  }
  const target = app.getState().enemies[0];
  assert.ok(target, 'controlled frames spawn an insect target');
  globalObject.__DEADZONE__.setView(target.yaw, target.pitch);

  assert.equal(app.shoot(), true);
  assert.equal(app.getState().corpses.length, 1, 'the critical shot records one corpse');
  assert.equal(globalObject.runNextFrame(timestamp + 50), true);

  const presented = calls[0].presentedEvents;
  const shotEvents = presented.filter(({ type }) => type === 'shoot');
  const killEvents = presented.filter(({ type }) => type === 'kill');
  assert.equal(shotEvents.length, 1, 'one accepted shot can create only one casing');
  assert.equal(killEvents.length, 1);
  assert.equal(killEvents[0].corpseId, app.getState().corpses[0].id);
  assert.equal(killEvents[0].corpse.age, 0, 'the kill event retains the creation-time corpse snapshot');
  assert.equal(new Set(presented.map(({ id }) => id)).size, presented.length);
  app.destroy();
});

test('two consecutive missions accept repeated event ids once with no old renderer effects', async () => {
  const documentObject = fakeAppDocument();
  installCanvasContext(documentObject.getElementById('arCanvas'));
  const globalObject = fakeAppGlobal();
  let renderer;
  const app = createApp(documentObject, globalObject, {
    exposeDiagnostics: true,
    rendererFactory(canvas, options) {
      renderer = createRenderer(canvas, options);
      return renderer;
    }
  });

  await app.startTraining();
  globalObject.runAllTimers();
  assert.equal(globalObject.runNextFrame(100), true);
  app.selectWeapon('sidearm');
  assert.equal(app.shoot(), true);
  renderer.burst('critical-hit', { x: 195, y: 422 });
  assert.equal(globalObject.runNextFrame(116), true);
  const firstMission = renderer.getDiagnostics().frame;
  assert.deepEqual(firstMission.effects.casings.map(({ id }) => id), [2]);

  assert.equal(globalObject.__DEADZONE__.finish('survived'), true);
  documentObject.getElementById('replayButton').click();
  globalObject.runAllTimers();
  assert.equal(renderer.getDiagnostics().frame, null, 'mission reset retires the prior visual snapshot');
  assert.equal(renderer.render(app.getState(), {}, 200).particleCount, 0, 'Canvas burst particles do not survive replay');

  assert.equal(globalObject.runNextFrame(201), true);
  assert.equal(app.shoot(), true);
  assert.equal(globalObject.runNextFrame(216), true);
  const secondMission = renderer.getDiagnostics().frame;
  assert.deepEqual(secondMission.effects.casings.map(({ id }) => id), [2]);
  assert.equal(secondMission.effects.impacts.length, 1);
  assert.equal(renderer.render(app.getState(), {}, 216).particleCount, 6, 'only the new mission muzzle burst remains');
  app.destroy();
});

test('mission start explicitly resizes with the current camera-active AR view', async () => {
  const calls = [];
  const documentObject = fakeAppDocument();
  const globalObject = fakeAppGlobal({ syntheticCamera: true });
  const app = createApp(documentObject, globalObject, {
    rendererFactory: rendererFactorySpy(calls)
  });

  await documentObject.getElementById('startButton').click();
  globalObject.runAllTimers();

  assert.equal(documentObject.getElementById('gameApp').dataset.camera, 'true');
  assert.equal(documentObject.getElementById('gameApp').dataset.phase, 'game');
  assert.equal(calls[0].resizedViews.length, 1);
  assert.equal(calls[0].resizedViews[0]?.cameraActive, true);
  assert.equal(calls[0].resizedViews[0]?.mode, 'touch');
  app.destroy();
});

test('synchronizes current-view threat buzz once per frame and clears it outside play', async () => {
  const documentObject = fakeAppDocument();
  const globalObject = fakeAppGlobal();
  const audioCalls = { destroyed: 0, played: [], synced: [] };
  const app = createApp(documentObject, globalObject, {
    audioControllerFactory: audioControllerFactorySpy(audioCalls),
    rendererFactory: rendererFactorySpy([])
  });

  await app.startTraining();
  globalObject.runAllTimers();
  audioCalls.synced.length = 0;

  let timestamp = 100;
  let remainingFrames = 12;
  while (app.getState().enemies.length === 0 && remainingFrames > 0) {
    assert.equal(globalObject.runNextFrame(timestamp), true);
    timestamp += 50;
    remainingFrames -= 1;
  }
  const target = app.getState().enemies[0];
  assert.ok(target);
  globalObject.__DEADZONE__.setView(target.yaw, target.pitch);
  audioCalls.synced.length = 0;

  assert.equal(globalObject.runNextFrame(timestamp), true);
  assert.deepEqual(audioCalls.synced, [{
    threatIds: app.getState().enemies.map(({ id }) => id),
    viewYaw: target.yaw
  }]);

  audioCalls.synced.length = 0;
  assert.equal(app.pause(), true);
  assert.deepEqual(audioCalls.synced, [{ threatIds: [], viewYaw: 0 }]);
  assert.equal(globalObject.runNextFrame(timestamp + 50), true);
  assert.deepEqual(audioCalls.synced.at(-1), { threatIds: [], viewYaw: 0 });

  app.destroy();
  assert.equal(audioCalls.destroyed, 1);
});

test('shows keyboard-accessible licensed model attribution in pause and result UI', async () => {
  const { html, styles } = await gameFiles();

  const modelLinks = [
    'https://sketchfab.com/3d-models/real-time-refraction-demo-mosquito-in-amber-37233d6ed84844fea1ebe88069ea58d1',
    'https://poly.pizza/m/GcttdvsqsQ',
    'https://poly.pizza/m/3tCnJC9UYA',
    'https://poly.pizza/m/6HsU6GQt3a'
  ];
  for (const href of modelLinks) assert.equal(html.split(href).length - 1, 2);
  assert.equal((html.match(/CC BY 4\.0/g) || []).length, 2);
  assert.equal((html.match(/CC0 1\.0 Universal/g) || []).length, 2);
  assert.equal((html.match(/target="_blank" rel="noopener noreferrer"/g) || []).length, 12);
  assert.match(html, /<section id="pauseScreen"[\s\S]*<p class="model-credit">[\s\S]*<\/section>/);
  assert.match(html, /<section id="resultScreen"[\s\S]*<p class="model-credit">[\s\S]*<\/section>/);
  assert.match(styles, /\.pause-card\s*>\s*p:not\(\.eyebrow\):not\(\.model-credit\)/);
  assert.match(styles, /\.model-credit\s*\{[^}]*font:\s*600\s+1[0-2]px\//s);
  assert.match(styles, /\.model-credit\s*\{[^}]*overflow-wrap:\s*anywhere;/s);
  assert.match(styles, /\.model-credit a:focus-visible\s*\{/);
});
