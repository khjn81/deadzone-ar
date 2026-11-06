import assert from 'node:assert/strict';
import test from 'node:test';

import {
  capabilityMessage,
  missionSharePayload,
  readSoundPreference,
  registerGameServiceWorker,
  shareMissionResult,
  writeSoundPreference,
  WakeLockController
} from '../public/game/src/device-services.mjs';

test('capability copy distinguishes full AR, touch fallback, and insecure contexts', () => {
  const full = { isSecureContext: true, DeviceOrientationEvent() {}, navigator: { mediaDevices: { getUserMedia() {} } } };

  assert.equal(capabilityMessage(full), '카메라·모션 지원 확인 · 시작 시 권한 요청');
  assert.equal(capabilityMessage({ ...full, DeviceOrientationEvent: undefined }), '카메라 지원 · 터치 조준으로 실행 가능');
  assert.equal(capabilityMessage({ ...full, navigator: {} }), '카메라 미지원 · 센서/터치 훈련 가능');
  assert.equal(capabilityMessage({ ...full, isSecureContext: false, location: { hostname: 'example.test' } }), '보안 연결 필요 · 훈련 모드 사용 가능');
});

test('sound preference defaults on and survives hostile storage', () => {
  assert.equal(readSoundPreference(null), true);
  assert.equal(readSoundPreference({ getItem: () => 'false' }), false);
  assert.equal(readSoundPreference({ getItem() { throw new Error('blocked'); } }), true);

  const writes = [];
  assert.equal(writeSoundPreference({ setItem: (...args) => writes.push(args) }, false), true);
  assert.deepEqual(writes, [['deadzone-ar.sound-enabled.v1', 'false']]);
});

test('wake lock owns one sentinel and releases on pause and destroy', async () => {
  const sentinels = [];
  const controller = new WakeLockController({ globalObject: {
    document: { hidden: false },
    navigator: { wakeLock: { async request(kind) {
      const sentinel = { kind, released: false, async release() { this.released = true; } };
      sentinels.push(sentinel);
      return sentinel;
    } } }
  } });

  assert.equal(await controller.acquire(), true);
  assert.equal(await controller.acquire(), true);
  assert.equal(sentinels.length, 1);
  await controller.release();
  assert.equal(sentinels[0].released, true);
  await controller.destroy();
});

test('wake lock treats unavailable, rejected, and hidden requests as unavailable', async () => {
  assert.equal(await new WakeLockController({ globalObject: { document: { hidden: false }, navigator: {} } }).acquire(), false);
  assert.equal(await new WakeLockController({ globalObject: { document: { hidden: true }, navigator: { wakeLock: { request() { throw new Error('must not request'); } } } } }).acquire(), false);
  assert.equal(await new WakeLockController({ globalObject: { document: { hidden: false }, navigator: { wakeLock: { async request() { throw new Error('denied'); } } } } }).acquire(), false);
});

test('wake lock uses the safely read request method once', async () => {
  let reads = 0;
  const controller = new WakeLockController({ globalObject: {
    document: { hidden: false },
    navigator: { wakeLock: { get request() {
      reads += 1;
      if (reads > 1) throw new Error('second property read');
      return async () => ({ async release() {} });
    } } }
  } });

  assert.equal(await controller.acquire(), true);
  await controller.destroy();
});

test('wake lock clears released sentinels after release errors and spontaneous releases', async () => {
  const sentinels = [];
  const globalObject = {
    document: { hidden: false },
    navigator: { wakeLock: { async request() {
      const requestIndex = sentinels.length;
      const listeners = new Map();
      const sentinel = {
        addEventListener(type, listener) { listeners.set(type, listener); },
        async release() { if (requestIndex === 0) throw new Error('release failed'); },
        triggerRelease() { listeners.get('release')?.(); }
      };
      sentinels.push(sentinel);
      return sentinel;
    } } }
  };
  const controller = new WakeLockController({ globalObject });

  assert.equal(await controller.acquire(), true);
  await controller.release();
  assert.equal(await controller.acquire(), true);
  sentinels[1].triggerRelease();
  assert.equal(await controller.acquire(), true);
  await controller.destroy();
  await controller.destroy();
});

