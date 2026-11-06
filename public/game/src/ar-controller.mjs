import {
  DEFAULT_VIEWPORT,
  cameraViewportFromCover,
  cameraPoseFromDeviceOrientation,
  clampPitch,
  shortestAngleDelta
} from './ar-geometry.mjs';

const SENSOR_STALE_AFTER = 1200;
const DEFAULT_SENSOR_INTERVAL = 1000 / 60;
const YAW_RESPONSE_TIME = 38;
const PITCH_RESPONSE_TIME = 46;
const TAP_DISTANCE = 8;
const TAP_DURATION = 350;
const YAW_LOCK_ENTER_HORIZONTAL = Math.sin(5 * Math.PI / 180);
const YAW_LOCK_EXIT_HORIZONTAL = Math.sin(10 * Math.PI / 180);
const AIM_MODE_CAMERA = 'camera';
const AIM_MODE_SEATED = 'seated';
const SEATED_TURN_DEADZONE = 6;
const SEATED_TURN_MAX_TILT = 28;
const SEATED_TURN_MAX_RATE = 120;
const MANUAL_TURN_MAX_RATE = 78;
const MANUAL_TURN_ACCEL = 260;
const MANUAL_TURN_DECEL = 420;

function normalizeAimMode(value) {
  return value === AIM_MODE_CAMERA ? AIM_MODE_CAMERA : AIM_MODE_SEATED;
}

function seatedTurnFromRoll(roll, baselineRoll) {
  const rawTilt = shortestAngleDelta(roll, baselineRoll);
  const magnitude = Math.abs(rawTilt);
  const effectiveTilt = Math.max(0, magnitude - SEATED_TURN_DEADZONE);
  if (effectiveTilt <= 0) return { tilt: 0, rate: 0 };
  const ratio = clamp(
    effectiveTilt / Math.max(1, SEATED_TURN_MAX_TILT - SEATED_TURN_DEADZONE),
    0,
    1
  );
  const eased = ratio * ratio * (3 - 2 * ratio);
  return {
    tilt: Math.sign(rawTilt) * effectiveTilt,
    rate: Math.sign(rawTilt) * SEATED_TURN_MAX_RATE * eased
  };
}

