import assert from 'node:assert/strict';
import test from 'node:test';

import { ARController } from '../public/game/src/ar-controller.mjs';
import * as arGeometry from '../public/game/src/ar-geometry.mjs';

const { DEFAULT_VIEWPORT, cameraViewportFromCover } = arGeometry;

test('reuses a retained live camera stream without reacquiring or duplicating orientation listeners', async () => {
  let cameraRequests = 0;
  let orientationListeners = 0;
  const track = { kind: 'video', readyState: 'live', stop() {} };
  const stream = {
    getTracks() { return [track]; },
    getVideoTracks() { return [track]; }
  };
  const video = { srcObject: null, async play() {} };
  const controller = new ARController({
    globalObject: {
      DeviceOrientationEvent() {},
      addEventListener(type) {
        if (type === 'deviceorientation') orientationListeners += 1;
      },
      navigator: { mediaDevices: { async getUserMedia() {
        cameraRequests += 1;
        return stream;
      } } }
    }
  });

  assert.equal((await controller.requestAccess(video)).camera, true);
  assert.equal((await controller.requestAccess(video)).camera, true);
  assert.equal(cameraRequests, 1);
  assert.equal(orientationListeners, 1);
  assert.equal(video.srcObject, stream);
  assert.equal(controller.stream, stream);
});

test('stops and detaches an ended retained stream before acquiring its replacement', async () => {
  let oldStops = 0;
  const oldTrack = { kind: 'video', readyState: 'ended', stop() { oldStops += 1; } };
  const oldStream = {
    getTracks() { return [oldTrack]; },
    getVideoTracks() { return [oldTrack]; }
  };
  const replacementTrack = { kind: 'video', readyState: 'live', stop() {} };
  const replacement = {
    getTracks() { return [replacementTrack]; },
    getVideoTracks() { return [replacementTrack]; }
  };
  const video = { srcObject: oldStream, async play() {} };
  let controller;
  controller = new ARController({
    globalObject: { navigator: { mediaDevices: { async getUserMedia() {
      assert.equal(oldStops, 1);
      assert.equal(video.srcObject, null);
      assert.equal(controller.stream, null);
      return replacement;
    } } } }
  });
  controller.stream = oldStream;
  controller.videoElement = video;

  assert.equal(await controller.requestCamera(video), true);
  assert.equal(video.srcObject, replacement);
  assert.equal(controller.stream, replacement);
});

test('playback failure cleans the replacement without disturbing a newer video attachment', async () => {
  let oldStops = 0;
  let replacementStops = 0;
  let newerStops = 0;
  const oldTrack = { kind: 'video', readyState: 'ended', stop() { oldStops += 1; } };
  const oldStream = {
    getTracks() { return [oldTrack]; },
    getVideoTracks() { return [oldTrack]; }
  };
  const replacementTrack = { kind: 'video', readyState: 'live', stop() { replacementStops += 1; } };
  const replacement = {
    getTracks() { return [replacementTrack]; },
    getVideoTracks() { return [replacementTrack]; }
  };
  const newerTrack = { kind: 'video', readyState: 'live', stop() { newerStops += 1; } };
  const newerStream = {
    getTracks() { return [newerTrack]; },
    getVideoTracks() { return [newerTrack]; }
  };
  const video = {
    srcObject: oldStream,
    async play() {
      this.srcObject = newerStream;
      throw new Error('fixture playback rejection');
    }
  };
  const controller = new ARController({
    globalObject: { navigator: { mediaDevices: { async getUserMedia() { return replacement; } } } }
  });
  controller.stream = oldStream;
  controller.videoElement = video;

  assert.equal(await controller.requestCamera(video), false);
  assert.equal(oldStops, 1);
  assert.equal(replacementStops, 1);
  assert.equal(newerStops, 0);
  assert.equal(video.srcObject, newerStream);
  assert.equal(controller.stream, null);
});

