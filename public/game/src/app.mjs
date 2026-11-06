import { ARController } from './ar-controller.mjs';
import { AudioController } from './audio-controller.mjs';
import {
  WakeLockController,
  capabilityMessage,
  missionSharePayload,
  readSoundPreference,
  registerGameServiceWorker,
  shareMissionResult,
  writeSoundPreference
} from './device-services.mjs';
import {
  PHASES,
  createInitialState,
  fireWeapon,
  missionGrade,
  requestReload,
  startMission,
  selectWeapon as selectWeaponState,
  togglePause,
  updateGame
} from './game-core.mjs';
import { createRenderer } from './renderer.mjs';
import {
  DEFAULT_WEAPON_ID,
  WEAPON_IDS,
  normalizeWeaponId,
  weaponProfile
} from './weapon-profile.mjs';

const BEST_SCORE_KEY = 'deadzone-ar.best-score.v1';
const AIM_MODE_KEY = 'deadzone-ar.aim-mode.v1';
const WEAPON_KEY = 'deadzone-ar.weapon.v1';
const TURN_TAP_MS = 140;
const TURN_TAP_DEGREES = 7;

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function formatTime(seconds) {
  const total = Math.max(0, Math.ceil(finiteNumber(seconds)));
  const minutes = Math.floor(total / 60);
  const remainder = total % 60;
  return `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
}

export function accuracy(stats = {}) {
  const shots = Math.max(0, finiteNumber(stats.shots));
  if (shots === 0) return 0;
  const hits = clamp(finiteNumber(stats.hits), 0, shots);
  return Math.round((hits / shots) * 100);
}

export function permissionMessage(result = {}) {
  if (result.camera && result.sensor) return '후면 카메라와 센서 조준이 연결됐습니다';
  if (!result.camera && result.sensor) return '카메라 없이 센서 조준으로 시작합니다';
  if (result.camera && !result.sensor) return '센서 없이 화면 드래그 조준으로 시작합니다';
  return '터치 훈련 모드로 시작합니다';
}

export function eventPresentation(event = {}) {
  const weaponId = normalizeWeaponId(event.weaponId);
  switch (event.type) {
    case 'mission-start':
      return { text: 'WAVE 01', kind: 'success', audio: 'wave', vibration: 'wave' };
    case 'spawn':
      return { text: '', kind: 'info', audio: 'spawn' };
    case 'shoot':
      if (weaponId === 'rail') {
        return { text: '', kind: 'info', audio: 'rail', vibration: 'shoot', burst: 'rail' };
      }
      return { text: '', kind: 'info', audio: 'shoot', vibration: 'shoot', burst: 'muzzle' };
    case 'miss':
      return { text: 'MISS', kind: 'info', audio: 'miss' };
    case 'hit':
      return { text: 'HIT', kind: 'success', audio: 'hit', vibration: 'hit', burst: 'hit' };
    case 'critical-hit':
      return { text: 'CRITICAL', kind: 'success', audio: 'critical-hit', vibration: 'critical-hit', burst: 'critical-hit' };
    case 'freeze':
      return { text: 'FROZEN', kind: 'info', audio: 'cryo', vibration: 'hit', burst: 'freeze' };
    case 'kill':
      return { text: `+${finiteNumber(event.award)}  ×${finiteNumber(event.combo, 1)}`, kind: 'success', audio: 'kill', vibration: 'kill' };
    case 'reload-start':
      return { text: 'RELOADING', kind: 'warning', audio: 'reload', vibration: 'reload' };
    case 'reload-complete':
      return { text: 'WEAPON READY', kind: 'success' };
    case 'empty':
      return { text: 'EMPTY', kind: 'warning', audio: 'empty', vibration: 'empty' };
    case 'player-hit':
      return { text: `방어막 -${finiteNumber(event.damage)}`, kind: 'danger', audio: 'player-hit', vibration: 'player-hit', burst: 'player-hit' };
    case 'wave':
      return { text: `WAVE 0${finiteNumber(event.wave)}`, kind: 'warning', audio: 'wave', vibration: 'wave' };
    case 'elite-spawn':
      return { text: 'QUEEN SIGNAL', kind: 'danger', audio: 'elite-spawn', vibration: 'wave' };
    case 'mission-end':
      return { text: '', kind: 'info', audio: 'mission-end', vibration: 'mission-end' };
    default:
      return null;
  }
}

export function resultSummary(state = {}) {
  const grade = missionGrade(state);
  const survived = state.resultReason === 'survived';
  if (survived) {
    return {
      grade,
      title: '감염 군체 제거 완료',
      description: grade === 'S'
        ? '완벽에 가까운 제거 기록입니다. 감염 군체 신호가 모두 잠잠해졌습니다.'
        : '생존했습니다. 다음 투입에서는 더 긴 제거 연쇄를 노려보세요.'
    };
  }
  return {
    grade,
    title: '방어선 붕괴',
    description: '감염 군체가 방어선을 넘었습니다. 조준을 재정비하고 다시 투입하세요.'
  };
}

export function parseGameOptions(search = '') {
  const params = new URLSearchParams(String(search || ''));
  const durationValue = Number(params.get('duration'));
  const duration = params.has('duration') && Number.isFinite(durationValue)
    ? clamp(durationValue, 8, 90)
    : 90;
  const seedValue = Number(params.get('seed'));
  const seed = params.has('seed') && Number.isFinite(seedValue) ? seedValue >>> 0 : null;
  const trainingValue = params.get('training');
  return {
    training: trainingValue === '1' || trainingValue === 'true',
    duration,
    seed
  };
}

export function isLocalHostname(hostname) {
  const normalized = String(hostname || '').toLowerCase();
  return normalized === 'localhost'
    || normalized === '127.0.0.1'
    || normalized === '::1'
    || normalized === '[::1]';
}

export function shouldExposeDiagnostics(globalObject = globalThis) {
  if (!isLocalHostname(globalObject?.location?.hostname)) return false;
  try {
    return new URLSearchParams(globalObject?.location?.search || '').get('diagnostics') === '1';
  } catch {
    return false;
  }
}

function safeStorage(globalObject) {
  try {
    return globalObject?.localStorage || null;
  } catch (_error) {
    return null;
  }
}

function readAimMode(storage) {
  try {
    return storage?.getItem?.(AIM_MODE_KEY) === 'camera' ? 'camera' : 'seated';
  } catch (_error) {
    return 'seated';
  }
}

function writeAimMode(storage, mode) {
  try {
    storage?.setItem?.(AIM_MODE_KEY, mode === 'camera' ? 'camera' : 'seated');
  } catch (_error) {
    // A blocked storage policy does not affect the mission.
  }
}

function readWeaponPreference(storage) {
  try {
    const value = storage?.getItem?.(WEAPON_KEY);
    return typeof value === 'string' && WEAPON_IDS.includes(value)
      ? value
      : DEFAULT_WEAPON_ID;
  } catch (_error) {
    return DEFAULT_WEAPON_ID;
  }
}

function writeWeaponPreference(storage, weaponId) {
  try {
    storage?.setItem?.(WEAPON_KEY, normalizeWeaponId(weaponId));
  } catch (_error) {
    // A blocked storage policy does not affect the mission.
  }
}

function fallbackRenderer(canvas) {
  const width = finiteNumber(canvas?.clientWidth, 390);
  const height = finiteNumber(canvas?.clientHeight, 844);
  return {
    resize() {},
    render() { return { lockedEnemyId: null, visibleEnemyIds: [], threats: [], particleCount: 0 }; },
    resetMission() {},
    present() {},
    burst() {},
    destroy() {},
    getViewport() { return { width, height }; }
  };
}

export function createApp(documentObject, globalObject = globalThis, {
  audioControllerFactory = (options) => new AudioController(options),
  exposeDiagnostics = false,
  rendererFactory = createRenderer,
  wakeLockFactory = (options) => new WakeLockController(options)
} = {}) {
  if (!documentObject?.getElementById) return null;

  const element = (id) => documentObject.getElementById(id);
  const elements = {
    app: element('gameApp'),
    capabilityStatus: element('capabilityStatus'),
    video: element('cameraFeed'),
    canvas: element('arCanvas'),
    worldCanvas: element('worldCanvas'),
    intro: element('introScreen'),
    calibration: element('calibrationScreen'),
    gameHud: element('gameHud'),
    pause: element('pauseScreen'),
    result: element('resultScreen'),
    start: element('startButton'),
    training: element('trainingButton'),
    cameraAim: element('cameraAimButton'),
    seatedTurn: element('seatedTurnButton'),
    pauseButton: element('pauseButton'),
    resume: element('resumeButton'),
    recalibrate: element('recalibrateButton'),
    retryAccess: element('retryAccessButton'),
    resultRecalibrate: element('resultRecalibrateButton'),
    turnLeft: element('turnLeftButton'),
    turnRight: element('turnRightButton'),
    reload: element('reloadButton'),
    fire: element('fireButton'),
    replay: element('replayButton'),
    shareResult: element('shareResultButton'),
    sound: element('soundButton'),
    calibrationCount: element('calibrationCount'),
    time: element('timeValue'),
    score: element('scoreValue'),
    wave: element('waveValue'),
    shield: element('shieldValue'),
    shieldFill: element('shieldFill'),
    ammo: element('ammoValue'),
    ammoMax: element('ammoMaxValue'),
    bullets: element('bulletRack'),
    weaponDeck: element('weaponDeck'),
    weaponName: element('weaponName'),
    weaponSubtitle: element('weaponSubtitle'),
    weaponButtons: Object.fromEntries(WEAPON_IDS.map((id) => [id, element(`weapon-${id}`)])),
    hudWeaponButtons: Object.fromEntries(WEAPON_IDS.map((id) => [id, element(`hud-weapon-${id}`)])),
    feedback: element('feedbackText'),
    mode: element('modeBadge'),
    comboPanel: element('comboPanel'),
    combo: element('comboValue'),
    lock: element('lockLabel'),
    permissionToast: element('permissionToast'),
    resultGrade: element('resultGrade'),
    resultTitle: element('resultTitle'),
    resultDescription: element('resultDescription'),
    resultScore: element('resultScore'),
    resultKills: element('resultKills'),
    resultAccuracy: element('resultAccuracy'),
    resultCriticalHits: element('resultCriticalHits'),
    resultCombo: element('resultCombo'),
    bestScore: element('bestScore')
  };

  if (!elements.app || !elements.canvas || !elements.video) return null;

  const options = parseGameOptions(globalObject?.location?.search);
  const storage = safeStorage(globalObject);
  const initialWeapon = readWeaponPreference(storage);
  const arController = new ARController({ globalObject, onStatus(access) {
    if (destroyed) return;
    elements.app.dataset.camera = String(access.camera);
    updateMode(arController.getView());
    redrawInactive();
  } });
  arController.setAimMode(readAimMode(storage));
  const audioController = audioControllerFactory({ globalObject });
  const wakeLock = wakeLockFactory({ globalObject });
  let renderer;
  try {
    renderer = exposeDiagnostics === true
      ? rendererFactory(elements.canvas, {
        exposeDiagnostics: true,
        globalObject,
        worldCanvas: elements.worldCanvas
      })
      : rendererFactory(elements.canvas, { globalObject, worldCanvas: elements.worldCanvas });
  } catch (_error) {
    renderer = fallbackRenderer(elements.canvas);
  }

  const setTimer = globalObject?.setTimeout?.bind(globalObject) || setTimeout;
  const clearTimer = globalObject?.clearTimeout?.bind(globalObject) || clearTimeout;
  const requestFrame = globalObject?.requestAnimationFrame?.bind(globalObject)
    || ((callback) => setTimer(() => callback(Date.now()), 16));
  const cancelFrame = globalObject?.cancelAnimationFrame?.bind(globalObject) || clearTimer;
  const listeners = [];
  const turnCancels = [];
  const countdownTimers = new Set();
  let feedbackTimer = null;
  let toastTimer = null;
  let hitTimer = null;
  let frameId = null;
  let lastFrameTime = 0;
  let lastHandledEventId = 0;
  let renderInfo = { lockedEnemyId: null, visibleEnemyIds: [], threats: [], particleCount: 0 };
  let state = createInitialState({
    seed: options.seed ?? Date.now(),
    duration: options.duration,
    selectedWeapon: initialWeapon
  });
  let missionNumber = 0;
  let soundEnabled = readSoundPreference(storage);
  let destroyed = false;
  let launchGeneration = 0;
  let activeTurnOwner = null;
  let qaHandle = null;

  const acquireWakeLock = () => { void wakeLock.acquire(); };
  const releaseWakeLock = () => { void wakeLock.release(); };

  function listen(target, type, handler, listenerOptions) {
    if (!target?.addEventListener) return;
    target.addEventListener(type, handler, listenerOptions);
    listeners.push(() => target.removeEventListener?.(type, handler, listenerOptions));
  }

  function setScreen(name) {
    elements.intro.hidden = name !== 'intro';
    elements.calibration.hidden = name !== 'calibration';
    elements.gameHud.hidden = name !== 'game' && name !== 'pause';
    elements.pause.hidden = name !== 'pause';
    elements.result.hidden = name !== 'result';
    elements.app.dataset.phase = name;
    elements.gameHud.inert = name !== 'game';
    arController.setTouchEnabled(name === 'game');
    arController.setSensorPaused(name === 'pause');
    if (name !== 'game') resetTurnControls();
    if (name === 'pause') elements.resume.focus?.({ preventScroll: true });
    if (name === 'game') elements.pauseButton.focus?.({ preventScroll: true });
    if (name === 'result') elements.replay.focus?.({ preventScroll: true });
  }

  function clearCountdown() {
    for (const timer of countdownTimers) clearTimer(timer);
    countdownTimers.clear();
  }

  function scheduleCountdown(callback, delay) {
    const timer = setTimer(() => {
      countdownTimers.delete(timer);
      callback();
    }, delay);
    countdownTimers.add(timer);
  }

  function showToast(text, duration = 2100) {
    if (!elements.permissionToast || !text) return;
    if (toastTimer !== null) clearTimer(toastTimer);
    elements.permissionToast.textContent = text;
    elements.permissionToast.hidden = false;
    toastTimer = setTimer(() => {
      elements.permissionToast.hidden = true;
      toastTimer = null;
    }, duration);
  }

  function showFeedback(text, kind = 'info') {
    if (!elements.feedback || !text) return;
    if (feedbackTimer !== null) clearTimer(feedbackTimer);
    elements.feedback.textContent = text;
    elements.feedback.className = `combat-feedback ${kind}`;
    void elements.feedback.offsetWidth;
    elements.feedback.classList.add('visible');
    feedbackTimer = setTimer(() => {
      elements.feedback.classList.remove('visible');
      feedbackTimer = null;
    }, 900);
  }

  function pulseHitScreen() {
    if (hitTimer !== null) clearTimer(hitTimer);
    elements.app.classList.remove('screen-hit');
    void elements.app.offsetWidth;
    elements.app.classList.add('screen-hit');
    hitTimer = setTimer(() => {
      elements.app.classList.remove('screen-hit');
      hitTimer = null;
    }, 300);
  }

  function updateMode(view) {
    if (!elements.mode) return;
    const sensorActive = view.sensorFresh;
    elements.mode.classList.toggle('touch', !sensorActive);
    const label = sensorActive
      ? view.aimMode === 'seated'
        ? 'SEAT TURN'
        : view.cameraActive ? 'AR SENSOR' : 'SENSOR AIM'
      : view.cameraActive ? 'CAM + TOUCH' : 'TOUCH TRAINING';
    const labelNode = elements.mode.querySelector?.('span');
    if (labelNode) labelNode.textContent = label;
    else elements.mode.textContent = label;
  }

  function updateAimModeButtons(mode) {
    const selected = mode === 'camera' ? 'camera' : 'seated';
    elements.cameraAim?.setAttribute('aria-pressed', String(selected === 'camera'));
    elements.seatedTurn?.setAttribute('aria-pressed', String(selected === 'seated'));
  }

  function selectAimMode(mode) {
    const selected = arController.setAimMode(mode);
    updateAimModeButtons(selected);
    writeAimMode(storage, selected);
    updateMode(arController.getView());
    return selected;
  }

  function updateWeaponButtons(selectedWeapon = state.selectedWeapon) {
    for (const id of WEAPON_IDS) {
      for (const button of [elements.weaponButtons[id], elements.hudWeaponButtons[id]]) {
        if (!button) continue;
        button.setAttribute('aria-pressed', String(id === selectedWeapon));
        button.disabled = state.weapon?.reloading === true;
      }
    }
  }

  function selectWeapon(weaponId) {
    const previous = state;
    state = selectWeaponState(state, weaponId);
    const selected = normalizeWeaponId(state.selectedWeapon);
    writeWeaponPreference(storage, selected);
    updateWeaponButtons(selected);
    updateHud(arController.getView());
    return state !== previous ? selected : state.selectedWeapon;
  }

  function updateHud(view) {
    elements.time.textContent = formatTime(state.remaining);
    elements.score.textContent = String(Math.round(state.score)).padStart(6, '0');
    elements.wave.textContent = `0${state.wave} / 03`;
    elements.shield.textContent = String(Math.round(state.shield));
    elements.shieldFill.style.width = `${clamp(state.shield, 0, 100)}%`;
    elements.shieldFill.parentElement?.setAttribute('aria-valuenow', String(Math.round(state.shield)));
    elements.shieldFill.closest?.('.shield-card')?.classList.toggle('is-critical', state.shield <= 30);
    const profile = weaponProfile(state.selectedWeapon);
    elements.ammo.textContent = String(state.ammo).padStart(2, '0');
    if (elements.ammoMax) elements.ammoMax.textContent = String(profile.magazine).padStart(2, '0');
    if (elements.weaponName) elements.weaponName.textContent = profile.label;
    if (elements.weaponSubtitle) elements.weaponSubtitle.textContent = `${profile.subtitle} · ${profile.role}`;
    if (elements.weaponDeck) elements.weaponDeck.dataset.weapon = profile.id;
    const bulletNodes = [...(elements.bullets?.children || [])];
    bulletNodes.forEach((bullet, index) => {
      bullet.hidden = index >= profile.magazine;
      bullet.classList.toggle('spent', index >= state.ammo);
    });
    elements.reload.disabled = state.weapon.reloading || state.ammo >= profile.magazine;
    elements.reload.classList.toggle('reloading', state.weapon.reloading);
    elements.fire.disabled = state.weapon.reloading;
    updateWeaponButtons(state.selectedWeapon);
    elements.combo.textContent = String(state.combo);
    elements.comboPanel.hidden = state.combo < 2;
    elements.lock.textContent = renderInfo.lockedEnemyId === null ? 'SEARCHING' : 'TARGET LOCK';
    elements.lock.classList.toggle('locked', renderInfo.lockedEnemyId !== null);
    updateMode(view);
  }

  function processEvents() {
    const viewport = renderer.getViewport();
    for (const event of state.events) {
      if (event.id <= lastHandledEventId) continue;
      renderer.present?.(event);
      const presentation = eventPresentation(event);
      if (presentation) {
        if (presentation.audio) audioController.play(presentation.audio);
        if (presentation.vibration) audioController.vibrate(presentation.vibration);
        if (presentation.burst) {
          const point = presentation.burst === 'muzzle'
            ? { x: viewport.width / 2, y: viewport.height * 0.69 }
            : { x: viewport.width / 2, y: viewport.height / 2 };
          renderer.burst(presentation.burst, point);
        }
        if (presentation.text) showFeedback(presentation.text, presentation.kind);
      }
      if (event.type === 'player-hit') pulseHitScreen();
      lastHandledEventId = Math.max(lastHandledEventId, event.id);
    }
  }

  function readBestScore() {
    try {
      const stored = finiteNumber(storage?.getItem?.(BEST_SCORE_KEY));
      return Math.max(0, Math.round(stored));
    } catch {
      return 0;
    }
  }

  function writeBestScore(value) {
    try {
      storage?.setItem?.(BEST_SCORE_KEY, String(value));
    } catch (_error) {
      // A blocked storage policy does not affect the mission.
    }
  }

  function showResult() {
    const enteringResult = elements.app.dataset.phase !== 'result';
    const summary = resultSummary(state);
    const score = Math.round(state.score);
    const best = Math.max(readBestScore(), score);
    if (best > readBestScore()) writeBestScore(best);
    elements.resultGrade.textContent = summary.grade;
    elements.resultGrade.dataset.grade = summary.grade;
    elements.resultTitle.textContent = summary.title;
    elements.resultDescription.textContent = summary.description;
    elements.resultScore.textContent = score.toLocaleString('ko-KR');
    elements.resultKills.textContent = String(state.stats.kills);
    elements.resultAccuracy.textContent = `${accuracy(state.stats)}%`;
    elements.resultCriticalHits.textContent = String(state.stats.criticalHits);
    elements.resultCombo.textContent = String(state.bestCombo);
    elements.bestScore.textContent = best.toLocaleString('ko-KR');
    setScreen('result');
    if (enteringResult) releaseWakeLock();
  }

  function ensureFrame() {
    if (frameId === null && !destroyed) frameId = requestFrame(frame);
  }

  function frame(timestamp) {
    frameId = null;
    if (destroyed) return;
    let delta = 0;
    if (state.phase === PHASES.PLAYING) {
      delta = lastFrameTime > 0 ? Math.max(0, (timestamp - lastFrameTime) / 1000) : 0;
      lastFrameTime = timestamp;
      if (delta > 2) {
        pauseMission('화면 갱신이 지연되어 작전을 일시정지했습니다');
        return;
      }
      let remaining = delta;
      while (remaining > 1e-9 && state.phase === PHASES.PLAYING) {
        const step = Math.min(remaining, 1 / 60);
        arController.update(step);
        state = updateGame(state, arController.getView(), step);
        processEvents();
        remaining -= step;
      }
    }
    const view = arController.getView();
    if (state.phase === PHASES.PLAYING) audioController.syncThreatBuzz?.(state.enemies, view.yaw);
    else audioController.syncThreatBuzz?.([], 0);
    renderInfo = renderer.render(state, view, timestamp);
    processEvents();
    updateHud(view);

    if (state.phase === PHASES.RESULT) {
      showResult();
      return;
    }
    if (state.phase === PHASES.PLAYING) ensureFrame();
  }

  function beginMission() {
    if (destroyed || documentObject.hidden || isBlockedViewport()) { cancelPreparation(); return; }
    missionNumber += 1;
    const seed = options.seed === null ? (Date.now() + missionNumber) >>> 0 : options.seed;
    renderer.resetMission?.();
    state = startMission(createInitialState({
      seed,
      duration: options.duration,
      selectedWeapon: state.selectedWeapon
    }));
    lastHandledEventId = 0;
    lastFrameTime = 0;
    setScreen('game');
    renderer.resize(arController.getView());
    acquireWakeLock();
    ensureFrame();
  }

  function startCalibration() {
    if (destroyed || documentObject.hidden || isBlockedViewport()) { cancelPreparation(); return; }
    audioController.syncThreatBuzz?.([], 0);
    clearCountdown();
    setScreen('calibration');
    let count = 3;
    elements.calibrationCount.textContent = String(count);
    const tick = () => {
      count -= 1;
      if (count > 0) {
        elements.calibrationCount.textContent = String(count);
        scheduleCountdown(tick, 620);
        return;
      }
      elements.calibrationCount.textContent = 'GO';
      arController.calibrate();
      scheduleCountdown(beginMission, 420);
    };
    scheduleCountdown(tick, 620);
  }

  function unlockAudio() {
    try { Promise.resolve(audioController.unlock()).catch(() => {}); } catch {}
  }

  async function startWithPermissions() {
    if (destroyed || elements.start.disabled) return;
    const generation = ++launchGeneration;
    elements.start.disabled = true;
    audioController.syncThreatBuzz?.([], 0);
    const label = elements.start.querySelector?.('b');
    if (label) label.textContent = '장비 연결 중';
    unlockAudio();
    const access = await arController.requestAccess(elements.video);
    if (destroyed || generation !== launchGeneration || access.cancelled) return;
    elements.app.dataset.camera = String(access.camera);
    showToast(permissionMessage(access));
    elements.start.disabled = false;
    if (label) label.textContent = '작전 시작';
    startCalibration();
  }

  async function startTraining() {
    if (destroyed) return;
    const generation = ++launchGeneration;
    arController.cancelAccess();
    elements.start.disabled = false;
    const label = elements.start.querySelector?.('b');
    if (label) label.textContent = '작전 시작';
    unlockAudio();
    if (destroyed || generation !== launchGeneration) return;
    elements.app.dataset.camera = 'false';
    showToast('터치 훈련 모드: 드래그로 조준하고 탭으로 사격하세요');
    startCalibration();
  }

  function shoot() {
    if (state.phase !== PHASES.PLAYING) return false;
    const previous = state;
    state = fireWeapon(state, arController.getView());
    if (state === previous) return false;
    processEvents();
    updateHud(arController.getView());
    ensureFrame();
    return true;
  }

  function reload() {
    if (state.phase !== PHASES.PLAYING) return false;
    const previous = state;
    state = requestReload(state);
    if (state === previous) return false;
    processEvents();
    updateHud(arController.getView());
    return true;
  }

  function pauseMission(message) {
    if (state.phase !== PHASES.PLAYING) return false;
    state = togglePause(state);
    audioController.syncThreatBuzz?.([], 0);
    lastFrameTime = 0;
    setScreen('pause');
    releaseWakeLock();
    if (message) showToast(message);
    ensureFrame();
    return true;
  }

  function resumeMission() {
    if (destroyed || documentObject.hidden || isBlockedViewport() || state.phase !== PHASES.PAUSED) return false;
    state = togglePause(state);
    lastFrameTime = 0;
    setScreen('game');
    acquireWakeLock();
    ensureFrame();
    return true;
  }

  function recalibrateAndResume() {
    arController.calibrate();
    showToast('현재 방향으로 조준점을 재설정했습니다');
    if (state.phase === PHASES.PAUSED) resumeMission();
  }

  function replay({ recalibrate = false } = {}) {
    if (recalibrate) arController.calibrate();
    startCalibration();
  }

  function toggleSound() {
    soundEnabled = !soundEnabled;
    audioController.setEnabled(soundEnabled);
    elements.sound.setAttribute('aria-pressed', String(soundEnabled));
    elements.sound.setAttribute('aria-label', soundEnabled ? '음향 끄기' : '음향 켜기');
    writeSoundPreference(storage, soundEnabled);
  }

  async function retryAccess() {
    if (destroyed || elements.retryAccess.disabled) return;
    const generation = ++launchGeneration;
    elements.retryAccess.disabled = true;
    try {
      unlockAudio();
      const access = await arController.requestAccess(elements.video);
      if (destroyed || generation !== launchGeneration || access.cancelled) return;
      elements.app.dataset.camera = String(access.camera);
      renderer.resize(arController.getView());
      arController.calibrate();
      showToast(permissionMessage(access));
    } finally {
      elements.retryAccess.disabled = false;
    }
  }

  async function shareResult() {
    const payload = missionSharePayload({
      grade: missionGrade(state),
      score: Math.round(state.score),
      kills: state.stats.kills,
      accuracy: accuracy(state.stats),
      bestCombo: state.bestCombo
    }, globalObject?.location);
    const result = await shareMissionResult(globalObject, payload);
    if (result === 'shared') showToast('결과를 공유했습니다');
    if (result === 'copied') showToast('결과를 복사했습니다');
    if (result === 'unavailable') showToast('이 기기에서는 결과를 공유할 수 없습니다');
  }

  function attachTurnButton(button, direction) {
    if (!button) return;
    let activePointer = null;
    let pressedAt = null;
    let owner = null;
    const press = (event) => {
      if (activePointer !== null && activePointer !== event?.pointerId) return;
      event?.preventDefault?.();
      activePointer = event?.pointerId ?? 'mouse';
      pressedAt = finiteNumber(globalObject?.performance?.now?.(), Date.now());
      owner = { button, pointerId: activePointer };
      activeTurnOwner = owner;
      button.setPointerCapture?.(event?.pointerId);
      arController.setTurnInput(direction);
    };
    const release = (event, allowTap = false) => {
      if (activePointer === null || (event?.pointerId !== undefined && activePointer !== event.pointerId)) return;
      const releasedAt = finiteNumber(globalObject?.performance?.now?.(), Date.now());
      const duration = pressedAt === null ? Infinity : releasedAt - pressedAt;
      const wasOwner = activeTurnOwner === owner;
      const pointerId = activePointer;
      activePointer = null;
      pressedAt = null;
      owner = null;
      try { button.releasePointerCapture?.(pointerId); } catch {}
      if (!wasOwner) return;
      activeTurnOwner = null;
      arController.setTurnInput(0);
      if (allowTap && duration >= 0 && duration <= TURN_TAP_MS) {
        arController.nudgeTurn(direction, TURN_TAP_DEGREES);
      }
    };
    turnCancels.push(() => release({ pointerId: activePointer }));
    listen(button, 'click', (event) => {
      if (event.detail === 0 && state.phase === PHASES.PLAYING) {
        arController.nudgeTurn(direction, TURN_TAP_DEGREES);
      }
    });
    listen(button, 'pointerdown', press, { passive: false });
    listen(button, 'pointerup', (event) => release(event, true), { passive: true });
    listen(button, 'pointercancel', release, { passive: true });
    listen(button, 'pointerleave', release, { passive: true });
    listen(button, 'lostpointercapture', release, { passive: true });
  }

  function resetTurnControls() {
    for (const cancel of turnCancels) cancel();
    activeTurnOwner = null;
    arController.stopTurn();
  }

  function isBlockedViewport() {
    const width = finiteNumber(globalObject?.innerWidth), height = finiteNumber(globalObject?.innerHeight);
    return height > 0 && height <= 540 && width > height;
  }

  function onViewportChange() {
    if (isBlockedViewport()) {
      if (elements.app.dataset.phase === 'calibration') cancelPreparation();
      pauseMission('세로 화면에서 전투 계속을 눌러주세요');
    }
    redrawInactive();
  }

  function cancelPreparation() {
    launchGeneration += 1;
    clearCountdown();
    arController.cancelAccess();
    elements.app.dataset.camera = 'false';
    updateMode(arController.getView());
    elements.start.disabled = false;
    const label = elements.start.querySelector?.('b');
    if (label) label.textContent = '작전 시작';
    if (elements.app.dataset.phase === 'calibration') setScreen('intro');
  }

  function onKeyDown(event) {
    if (event.defaultPrevented || event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === 'Escape' && !event.repeat) {
      if (state.phase === PHASES.PLAYING) { event.preventDefault(); pauseMission(); }
      else if (state.phase === PHASES.PAUSED) { event.preventDefault(); resumeMission(); }
      return;
    }
    const editable = event.target?.isContentEditable || event.target?.closest?.('input, textarea, select, [contenteditable]');
    if (state.phase === PHASES.PLAYING && !editable && !event.repeat) {
      const nativeControl = event.target?.closest?.('button, a, summary');
      if ((event.code === 'Space' || event.key === ' ') && !nativeControl) {
        event.preventDefault(); shoot(); return;
      }
      if (event.key?.toLowerCase() === 'r') { event.preventDefault(); reload(); return; }
    }
    if (elements.app.dataset.phase !== 'pause' || event.key !== 'Tab') return;
    const controls = [...(elements.pause.querySelectorAll?.('button:not(:disabled), a[href]') || [])];
    if (!controls.length) return;
    const first = controls[0], last = controls.at(-1), active = documentObject.activeElement;
    if (event.shiftKey && (active === first || !controls.includes(active))) {
      event.preventDefault(); last.focus();
    } else if (!event.shiftKey && (active === last || !controls.includes(active))) {
      event.preventDefault(); first.focus();
    }
  }

  function onVisibilityChange() {
    if (!documentObject.hidden) return;
    if (['intro', 'calibration'].includes(elements.app.dataset.phase)) cancelPreparation();
    pauseMission('화면을 벗어나 작전을 일시정지했습니다');
  }

  function redrawInactive() {
    if (destroyed || documentObject.hidden || state.phase === PHASES.PLAYING) return;
    const view = arController.getView();
    renderInfo = renderer.render(state, view, finiteNumber(globalObject?.performance?.now?.()));
    updateHud(view);
  }

  function onOrientationChange() {
    pauseMission('화면 방향이 바뀌어 조준 재설정이 필요합니다');
  }

  function publicState() {
    try {
      if (typeof globalObject?.structuredClone === 'function') return globalObject.structuredClone(state);
      return JSON.parse(JSON.stringify(state));
    } catch (_error) {
      return null;
    }
  }

  function finishForQA() {
    if (state.phase !== PHASES.PLAYING && state.phase !== PHASES.PAUSED) return false;
    state = {
      ...state,
      phase: PHASES.PLAYING,
      elapsed: state.duration,
      remaining: 0,
      enemies: [],
      eliteSpawned: true,
      spawnTimer: 999
    };
    state = updateGame(state, arController.getView(), 0.001);
    audioController.syncThreatBuzz?.([], 0);
    renderInfo = renderer.render(state, arController.getView(), finiteNumber(globalObject?.performance?.now?.()));
    processEvents();
    updateHud(arController.getView());
    showResult();
    return true;
  }

  function seedMaximumWorldForQa() {
    if (exposeDiagnostics !== true) return false;
    const view = arController.getView();
    const yaw = finiteNumber(view?.yaw);
    const pitch = finiteNumber(view?.pitch);
    const liveTypes = ['swarmer', 'stinger', 'bulwark', 'swarmer', 'stinger', 'bulwark'];
    state = {
      ...state,
      enemies: liveTypes.map((type, index) => {
        const elite = index === 5;
        const targetYaw = yaw + (index - 2.5) * 6;
        const targetPitch = pitch + (index % 3 - 1) * 4;
        return {
          id: 70_000 + index,
          type,
          hp: elite ? 9 : type === 'bulwark' ? 6 : type === 'stinger' ? 2 : 1,
          maxHp: elite ? 9 : type === 'bulwark' ? 6 : type === 'stinger' ? 2 : 1,
          baseYaw: targetYaw,
          basePitch: targetPitch,
          yaw: targetYaw,
          pitch: targetPitch,
          entryYawOffset: 0,
          spawnProgress: 1,
          spawnKind: 'airborne-edge',
          spawnSide: index < 3 ? 'left' : 'right',
          distance: 0.42 + index * 0.08,
          speed: 0,
          damage: elite ? 28 : 12,
          points: elite ? 600 : 100,
          size: elite ? 1.5 : type === 'bulwark' ? 1.25 : type === 'swarmer' ? 0.72 : 1,
          age: 4,
          phase: index * 0.91,
          orbit: 0,
          orbitSpeed: 0,
          bob: 0,
          bobSpeed: 0,
          bank: 0,
          divePulse: 0,
          attackCooldown: 999,
          hitFlash: 0,
          elite
        };
      }),
      corpses: Array.from({ length: 4 }, (_, index) => ({
        id: 80_000 + index,
        enemyId: 81_000 + index,
        type: index === 3 ? 'bulwark' : liveTypes[index],
        elite: index === 3,
        yaw: yaw + (index - 1.5) * 7,
        pitch: pitch - 8 + index * 2,
        distance: 0.6 + index * 0.08,
        size: index === 3 ? 1.45 : 1,
        phase: index,
        age: 2 + index * 0.15,
        lifetime: index === 3 ? 12 : 8,
        seed: 82_000 + index,
        fallVelocity: -9,
        roll: (index - 1.5) * 0.3
      })),
      nextEnemyId: 70_006,
      nextCorpseId: 80_004,
      spawnTimer: 999,
      eliteSpawned: true
    };
    renderInfo = renderer.render(state, view, finiteNumber(globalObject?.performance?.now?.()));
    updateHud(view);
    return true;
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    launchGeneration += 1;
    releaseWakeLock();
    clearCountdown();
    if (feedbackTimer !== null) clearTimer(feedbackTimer);
    if (toastTimer !== null) clearTimer(toastTimer);
    if (hitTimer !== null) clearTimer(hitTimer);
    if (frameId !== null) cancelFrame(frameId);
    for (const remove of listeners.splice(0)) remove();
    if (qaHandle && globalObject?.__DEADZONE__ === qaHandle) {
      try {
        delete globalObject.__DEADZONE__;
      } catch (_error) {
        globalObject.__DEADZONE__ = undefined;
      }
    }
    arController.setTurnInput(0);
    arController.destroy();
    renderer.destroy();
    audioController.destroy();
  }

  elements.canvas.tabIndex = 0;
  elements.fire.setAttribute('aria-keyshortcuts', 'Space');
  elements.reload.setAttribute('aria-keyshortcuts', 'R');
  elements.pauseButton.setAttribute('aria-keyshortcuts', 'Escape');
  arController.attachPointer(elements.canvas, { onTap: shoot });
  listen(elements.start, 'click', startWithPermissions);
  listen(elements.training, 'click', startTraining);
  listen(elements.cameraAim, 'click', () => selectAimMode('camera'));
  listen(elements.seatedTurn, 'click', () => selectAimMode('seated'));
  for (const id of WEAPON_IDS) {
    listen(elements.weaponButtons[id], 'click', () => selectWeapon(id));
    listen(elements.hudWeaponButtons[id], 'click', () => selectWeapon(id));
  }
  attachTurnButton(elements.turnLeft, -1);
  attachTurnButton(elements.turnRight, 1);
  listen(elements.pauseButton, 'click', () => pauseMission());
  listen(elements.resume, 'click', resumeMission);
  listen(elements.recalibrate, 'click', recalibrateAndResume);
  listen(elements.retryAccess, 'click', retryAccess);
  listen(elements.resultRecalibrate, 'click', () => replay({ recalibrate: true }));
  listen(elements.reload, 'click', reload);
  listen(elements.fire, 'click', shoot);
  listen(elements.replay, 'click', () => replay());
  listen(elements.shareResult, 'click', shareResult);
  listen(elements.sound, 'click', toggleSound);
  listen(documentObject, 'keydown', onKeyDown);
  listen(documentObject, 'visibilitychange', onVisibilityChange);
  listen(globalObject, 'blur', () => {
    if (elements.app.dataset.phase === 'calibration') cancelPreparation();
    pauseMission('다시 준비되면 전투 계속을 눌러주세요');
  });
  listen(globalObject, 'resize', onViewportChange, { passive: true });
  listen(globalObject, 'orientationchange', onOrientationChange, { passive: true });
  listen(globalObject, 'pagehide', (event) => {
    if (!event.persisted) { destroy(); return; }
    cancelPreparation();
    pauseMission('다시 돌아오면 전투 계속을 눌러주세요');
  });

  if (elements.capabilityStatus) elements.capabilityStatus.textContent = capabilityMessage(globalObject);
  audioController.setEnabled(soundEnabled);
  updateAimModeButtons(arController.getAimMode());
  elements.sound.setAttribute('aria-pressed', String(soundEnabled));
  elements.sound.setAttribute('aria-label', soundEnabled ? '음향 끄기' : '음향 켜기');
  void registerGameServiceWorker(globalObject);
  elements.bestScore.textContent = readBestScore().toLocaleString('ko-KR');
  if (options.training) showToast('훈련 옵션이 준비됐습니다. 아래 훈련 모드 버튼을 누르세요', 3200);
  const initialView = arController.getView();
  renderer.render(state, initialView, finiteNumber(globalObject?.performance?.now?.()));
  updateHud(initialView);

  const publicApi = {
    destroy,
    getState: publicState,
    pause: pauseMission,
    reload,
    resume: resumeMission,
    selectWeapon,
    shoot,
    startTraining
  };
  if (isLocalHostname(globalObject?.location?.hostname)) {
    qaHandle = Object.freeze({
      finish: finishForQA,
      getRendererDiagnostics() {
        return renderer.getDiagnostics?.() || { enemyRenderMode: renderInfo.enemyRenderMode || 'unavailable' };
      },
      getState: publicState,
      ...(exposeDiagnostics === true ? {
        getView() { return arController.getView(); },
        seedEffectsForQa() {
          if (renderer.seedMaximumEffectsForQa?.() !== true) return false;
          renderInfo = renderer.render(state, arController.getView(), finiteNumber(globalObject?.performance?.now?.()));
          return true;
        },
        seedMaximumWorldForQa
      } : {}),
      setView(yaw, pitch) {
        arController.setTouchView(yaw, pitch);
        return arController.getView();
      },
      selectWeapon,
      shoot,
      startTraining
    });
    globalObject.__DEADZONE__ = qaHandle;
  }
  return publicApi;
}

if (typeof document !== 'undefined') {
  createApp(document, globalThis, { exposeDiagnostics: shouldExposeDiagnostics(globalThis) });
}
