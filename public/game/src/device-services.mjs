export const SOUND_PREFERENCE_KEY = 'deadzone-ar.sound-enabled.v1';

function safely(read, fallback) {
  try {
    return read();
  } catch {
    return fallback;
  }
}

async function safelyAsync(read, fallback) {
  try {
    return await read();
  } catch {
    return fallback;
  }
}

export function capabilityMessage(globalObject = globalThis) {
  const hostname = safely(() => String(globalObject?.location?.hostname || '').toLowerCase(), '');
  const local = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(hostname);
  const secure = safely(() => globalObject?.isSecureContext, undefined);
  if (secure === false && !local) return '보안 연결 필요 · 훈련 모드 사용 가능';

  const camera = safely(() => typeof globalObject?.navigator?.mediaDevices?.getUserMedia === 'function', false);
  const motion = safely(() => typeof globalObject?.DeviceOrientationEvent === 'function', false);
  if (camera && motion) return '카메라·모션 지원 확인 · 시작 시 권한 요청';
  if (camera) return '카메라 지원 · 터치 조준으로 실행 가능';
  return '카메라 미지원 · 센서/터치 훈련 가능';
}

export function readSoundPreference(storage) {
  return safely(() => storage?.getItem(SOUND_PREFERENCE_KEY) !== 'false', true);
}

export function writeSoundPreference(storage, enabled) {
  return safely(() => {
    const setItem = storage?.setItem;
    if (typeof setItem !== 'function') return false;
    setItem.call(storage, SOUND_PREFERENCE_KEY, String(Boolean(enabled)));
    return true;
  }, false);
}

export function missionSharePayload(result, location) {
  const origin = safely(() => new URL(location?.href).origin, safely(() => location?.origin, ''));
  return {
    title: 'Deadzone AR 임무 결과',
    text: `${result.grade}등급 · ${Number(result.score).toLocaleString('en-US')}점 · 처치 ${result.kills} · 명중률 ${result.accuracy}% · 최고 콤보 ${result.bestCombo}`,
    url: `${origin}/game/index.html`
  };
}

export async function shareMissionResult(globalObject = globalThis, payload) {
  const navigatorObject = safely(() => globalObject?.navigator, null);
  const share = safely(() => navigatorObject?.share, null);
  if (typeof share === 'function') {
    try {
      await share.call(navigatorObject, payload);
      return 'shared';
    } catch (error) {
      if (safely(() => error?.name, '') === 'AbortError') return 'cancelled';
    }
  }

  const writeText = safely(() => navigatorObject?.clipboard?.writeText, null);
  if (typeof writeText !== 'function') return 'unavailable';
  try {
    const clipboardText = payload.url ? `${payload.text}\n${payload.url}` : payload.text;
    await writeText.call(navigatorObject.clipboard, clipboardText);
    return 'copied';
  } catch {
    return 'unavailable';
  }
}

export async function registerGameServiceWorker(globalObject = globalThis) {
  const serviceWorker = safely(() => globalObject?.navigator?.serviceWorker, null);
  const register = safely(() => serviceWorker?.register, null);
  if (typeof register !== 'function') return false;
  try {
    await register.call(serviceWorker, '/game/sw.js', { scope: '/game/', type: 'module' });
    return true;
  } catch {
    return false;
  }
}

export class WakeLockController {
  constructor({ globalObject = globalThis } = {}) {
    this.globalObject = globalObject;
    this.pending = null;
    this.releasing = null;
    this.sentinel = null;
    this.releaseListener = null;
    this.destroyed = false;
  }

  async acquire() {
    if (this.destroyed) return false;
    if (this.releasing) {
      await this.releasing;
      return this.acquire();
    }
    if (this.sentinel) return true;
    if (this.pending) return this.pending;

    const wakeLock = safely(() => this.globalObject?.navigator?.wakeLock, null);
    const hidden = safely(() => this.globalObject?.document?.hidden, true);
    const request = safely(() => wakeLock?.request, null);
    if (hidden || typeof request !== 'function') return false;

    const acquisition = Promise.resolve().then(async () => {
      try {
        const sentinel = await request.call(wakeLock, 'screen');
        if (!sentinel || this.destroyed) {
          await safelyAsync(() => sentinel?.release(), undefined);
          return false;
        }
        this.sentinel = sentinel;
        this.releaseListener = () => this.clearSentinel(sentinel);
        safely(() => sentinel.addEventListener?.('release', this.releaseListener), undefined);
        return true;
      } catch {
        return false;
      } finally {
        if (this.pending === acquisition) this.pending = null;
      }
    });
    this.pending = acquisition;
    return acquisition;
  }

  clearSentinel(sentinel) {
    if (this.sentinel !== sentinel) return;
    safely(() => sentinel.removeEventListener?.('release', this.releaseListener), undefined);
    this.sentinel = null;
    this.releaseListener = null;
  }

  release() {
    if (this.releasing) return this.releasing;
    const releasing = Promise.resolve().then(async () => {
      if (this.pending) await this.pending;
      const sentinel = this.sentinel;
      if (!sentinel) return;
      this.clearSentinel(sentinel);
      await safelyAsync(() => sentinel.release?.(), undefined);
    });
    this.releasing = releasing;
    void releasing.finally(() => {
      if (this.releasing === releasing) this.releasing = null;
    });
    return releasing;
  }

  async destroy() {
    this.destroyed = true;
    await this.release();
  }
}