function smoothingAlpha(elapsedMs, responseTimeMs) {
  return 1 - Math.exp(-elapsedMs / responseTimeMs);
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function clockFor(globalObject) {
  return finiteNumber(globalObject?.performance?.now?.(), Date.now());
}

function accessReason(camera, sensor) {
  if (!camera && !sensor) return '카메라와 동작 센서를 사용할 수 없어 터치 훈련 모드로 시작합니다';
  if (!camera) return '카메라를 사용할 수 없어 센서 조준 훈련 모드로 시작합니다';
  if (!sensor) return '동작 센서를 사용할 수 없어 화면 드래그로 조준합니다';
  return undefined;
}

export class ARController {
  constructor({ globalObject = globalThis, onStatus = () => {} } = {}) {
    this.globalObject = globalObject;
    this.onStatus = onStatus;
    this.cameraActive = false;
    this.sensorGranted = false;
    this.mode = 'touch';
    this.videoElement = null;
    this.stream = null;
    this.hasSample = false;
    this.smoothedYaw = 0;
    this.smoothedPitch = 0;
    this.yawLocked = false;
    this.baselineYaw = 0;
    this.baselinePitch = 0;
    this.aimMode = AIM_MODE_CAMERA;
    this.baselineRoll = 0;
    this.latestRoll = 0;
    this.turnYaw = 0;
    this.turnRate = 0;
    this.turnTilt = 0;
    this.manualTurnInput = 0;
    this.manualTurnYaw = 0;
    this.manualTurnRate = 0;
    this.lastSampleAt = -Infinity;
    this.lastOrientationTimestamp = null;
    this.touchYaw = 0;
    this.touchPitch = 0;
    this.touchEnabled = true;
    this.pointerTarget = null;
    this.pointerHandlers = null;
    this.pointerGesture = null;
    this.orientationAttached = false;
    this.handleOrientation = this.handleOrientation.bind(this);
  }

  async requestAccess(videoElement) {
    this.videoElement = videoElement || null;
    const [camera, sensor] = await Promise.all([
      this.requestCamera(videoElement),
      this.requestSensor()
    ]);
    this.cameraActive = camera;
    this.sensorGranted = sensor || this.sensorGranted;
    this.mode = camera && sensor ? 'ar' : camera || sensor ? 'hybrid' : 'touch';
    const reason = accessReason(camera, sensor);
    const result = reason
      ? { camera, sensor, mode: this.mode, reason }
      : { camera, sensor, mode: this.mode };
    this.onStatus(result);
    return result;
  }

  async requestCamera(videoElement) {
    let getUserMedia;
    let mediaDevices;
    try {
      mediaDevices = this.globalObject?.navigator?.mediaDevices;
      getUserMedia = mediaDevices?.getUserMedia;
    } catch {
      return false;
    }
    if (typeof getUserMedia !== 'function' || !videoElement) return false;

    let attachedStream = null;
    try {
      attachedStream = videoElement.srcObject;
    } catch {}
    const retainedStream = this.stream || attachedStream;
    const retainedVideoTracks = (() => {
      try {
        return retainedStream?.getVideoTracks?.() || [];
      } catch {
        return [];
      }
    })();
    const retainedTracks = (() => {
      try {
        return retainedStream?.getTracks?.() || retainedVideoTracks;
      } catch {
        return retainedVideoTracks;
      }
    })();
    const hasLiveVideo = retainedVideoTracks.some((track) => {
      try {
        return track?.kind === 'video' && track?.readyState !== 'ended';
      } catch {
        return false;
      }
    });
    if (hasLiveVideo) {
      this.videoElement = videoElement;
      this.stream = retainedStream;
      try {
        if (videoElement.srcObject !== retainedStream) videoElement.srcObject = retainedStream;
        await videoElement.play?.();
        return true;
      } catch {
        return false;
      }
    }

    if (retainedStream) {
      for (const track of retainedTracks) {
        try { track?.stop?.(); } catch {}
      }
      try {
        if (videoElement.srcObject === retainedStream) videoElement.srcObject = null;
      } catch {}
      if (this.stream === retainedStream) this.stream = null;
    }

    let acquiredStream = null;
    try {
      acquiredStream = await getUserMedia.call(mediaDevices, {
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 }
        },
        audio: false
      });
      this.stream = acquiredStream;
      videoElement.srcObject = acquiredStream;
      await videoElement.play?.();
      return true;
    } catch (_error) {
      let tracks = [];
      try {
        tracks = acquiredStream?.getTracks?.() || [];
      } catch {}
      for (const track of tracks) {
        try { track?.stop?.(); } catch {}
      }
      try {
        if (videoElement.srcObject === acquiredStream) videoElement.srcObject = null;
      } catch {}
      if (this.stream === acquiredStream) this.stream = null;
      return false;
    }
  }

  async requestSensor() {
    try {
      const OrientationEvent = this.globalObject?.DeviceOrientationEvent;
      if (!OrientationEvent || typeof this.globalObject?.addEventListener !== 'function') return false;
      if (typeof OrientationEvent.requestPermission === 'function') {
        const permission = await OrientationEvent.requestPermission();
        if (permission !== 'granted') return false;
      }
      if (!this.orientationAttached) {
        this.globalObject.addEventListener('deviceorientation', this.handleOrientation, { passive: true });
        this.orientationAttached = true;
      }
      return true;
    } catch (_error) {
      return false;
    }
  }

  setAimMode(mode) {
    const nextMode = normalizeAimMode(mode);
    if (nextMode !== this.aimMode && nextMode === AIM_MODE_SEATED) {
      this.baselineRoll = this.latestRoll;
      this.turnYaw = 0;
    }
    this.aimMode = nextMode;
    this.turnRate = 0;
    this.turnTilt = 0;
    this.manualTurnInput = 0;
    this.manualTurnYaw = 0;
    this.manualTurnRate = 0;
    return this.aimMode;
  }

  getAimMode() {
    return this.aimMode;
  }

  setTurnInput(direction) {
    let numeric = 0;
    try {
      numeric = Number(direction);
    } catch {
      numeric = 0;
    }
    this.manualTurnInput = Number.isFinite(numeric) && numeric > 0
      ? 1
      : Number.isFinite(numeric) && numeric < 0
        ? -1
        : 0;
    return this.manualTurnInput;
  }

  nudgeTurn(direction, degrees = 7) {
    let numericDirection = 0;
    try {
      numericDirection = Number(direction);
    } catch {
      numericDirection = 0;
    }
    const sign = Number.isFinite(numericDirection) && numericDirection > 0
      ? 1
      : Number.isFinite(numericDirection) && numericDirection < 0
        ? -1
        : 0;
    const amount = clamp(finiteNumber(degrees, 7), 0, 45);
    this.manualTurnInput = 0;
    this.manualTurnRate = 0;
    this.manualTurnYaw += sign * amount;
    return this.getView();
  }

  update(deltaSeconds = 0) {
    const delta = clamp(finiteNumber(deltaSeconds), 0, 2);
    if (delta <= 0) return this.getView();
    const targetRate = this.manualTurnInput * MANUAL_TURN_MAX_RATE;
    const acceleration = this.manualTurnInput === 0 ? MANUAL_TURN_DECEL : MANUAL_TURN_ACCEL;
    const maxStep = acceleration * delta;
    const difference = targetRate - this.manualTurnRate;
    if (Math.abs(difference) <= maxStep) this.manualTurnRate = targetRate;
    else this.manualTurnRate += Math.sign(difference) * maxStep;
    this.manualTurnYaw += this.manualTurnRate * delta;
    if (this.manualTurnInput === 0 && Math.abs(this.manualTurnRate) < 0.0001) {
      this.manualTurnRate = 0;
    }
    return this.getView();
  }

  handleOrientation(event) {
    const pose = cameraPoseFromDeviceOrientation(
      event?.alpha,
      event?.beta,
      event?.gamma,
      this.smoothedYaw
    );
    if (!pose) return;

    const horizontal = Math.hypot(pose.forward.x, pose.forward.y);
    const yawThreshold = this.yawLocked
      ? YAW_LOCK_EXIT_HORIZONTAL
      : YAW_LOCK_ENTER_HORIZONTAL;
    const yawReliable = horizontal >= yawThreshold;
    const sampledAt = clockFor(this.globalObject);
    const sampleAge = sampledAt - this.lastSampleAt;
    const resumingAfterStale = this.hasSample
      && (sampleAge < 0 || sampleAge > SENSOR_STALE_AFTER);
    const rawTimestamp = event?.timeStamp;
    const timestamp = Number(rawTimestamp);
    const hasFiniteTimestamp = rawTimestamp !== null
      && rawTimestamp !== undefined
      && Number.isFinite(timestamp);
    let elapsedMs = DEFAULT_SENSOR_INTERVAL;
    if (hasFiniteTimestamp) {
      const hasPreviousTimestamp = Number.isFinite(this.lastOrientationTimestamp);
      const spacing = hasPreviousTimestamp ? timestamp - this.lastOrientationTimestamp : 0;
      if (Number.isFinite(spacing) && spacing > 0) elapsedMs = spacing;
      this.lastOrientationTimestamp = timestamp;
    } else {
      this.lastOrientationTimestamp = null;
    }
    const snapToPose = resumingAfterStale || elapsedMs > SENSOR_STALE_AFTER;
    const yawAlpha = snapToPose
      ? 1
      : smoothingAlpha(elapsedMs, YAW_RESPONSE_TIME);
    const pitchAlpha = snapToPose
      ? 1
      : smoothingAlpha(elapsedMs, PITCH_RESPONSE_TIME);

    if (!this.hasSample) {
      if (yawReliable) this.smoothedYaw = pose.yaw;
      this.smoothedPitch = pose.pitch;
    } else {
      if (yawReliable) {
        const yawDelta = shortestAngleDelta(pose.yaw, this.smoothedYaw);
        this.smoothedYaw = shortestAngleDelta(this.smoothedYaw + yawDelta * yawAlpha, 0);
      }
      this.smoothedPitch += (pose.pitch - this.smoothedPitch) * pitchAlpha;
    }

    this.latestRoll = finiteNumber(event?.gamma, this.latestRoll);
    if (this.aimMode === AIM_MODE_SEATED) {
      if (!this.hasSample || snapToPose) {
        this.turnRate = 0;
        this.turnTilt = 0;
      } else {
        const turn = seatedTurnFromRoll(this.latestRoll, this.baselineRoll);
        this.turnTilt = turn.tilt;
        this.turnRate = turn.rate;
        if (turn.rate !== 0) {
          this.turnYaw = shortestAngleDelta(
            this.turnYaw + turn.rate * elapsedMs / 1000,
            0
          );
        }
      }
    } else {
      this.turnRate = 0;
      this.turnTilt = 0;
    }

    this.yawLocked = !yawReliable;
    this.hasSample = true;
    this.sensorGranted = true;
    this.lastSampleAt = sampledAt;
  }

  calibrate() {
    this.touchYaw = 0;
    this.touchPitch = 0;
    this.turnYaw = 0;
    this.turnRate = 0;
    this.turnTilt = 0;
    this.manualTurnInput = 0;
    this.manualTurnYaw = 0;
    this.manualTurnRate = 0;
    this.baselineRoll = this.latestRoll;
    if (!this.hasSample) return false;
    this.baselineYaw = this.smoothedYaw;
    this.baselinePitch = this.smoothedPitch;
    return true;
  }

  getView() {
    const now = clockFor(this.globalObject);
    const sampleAge = now - this.lastSampleAt;
    const sensorFresh = this.sensorGranted
      && this.hasSample
      && sampleAge >= 0
      && sampleAge <= SENSOR_STALE_AFTER;
    const projection = this.cameraActive
      ? cameraViewportFromCover(
        {
          width: this.videoElement?.videoWidth,
          height: this.videoElement?.videoHeight
        },
        {
          width: this.videoElement?.clientWidth,
          height: this.videoElement?.clientHeight
        }
      )
      : DEFAULT_VIEWPORT;
    if (sensorFresh) {
      return {
        yaw: shortestAngleDelta(
          (this.aimMode === AIM_MODE_SEATED
            ? this.turnYaw
            : shortestAngleDelta(this.smoothedYaw, this.baselineYaw)) + this.manualTurnYaw,
          0
        ),
        pitch: clampPitch(this.smoothedPitch - this.baselinePitch),
        mode: this.cameraActive ? 'ar' : 'hybrid',
        cameraActive: this.cameraActive,
        sensorFresh: true,
        aimMode: this.aimMode,
        turnRate: this.aimMode === AIM_MODE_SEATED ? this.turnRate : 0,
        turnTilt: this.aimMode === AIM_MODE_SEATED ? this.turnTilt : 0,
        manualTurnRate: this.manualTurnRate,
        manualTurnYaw: this.manualTurnYaw,
        horizontalFov: projection.horizontalFov,
        verticalFov: projection.verticalFov
      };
    }

    return {
      yaw: shortestAngleDelta(this.touchYaw + this.manualTurnYaw, 0),
      pitch: this.touchPitch,
      mode: 'touch',
      cameraActive: this.cameraActive,
      sensorFresh: false,
      aimMode: this.aimMode,
      turnRate: 0,
      turnTilt: 0,
      manualTurnRate: this.manualTurnRate,
      manualTurnYaw: this.manualTurnYaw,
      horizontalFov: projection.horizontalFov,
      verticalFov: projection.verticalFov
    };
  }

  setTouchEnabled(enabled) {
    this.touchEnabled = Boolean(enabled);
  }

  setTouchView(yaw, pitch) {
    this.manualTurnInput = 0;
    this.manualTurnRate = 0;
    this.manualTurnYaw = 0;
    this.touchYaw = clamp(finiteNumber(yaw), -85, 85);
    this.touchPitch = clamp(finiteNumber(pitch), -35, 35);
  }

  attachPointer(element, { onTap = () => {} } = {}) {
    this.detachPointer();
    if (!element?.addEventListener) return;

    const pointerDown = (event) => {
      if (!this.touchEnabled) return;
      this.pointerGesture = {
        id: event.pointerId,
        startX: finiteNumber(event.clientX),
        startY: finiteNumber(event.clientY),
        lastX: finiteNumber(event.clientX),
        lastY: finiteNumber(event.clientY),
        startedAt: clockFor(this.globalObject),
        dragged: false
      };
      element.setPointerCapture?.(event.pointerId);
    };

    const pointerMove = (event) => {
      const gesture = this.pointerGesture;
      if (!this.touchEnabled || !gesture || gesture.id !== event.pointerId) return;
      event.preventDefault?.();
      const x = finiteNumber(event.clientX);
      const y = finiteNumber(event.clientY);
      const deltaX = x - gesture.lastX;
      const deltaY = y - gesture.lastY;
      const totalDistance = Math.hypot(x - gesture.startX, y - gesture.startY);
      if (totalDistance > TAP_DISTANCE) {
        if (!gesture.dragged) {
          this.manualTurnInput = 0;
          this.manualTurnRate = 0;
          this.manualTurnYaw = 0;
        }
        gesture.dragged = true;
      }
      this.touchYaw = clamp(this.touchYaw + deltaX * 0.16, -85, 85);
      this.touchPitch = clamp(this.touchPitch - deltaY * 0.13, -35, 35);
      gesture.lastX = x;
      gesture.lastY = y;
    };

    const pointerUp = (event) => {
      const gesture = this.pointerGesture;
      if (!gesture || gesture.id !== event.pointerId) return;
      const x = finiteNumber(event.clientX);
      const y = finiteNumber(event.clientY);
      const distance = Math.hypot(x - gesture.startX, y - gesture.startY);
      const duration = clockFor(this.globalObject) - gesture.startedAt;
      element.releasePointerCapture?.(event.pointerId);
      this.pointerGesture = null;
      if (!gesture.dragged && distance <= TAP_DISTANCE && duration <= TAP_DURATION) onTap(event);
    };

    const pointerCancel = (event) => {
      if (this.pointerGesture?.id === event.pointerId) this.pointerGesture = null;
    };

    this.pointerTarget = element;
    this.pointerHandlers = { pointerdown: pointerDown, pointermove: pointerMove, pointerup: pointerUp, pointercancel: pointerCancel };
    for (const [type, handler] of Object.entries(this.pointerHandlers)) {
      element.addEventListener(type, handler, { passive: type !== 'pointermove' });
    }
  }

  detachPointer() {
    if (this.pointerTarget && this.pointerHandlers) {
      for (const [type, handler] of Object.entries(this.pointerHandlers)) {
        this.pointerTarget.removeEventListener?.(type, handler);
      }
    }
    this.pointerTarget = null;
    this.pointerHandlers = null;
    this.pointerGesture = null;
  }

  destroy() {
    this.detachPointer();
    if (this.orientationAttached) {
      this.globalObject?.removeEventListener?.('deviceorientation', this.handleOrientation);
      this.orientationAttached = false;
    }
    const stream = this.stream || this.videoElement?.srcObject;
    for (const track of stream?.getTracks?.() || []) track.stop?.();
    if (this.videoElement) this.videoElement.srcObject = null;
    this.stream = null;
    this.cameraActive = false;
  }
}