test('wake lock waits for a pending release before requesting another sentinel', async () => {
  let releaseFirst;
  let requests = 0;
  const controller = new WakeLockController({ globalObject: {
    document: { hidden: false },
    navigator: { wakeLock: { async request() {
      requests += 1;
      const requestNumber = requests;
      return {
        release() {
          if (requestNumber > 1) return Promise.resolve();
          return new Promise((resolve) => { releaseFirst = resolve; });
        }
      };
    } } }
  } });

  assert.equal(await controller.acquire(), true);
  const releasing = controller.release();
  const acquiring = controller.acquire();
  await Promise.resolve();
  assert.equal(requests, 1);
  releaseFirst();
  await releasing;
  assert.equal(await acquiring, true);
  assert.equal(requests, 2);
  await controller.destroy();
});

test('wake lock release drains a deferred acquisition before completing', async () => {
  let resolveRequest;
  let requests = 0;
  const sentinels = [];
  const controller = new WakeLockController({ globalObject: {
    document: { hidden: false },
    navigator: { wakeLock: { request() {
      requests += 1;
      if (requests > 1) return Promise.resolve({ async release() {} });
      return new Promise((resolve) => {
        resolveRequest = () => {
          const sentinel = {
            released: false,
            async release() { this.released = true; }
          };
          sentinels.push(sentinel);
          resolve(sentinel);
        };
      });
    } } }
  } });

  const acquiring = controller.acquire();
  await Promise.resolve();
  let releaseCompleted = false;
  const releasing = controller.release().then(() => { releaseCompleted = true; });
  await Promise.resolve();

  assert.equal(releaseCompleted, false);
  resolveRequest();
  await Promise.all([acquiring, releasing]);
  assert.equal(sentinels[0].released, true);

  assert.equal(await controller.acquire(), true);
  assert.equal(requests, 2);
  await controller.destroy();
});

test('wake lock destroy drains a deferred acquisition before completing', async () => {
  let resolveRequest;
  let released = false;
  const controller = new WakeLockController({ globalObject: {
    document: { hidden: false },
    navigator: { wakeLock: { request() {
      return new Promise((resolve) => {
        resolveRequest = () => resolve({ async release() { released = true; } });
      });
    } } }
  } });

  const acquiring = controller.acquire();
  await Promise.resolve();
  let destroyCompleted = false;
  const destroying = controller.destroy().then(() => { destroyCompleted = true; });
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(destroyCompleted, false);
  resolveRequest();
  await Promise.all([acquiring, destroying]);
  assert.equal(released, true);
  assert.equal(await controller.acquire(), false);
});

test('share cancellation does not copy and ordinary failure falls back to clipboard', async () => {
  const writes = [];
  const payload = missionSharePayload(
    { grade: 'A', score: 1200, kills: 7, accuracy: 80, bestCombo: 4 },
    { href: 'https://host/game/index.html' }
  );

  assert.match(payload.text, /1,200점/);
  assert.match(payload.text, /A등급/);
  assert.deepEqual(payload, {
    title: 'Deadzone AR 임무 결과',
    text: 'A등급 · 1,200점 · 처치 7 · 명중률 80% · 최고 콤보 4',
    url: 'https://host/game/index.html'
  });
  assert.equal(await shareMissionResult({ navigator: { share: async () => { throw new DOMException('cancel', 'AbortError'); }, clipboard: { writeText: async (value) => writes.push(value) } } }, payload), 'cancelled');
  assert.deepEqual(writes, []);
  assert.equal(await shareMissionResult({ navigator: { share: async () => { throw new Error('failed'); }, clipboard: { writeText: async (value) => writes.push(value) } } }, payload), 'copied');
  assert.deepEqual(writes, [`${payload.text}\n${payload.url}`]);
});

test('sharing reports unavailable when neither a successful share nor clipboard write is possible', async () => {
  const payload = { title: 'result', text: 'result', url: 'https://host/game/index.html' };
  assert.equal(await shareMissionResult({ navigator: {} }, payload), 'unavailable');
  assert.equal(await shareMissionResult({ navigator: { clipboard: { async writeText() { throw new Error('blocked'); } } } }, payload), 'unavailable');
  assert.equal(await shareMissionResult({ navigator: { share: async () => {} } }, payload), 'shared');
});

test('service worker registers one scoped module without escaping failure', async () => {
  const calls = [];
  assert.equal(await registerGameServiceWorker({ navigator: { serviceWorker: { register: async (...args) => calls.push(args) } } }), true);
  assert.deepEqual(calls, [['/game/sw.js', { scope: '/game/', type: 'module' }]]);
  assert.equal(await registerGameServiceWorker({ navigator: {} }), false);
  assert.equal(await registerGameServiceWorker({ navigator: { serviceWorker: { async register() { throw new Error('blocked'); } } } }), false);
});