test('camera retry treats hostile video and track getters as a safe fallback boundary', async () => {
  let cameraRequests = 0;
  const replacementTrack = { kind: 'video', readyState: 'live', stop() {} };
  const replacement = {
    getVideoTracks() { return [replacementTrack]; },
    getTracks() { return [replacementTrack]; }
  };
  const video = {
    get srcObject() { throw new Error('fixture srcObject getter'); },
    set srcObject(_value) {},
    async play() {}
  };
  const controller = new ARController({
    globalObject: {
      navigator: { mediaDevices: { async getUserMedia() {
        cameraRequests += 1;
        return replacement;
      } } }
    }
  });

  assert.equal(await controller.requestCamera(video), true);
  assert.equal(cameraRequests, 1);
});

test('stops an acquired camera stream when video playback rejects', async () => {
  const track = {
    readyState: 'live',
    stop() { this.readyState = 'ended'; }
  };
  const stream = { getTracks() { return [track]; } };
  const video = {
    srcObject: null,
    async play() { throw new Error('fixture playback rejection'); }
  };
  const controller = new ARController({
    globalObject: {
      navigator: {
        mediaDevices: {
          async getUserMedia() { return stream; }
        }
      }
    }
  });

  assert.equal(await controller.requestCamera(video), false);
  assert.equal(track.readyState, 'ended');
  assert.equal(video.srcObject, null);
  assert.equal(controller.stream, null);
});

test('camera failure cleanup clears references despite hostile track access or stop methods', async (t) => {
  for (const [name, stream, verify] of [
    [
      'throwing getTracks accessor',
      Object.defineProperty({}, 'getTracks', { get() { throw new Error('fixture getTracks failure'); } }),
      () => {}
    ],
    (() => {
      const survivingTrack = { stopped: false, stop() { this.stopped = true; } };
      return [
        'throwing first track stop',
        {
        getTracks() {
          return [
            { stop() { throw new Error('fixture stop failure'); } },
            survivingTrack
          ];
        }
        },
        () => assert.equal(survivingTrack.stopped, true)
      ];
    })()
  ]) {
    await t.test(name, async () => {
      const video = {
        srcObject: null,
        async play() { throw new Error('fixture playback rejection'); }
      };
      const controller = new ARController({
        globalObject: {
          navigator: { mediaDevices: { async getUserMedia() { return stream; } } }
        }
      });

      assert.equal(await controller.requestCamera(video), false);
      verify(stream);
      assert.equal(video.srcObject, null);
      assert.equal(controller.stream, null);
    });
  }
});

function viewAfterStep(hz, { alpha = 330, beta = 90 } = {}) {
  let now = 0;
  const controller = new ARController({
    globalObject: { performance: { now: () => now } }
  });
  controller.setAimMode?.('camera');
  controller.handleOrientation({ alpha: 0, beta: 90, gamma: 0, timeStamp: 0 });
  controller.calibrate();
  const interval = 1000 / hz;
  for (let step = 1; step * interval <= 200.001; step += 1) {
    now = step * interval;
    controller.handleOrientation({ alpha, beta, gamma: 0, timeStamp: now });
  }
  return controller.getView();
}

test('converges by elapsed time instead of orientation event count', () => {
  const results = [15, 20, 30, 60].map((hz) => viewAfterStep(hz).yaw);
  assert.ok(Math.max(...results) - Math.min(...results) < 0.25);
  assert.ok(Math.min(...results) > 29);
});

test('pitch converges by elapsed time instead of orientation event count', () => {
  const results = [15, 20, 30, 60].map((hz) => viewAfterStep(hz, { alpha: 0, beta: 60 }).pitch);
  const expectedAfter200Ms = -29.611952958;
  assert.ok(Math.max(...results) - Math.min(...results) < 0.25);
  for (const pitch of results) assert.ok(Math.abs(pitch - expectedAfter200Ms) < 0.001);
});

test('normalizes aim modes and recalibration resets seated turn', () => {
  let now = 0;
  const controller = new ARController({
    globalObject: { performance: { now: () => now } }
  });
  assert.equal(controller.getAimMode(), 'camera');
  assert.equal(controller.setAimMode('camera'), 'camera');
  assert.equal(controller.getAimMode(), 'camera');
  assert.equal(controller.setAimMode('unsupported'), 'seated');
  controller.handleOrientation({ alpha: 0, beta: 90, gamma: 0, timeStamp: 0 });
  controller.calibrate();
  now = 100;
  controller.handleOrientation({ alpha: 0, beta: 90, gamma: 28, timeStamp: 100 });
  assert.ok(controller.getView().yaw > 0);
  controller.calibrate();
  assert.ok(Math.abs(controller.getView().yaw) < 0.001);
});

test('seated turn uses a roll deadzone, accumulates both directions, and stops without recentering', () => {
  let now = 0;
  let timestamp = 0;
  const controller = new ARController({
    globalObject: { performance: { now: () => now } }
  });
  controller.setAimMode('seated');
  controller.handleOrientation({ alpha: 0, beta: 90, gamma: 0, timeStamp: timestamp });
  controller.calibrate();

  now = 100;
  timestamp = 100;
  controller.handleOrientation({ alpha: 0, beta: 90, gamma: 4, timeStamp: timestamp });
  assert.equal(controller.getView().turnRate, 0);
  assert.equal(controller.getView().yaw, 0);

  for (let step = 0; step < 10; step += 1) {
    now += 100;
    timestamp += 100;
    controller.handleOrientation({ alpha: 0, beta: 90, gamma: 28, timeStamp: timestamp });
  }
  const rightTurn = controller.getView();
  assert.ok(rightTurn.turnRate > 110);
  assert.ok(rightTurn.turnTilt > 20);
  assert.ok(rightTurn.yaw > 90);

  now += 100;
  timestamp += 100;
  controller.handleOrientation({ alpha: 0, beta: 90, gamma: 0, timeStamp: timestamp });
  const stopped = controller.getView();
  assert.equal(stopped.turnRate, 0);
  assert.ok(Math.abs(stopped.yaw - rightTurn.yaw) < 0.001);

  controller.calibrate();
  for (let step = 0; step < 10; step += 1) {
    now += 100;
    timestamp += 100;
    controller.handleOrientation({ alpha: 0, beta: 90, gamma: -28, timeStamp: timestamp });
  }
  assert.ok(controller.getView().yaw < -90);
});

test('seated turn pauses during stale sensor gaps and resumes from a safe roll baseline', () => {
  let now = 0;
  const controller = new ARController({
    globalObject: { performance: { now: () => now } }
  });
  controller.setAimMode('seated');
  controller.handleOrientation({ alpha: 0, beta: 90, gamma: 0, timeStamp: 0 });
  controller.calibrate();
  now = 100;
  controller.handleOrientation({ alpha: 0, beta: 90, gamma: 28, timeStamp: 100 });
  const beforeGap = controller.getView().yaw;

  now = 2000;
  controller.handleOrientation({ alpha: 0, beta: 90, gamma: 28, timeStamp: 2000 });
  const resumed = controller.getView();
  assert.equal(resumed.turnRate, 0);
  assert.ok(Math.abs(resumed.yaw - beforeGap) < 0.001);

  now = 2100;
  controller.handleOrientation({ alpha: 0, beta: 90, gamma: 0, timeStamp: 2100 });
  assert.equal(controller.getView().turnRate, 0);
  now = 2200;
  controller.handleOrientation({ alpha: 0, beta: 90, gamma: -28, timeStamp: 2200 });
  assert.ok(controller.getView().turnRate < -110);
});

test('manual turn ramps while held, reverses safely, and decelerates on release', () => {
  const controller = new ARController({
    globalObject: { performance: { now: () => 0 } }
  });
  controller.setTurnInput(1);
  controller.update(0.1);
  const first = controller.getView();
  controller.update(0.5);
  const held = controller.getView();
  assert.ok(held.yaw > first.yaw);
  assert.ok(held.manualTurnRate > first.manualTurnRate);

  controller.setTurnInput(-1);
  controller.update(0.1);
  assert.ok(controller.getView().manualTurnRate < held.manualTurnRate);

  controller.setTurnInput(0);
  const beforeRelease = controller.getView().yaw;
  controller.update(0.1);
  assert.ok(controller.getView().yaw > beforeRelease);
  controller.update(0.5);
  controller.update(1);
  assert.equal(controller.getView().manualTurnRate, 0);
});

test('manual turn keeps an unbounded offset and normalizes only the published view', () => {
  const controller = new ARController({
    globalObject: { performance: { now: () => 0 } }
  });
  controller.setTurnInput(1);
  for (let step = 0; step < 10; step += 1) controller.update(1);

  assert.ok(controller.manualTurnYaw > 360);
  assert.ok(controller.getView().yaw >= -180);
  assert.ok(controller.getView().yaw <= 180);
});

test('touch drag replaces the manual turn base instead of adding a second yaw', () => {
  const controller = new ARController({
    globalObject: { performance: { now: () => 0 } }
  });
  controller.setTurnInput(1);
  controller.update(0.5);
  assert.notEqual(controller.getView().manualTurnYaw, 0);

  controller.setTouchView(20, 0);
  const view = controller.getView();
  assert.equal(view.yaw, 20);
  assert.equal(view.manualTurnYaw, 0);
  assert.equal(view.manualTurnRate, 0);
});

test('turn nudges support a precise short tap without starting a hold', () => {
  const controller = new ARController({
    globalObject: { performance: { now: () => 0 } }
  });

  controller.nudgeTurn(1, 7);
  assert.equal(controller.getView().yaw, 7);
  assert.equal(controller.getView().manualTurnRate, 0);
  controller.nudgeTurn(-1, 2);
  assert.equal(controller.getView().yaw, 5);
});

test('calibration clears manual turn offset and input', () => {
  const controller = new ARController({
    globalObject: { performance: { now: () => 0 } }
  });
  controller.setTurnInput(1);
  controller.update(0.5);
  assert.notEqual(controller.getView().manualTurnYaw, 0);
  controller.calibrate();
  assert.equal(controller.getView().manualTurnYaw, 0);
  assert.equal(controller.getView().manualTurnRate, 0);
  controller.update(0.5);
  assert.equal(controller.getView().manualTurnYaw, 0);
});

test('uses the 60 Hz fallback for equal and non-monotonic sensor timestamps', () => {
  let now = 0;
  const controller = new ARController({
    globalObject: { performance: { now: () => now } }
  });
  controller.handleOrientation({ alpha: 0, beta: 90, gamma: 0, timeStamp: 0 });
  controller.calibrate();

  controller.handleOrientation({ alpha: 330, beta: 90, gamma: 0, timeStamp: 0 });
  now = 1;
  controller.handleOrientation({ alpha: 330, beta: 90, gamma: 0, timeStamp: -1 });

  assert.ok(controller.getView().yaw > 17);
  assert.ok(controller.getView().yaw < 18);
});

test('uses the 60 Hz fallback when a valid timestamp follows a missing timestamp', () => {
  let now = 0;
  const controller = new ARController({
    globalObject: { performance: { now: () => now } }
  });
  controller.handleOrientation({ alpha: 0, beta: 90, gamma: 0, timeStamp: 0 });
  controller.calibrate();

  now = 1;
  controller.handleOrientation({ alpha: 330, beta: 90, gamma: 0 });
  now = 2;
  controller.handleOrientation({ alpha: 330, beta: 90, gamma: 0, timeStamp: 2000 });

  assert.ok(controller.getView().yaw > 17);
  assert.ok(controller.getView().yaw < 18);
});

test('moves across yaw wraparound through the shortest path', () => {
  let now = 0;
  const controller = new ARController({
    globalObject: { performance: { now: () => now } }
  });
  controller.handleOrientation({ alpha: 181, beta: 90, gamma: 0, timeStamp: 0 });
  controller.calibrate();

  now = 1000 / 60;
  controller.handleOrientation({ alpha: 179, beta: 90, gamma: 0, timeStamp: now });

  const { yaw } = controller.getView();
  assert.ok(yaw > 0);
  assert.ok(yaw < 2);
});

test('snaps to a fresh pose after a sensor gap longer than 1.2 seconds', () => {
  let now = 0;
  const controller = new ARController({
    globalObject: { performance: { now: () => now } }
  });
  controller.handleOrientation({ alpha: 0, beta: 90, gamma: 0, timeStamp: 0 });
  controller.calibrate();

  now = 1201;
  controller.handleOrientation({ alpha: 330, beta: 90, gamma: 0, timeStamp: now });

  assert.ok(Math.abs(controller.getView().yaw - 30) < 0.001);
});

test('snaps yaw and pitch after application-clock staleness when the resumed timestamp is missing', () => {
  let now = 0;
  const controller = new ARController({
    globalObject: { performance: { now: () => now } }
  });
  controller.handleOrientation({ alpha: 0, beta: 90, gamma: 0, timeStamp: 5000 });
  controller.calibrate();

  now = 1201;
  controller.handleOrientation({ alpha: 330, beta: 60, gamma: 0 });

  const { pitch, yaw } = controller.getView();
  assert.ok(Math.abs(yaw - 30) < 0.001);
  assert.ok(Math.abs(pitch + 30) < 0.001);
});

test('snaps after a backward timestamp reset and rebases normal sample spacing from the reset', () => {
  let now = 0;
  const controller = new ARController({
    globalObject: { performance: { now: () => now } }
  });
  controller.handleOrientation({ alpha: 0, beta: 90, gamma: 0, timeStamp: 5000 });
  controller.calibrate();

  now = 1201;
  controller.handleOrientation({ alpha: 330, beta: 60, gamma: 0, timeStamp: 10 });
  let view = controller.getView();
  assert.ok(Math.abs(view.yaw - 30) < 0.001);
  assert.ok(Math.abs(view.pitch + 30) < 0.001);

  now += 1000 / 15;
  controller.handleOrientation({ alpha: 0, beta: 90, gamma: 0, timeStamp: 10 + 1000 / 15 });
  view = controller.getView();
  assert.ok(view.yaw > 5 && view.yaw < 5.3);
  assert.ok(view.pitch > -7.2 && view.pitch < -6.9);
});

test('snaps and rebases when the application clock moves backward', () => {
  let now = 10_000;
  const controller = new ARController({
    globalObject: { performance: { now: () => now } }
  });
  controller.handleOrientation({ alpha: 0, beta: 90, gamma: 0, timeStamp: 5000 });
  controller.calibrate();

  now = 8000;
  assert.equal(controller.getView().sensorFresh, false);

  now = 9000;
  controller.handleOrientation({ alpha: 330, beta: 60, gamma: 0 });

  const { pitch, yaw } = controller.getView();
  assert.ok(Math.abs(yaw - 30) < 0.001);
  assert.ok(Math.abs(pitch + 30) < 0.001);
});

test('derives the visible field of view after portrait cover cropping', () => {
  const landscape = cameraViewportFromCover(
    { width: 1280, height: 720 },
    { width: 390, height: 844 }
  );
  assert.ok(Math.abs(landscape.horizontalFov - 19.523) < 0.01);
  assert.ok(Math.abs(landscape.verticalFov - 40.842) < 0.01);

  const portrait = cameraViewportFromCover(
    { width: 720, height: 1280 },
    { width: 390, height: 844 }
  );
  assert.ok(Math.abs(portrait.horizontalFov - 34.012) < 0.01);
  assert.ok(Math.abs(portrait.verticalFov - 67) < 0.01);
});

test('uses the default viewport when cover projection dimensions are invalid', () => {
  for (const [source, viewport, longEdgeFov] of [
    [{ width: 0, height: 720 }, { width: 390, height: 844 }, 67],
    [{ width: 1280, height: 720 }, { width: Number.NaN, height: 844 }, 67],
    [{ width: 1280, height: 720 }, { width: 390, height: 844 }, -1]
  ]) {
    assert.deepEqual(cameraViewportFromCover(source, viewport, longEdgeFov), DEFAULT_VIEWPORT);
  }
});

test('publishes the camera cover field of view from the active video element', () => {
  const controller = new ARController();
  controller.cameraActive = true;
  controller.videoElement = {
    videoWidth: 1280,
    videoHeight: 720,
    clientWidth: 390,
    clientHeight: 844
  };

  const view = controller.getView();

  assert.ok(Math.abs(view.horizontalFov - 19.523) < 0.01);
  assert.ok(Math.abs(view.verticalFov - 40.842) < 0.01);
});
