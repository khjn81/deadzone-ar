import assert from 'node:assert/strict';
import test from 'node:test';

import { AudioController } from '../public/game/src/audio-controller.mjs';

function recordedParam() {
  const automation = [];
  return {
    automation,
    exponentialRampToValueAtTime(value, time) { automation.push({ method: 'exponentialRampToValueAtTime', time, value }); },
    linearRampToValueAtTime(value, time) { automation.push({ method: 'linearRampToValueAtTime', time, value }); },
    setValueAtTime(value, time) { automation.push({ method: 'setValueAtTime', time, value }); }
  };
}

function recordedNode() {
  return {
    connections: [],
    disconnectCalls: 0,
    startCalls: [],
    stopCalls: [],
    connect(destination) { this.connections.push(destination); return destination; },
    disconnect() { this.disconnectCalls += 1; },
    start(time) { this.startCalls.push(time); },
    stop(time) { this.stopCalls.push(time); }
  };
}

function fakeGlobal() {
  const timers = new Map();
  let nextTimer = 0;
  const globalObject = {
    clearTimeout(timer) { timers.delete(timer); },
    pendingTimerDelays() { return [...timers.values()].map(({ delay }) => delay); },
    pendingTimerCount() { return timers.size; },
    runNextTimer() {
      const next = timers.entries().next().value;
      if (!next) return false;
      const [timer, { callback }] = next;
      timers.delete(timer);
      callback();
      return true;
    },
    setTimeout(callback, delay) {
      nextTimer += 1;
      timers.set(nextTimer, { callback, delay });
      return nextTimer;
    }
  };

  class FakeAudioContext {
    constructor() {
      this.state = 'suspended';
      this.currentTime = 4;
      this.destination = recordedNode();
      this.closed = false;
      this.closeCalls = 0;
      this.resumeCalls = 0;
      this.oscillators = [];
      this.gains = [];
      this.buffers = [];
      this.bufferSources = [];
      this.filters = [];
      this.panners = [];
      globalObject.context = this;
    }

    async resume() { this.resumeCalls += 1; this.state = 'running'; }
    async close() { this.closeCalls += 1; this.closed = true; this.state = 'closed'; }

    createOscillator() {
      const oscillator = { ...recordedNode(), frequency: recordedParam(), type: 'sine' };
      this.oscillators.push(oscillator);
      return oscillator;
    }

    createGain() {
      const gain = { ...recordedNode(), gain: recordedParam() };
      this.gains.push(gain);
      return gain;
    }

    createBuffer(channels, length, sampleRate) {
      const buffer = {
        channels,
        length,
        sampleRate,
        channelData: Array.from({ length: channels }, () => new Float32Array(length)),
        getChannelData(channel) { return this.channelData[channel]; }
      };
      this.buffers.push(buffer);
      return buffer;
    }

    createBufferSource() {
      const source = { ...recordedNode(), buffer: null, playbackRate: recordedParam() };
      this.bufferSources.push(source);
      return source;
    }

    createBiquadFilter() {
      const filter = { ...recordedNode(), frequency: recordedParam(), gain: recordedParam(), Q: recordedParam(), type: 'lowpass' };
      this.filters.push(filter);
      return filter;
    }

    createStereoPanner() {
      const panner = { ...recordedNode(), pan: recordedParam() };
      this.panners.push(panner);
      return panner;
    }

    createdNodeCount() {
      return this.oscillators.length + this.gains.length + this.buffers.length + this.bufferSources.length + this.filters.length + this.panners.length;
    }

    startedSourceCount() {
      return [...this.oscillators, ...this.bufferSources]
        .reduce((total, source) => total + source.startCalls.length, 0);
    }

    maxScheduledGain() {
      const values = this.gains.flatMap(({ gain }) => gain.automation.map(({ value }) => value));
      return values.length > 0 ? Math.max(...values) : 0;
    }
  }

  globalObject.AudioContext = FakeAudioContext;
  return globalObject;
}

function assertClose(actual, expected, message) {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${message}: expected ${expected}, received ${actual}`);
}

function peakAutomatedValue(param) {
  return Math.max(...param.automation.map(({ value }) => value));
}

test('unlock resumes a suspended context and schedules connected, capped, context-timed layers', async () => {
  const globalObject = fakeGlobal();
  const audio = new AudioController({ globalObject });

  assert.equal(await audio.unlock(), true);
  const context = globalObject.context;
  assert.equal(context.resumeCalls, 1);
  assert.equal(context.state, 'running');

  audio.tone({ duration: 0.1, delay: 0.25, gain: 99 });
  const oscillator = context.oscillators[0];
  const toneEnvelope = context.gains[0];

  assert.equal(oscillator.connections[0], toneEnvelope);
  assert.equal(toneEnvelope.connections[0], context.destination);
  assert.deepEqual(oscillator.startCalls, [4.25]);
  assertClose(oscillator.stopCalls[0], 4.36, 'tone stop time');
  assert.equal(peakAutomatedValue(toneEnvelope.gain), 0.22);

  audio.noise({ duration: 0.1, delay: 0.5, gain: 99 });
  const source = context.bufferSources[0];
  const filter = context.filters[0];
  const noiseEnvelope = context.gains[1];

  assert.equal(source.connections[0], filter);
  assert.equal(filter.connections[0], noiseEnvelope);
  assert.equal(noiseEnvelope.connections[0], context.destination);
  assert.deepEqual(source.startCalls, [4.5]);
  assertClose(source.stopCalls[0], 4.61, 'noise stop time');
  assert.equal(peakAutomatedValue(noiseEnvelope.gain), 0.22);
});

test('starts distinct bounded insect, weapon, casing, and impact cues', async () => {
  const globalObject = fakeGlobal();
  const audio = new AudioController({ globalObject });
  await audio.unlock();
  const context = globalObject.context;

  for (const cue of ['spawn', 'elite-spawn', 'shoot', 'rail', 'cryo', 'casing', 'hit', 'critical-hit', 'kill', 'miss']) {
    const before = context.startedSourceCount();
    audio.play(cue);
    assert.ok(context.startedSourceCount() > before, `${cue} must start audible Web Audio sources`);
  }

  assert.ok(context.maxScheduledGain() <= 0.22);
});

test('gives rail and cryo weapons distinct bounded signatures', async () => {
  const globalObject = fakeGlobal();
  const audio = new AudioController({ globalObject });
  await audio.unlock();
  const context = globalObject.context;

  audio.play('rail');
  const railValues = context.oscillators.flatMap(({ frequency }) => frequency.automation.map(({ value }) => value));
  assert.ok(railValues.includes(880));
  assert.ok(railValues.includes(120));

  const beforeCryo = context.createdNodeCount();
  audio.play('cryo');
  assert.ok(context.createdNodeCount() > beforeCryo);
  const cryoValues = context.oscillators.slice(2).flatMap(({ frequency }) => frequency.automation.map(({ value }) => value));
  assert.ok(cryoValues.includes(640));
  assert.ok(cryoValues.includes(180));
  assert.ok(context.maxScheduledGain() <= 0.22);
});

test('uses the specified insect frequency signatures and keeps the delayed casing branch quiet', async () => {
  const globalObject = fakeGlobal();
  const audio = new AudioController({ globalObject });
  await audio.unlock();
  const context = globalObject.context;

  audio.play('spawn');
  const spawnFrequencies = context.oscillators.flatMap(({ frequency }) => frequency.automation.map(({ value }) => value));
  assert.ok(spawnFrequencies.includes(150));
  assert.ok(spawnFrequencies.includes(220));
  assert.ok(spawnFrequencies.includes(1800));

  audio.play('elite-spawn');
  const eliteFrequencies = context.oscillators.slice(2).flatMap(({ frequency }) => frequency.automation.map(({ value }) => value));
  assert.ok(eliteFrequencies.includes(70));
  assert.ok(eliteFrequencies.includes(120));

  const casingGainOffset = context.gains.length;
  const casingSourceOffset = context.oscillators.length;
  audio.play('casing');
  const casing = context.oscillators[casingSourceOffset];
  const casingFrequencyValues = casing.frequency.automation.map(({ value }) => value);
  assert.deepEqual(casingFrequencyValues, [2400, 1700]);
  assert.ok(casing.startCalls[0] > context.currentTime, 'the casing tick is context-timed after the shot');
  assert.ok(
    Math.max(...context.gains.slice(casingGainOffset).flatMap(({ gain }) => gain.automation.map(({ value }) => value))) <= 0.035
  );

  audio.play('critical-hit');
  assert.ok(context.filters.some(({ frequency }) => frequency.automation.some(({ value }) => value === 2800)));
  assert.ok(context.oscillators.some(({ frequency }) => {
    const values = frequency.automation.map(({ value }) => value);
    return values[0] === 420 && values.at(-1) === 180;
  }));

  audio.play('miss');
  assert.ok(context.filters.some(({ frequency }) => frequency.automation.some(({ value }) => value === 1200)));
});

test('mute cancels pending JavaScript cues across mute and unmute', async () => {
  const globalObject = fakeGlobal();
  const audio = new AudioController({ globalObject });
  await audio.unlock();
  const context = globalObject.context;

  audio.play('reload');
  const immediateNodeCount = context.createdNodeCount();
  assert.equal(globalObject.pendingTimerCount(), 1);
  assert.deepEqual(globalObject.pendingTimerDelays(), [220]);

  audio.setEnabled(false);
  audio.setEnabled(true);

  assert.equal(globalObject.pendingTimerCount(), 0);
  assert.equal(globalObject.runNextTimer(), false);
  assert.equal(context.createdNodeCount(), immediateNodeCount);
});

test('mute and destroy cancel the delayed shot casing and at most two sustained threat buzzes', async (t) => {
  for (const action of ['mute', 'destroy']) {
    await t.test(action, async () => {
      const globalObject = fakeGlobal();
      const audio = new AudioController({ globalObject });
      await audio.unlock();
      const context = globalObject.context;

      audio.play('shoot');
      assert.equal(globalObject.pendingTimerCount(), 1, 'shoot queues one delayed casing bounce tick');
      const buzzOffset = context.oscillators.length;
      audio.syncThreatBuzz([
        { id: 1, distance: 0.7, yaw: -30, type: 'stinger' },
        { id: 2, distance: 0.25, yaw: 40, type: 'swarmer' },
        { id: 3, distance: 0.45, yaw: 10, type: 'bulwark' }
      ], 5);
      const buzzSources = context.oscillators.slice(buzzOffset);
      assert.equal(buzzSources.length, 2, 'only the two nearest insects own sustained sources');

      audio.syncThreatBuzz([
        { id: 2, distance: 0.2, yaw: 42, type: 'swarmer' },
        { id: 3, distance: 0.4, yaw: 12, type: 'bulwark' }
      ], 6);
      assert.equal(context.oscillators.slice(buzzOffset).length, 2, 'stable threats reuse their sources each frame');

      if (action === 'mute') audio.setEnabled(false);
      else audio.destroy();

      assert.equal(globalObject.pendingTimerCount(), 0);
      assert.equal(globalObject.runNextTimer(), false);
      assert.ok(buzzSources.every(({ stopCalls }) => stopCalls.at(-1) === undefined));
      assert.ok(buzzSources.every(({ disconnectCalls }) => disconnectCalls === 1));
      assert.doesNotThrow(() => audio.syncThreatBuzz([], 0));
      assert.doesNotThrow(() => audio.syncThreatBuzz([], 0));
      assert.equal(context.oscillators.slice(buzzOffset).length, 2, 'empty synchronization is idempotent');
    });
  }
});

test('contains malformed threat telemetry while preserving the two-source buzz lifecycle', async () => {
  const globalObject = fakeGlobal();
  const audio = new AudioController({ globalObject });
  await audio.unlock();
  const context = globalObject.context;

  const throwingThreat = {};
  for (const property of ['id', 'distance', 'yaw', 'type', 'elite']) {
    Object.defineProperty(throwingThreat, property, {
      configurable: true,
      get() { throw new Error(`${property} unavailable`); }
    });
  }
  const typeAndEliteThrow = {
    id: 'type-and-elite',
    distance: 0.2,
    yaw: 20,
    get type() { throw new Error('type unavailable'); },
    get elite() { throw new Error('elite unavailable'); }
  };
  const yawThrow = {
    id: 'yaw',
    distance: 0.1,
    get yaw() { throw new Error('yaw unavailable'); },
    type: 'stinger'
  };
  const distanceThrow = {
    id: 'distance',
    get distance() { throw new Error('distance unavailable'); },
    yaw: 0,
    type: 'swarmer'
  };
  const sparseThreats = new Array(10);
  sparseThreats[1] = throwingThreat;
  sparseThreats[2] = new Proxy({}, { get() { throw new Error('revoked-like threat'); } });
  sparseThreats[3] = { id: {}, distance: 0, yaw: 0, type: 'stinger' };
  sparseThreats[4] = { id: 'symbolic', distance: Symbol('distance'), yaw: Symbol('yaw'), type: 'bulwark' };
  sparseThreats[5] = distanceThrow;
  sparseThreats[6] = yawThrow;
  sparseThreats[8] = typeAndEliteThrow;

  assert.doesNotThrow(() => audio.syncThreatBuzz(sparseThreats, Symbol('view yaw')));
  assert.equal(audio.threatBuzz.size, 2);
  assert.deepEqual([...audio.threatBuzz.keys()], ['yaw', 'type-and-elite']);
  assert.equal(context.startedSourceCount(), 2);

  assert.doesNotThrow(() => audio.syncThreatBuzz([yawThrow, typeAndEliteThrow], Symbol('view yaw')));
  assert.equal(context.startedSourceCount(), 2, 'stable valid ids still reuse their owned sources');

  const throwingArrayProxy = new Proxy([], {
    get(target, property, receiver) {
      if (property === Symbol.iterator) throw new Error('iteration unavailable');
      return Reflect.get(target, property, receiver);
    }
  });
  assert.doesNotThrow(() => audio.syncThreatBuzz(throwingArrayProxy, Symbol('view yaw')));
  assert.equal(audio.threatBuzz.size, 0);
  assert.equal(audio.activeSources.size, 0);

  const revocable = Proxy.revocable([], {});
  revocable.revoke();
  assert.doesNotThrow(() => audio.syncThreatBuzz(revocable.proxy, Symbol('view yaw')));
  assert.ok(context.oscillators.every(({ disconnectCalls }) => disconnectCalls === 1));
  audio.destroy();
});

test('mute and destroy stop and disconnect every node in context-timed voices', async (t) => {
  for (const action of ['mute', 'destroy']) {
    await t.test(action, async () => {
      const globalObject = fakeGlobal();
      const audio = new AudioController({ globalObject });
      await audio.unlock();
      const context = globalObject.context;
      audio.play('spawn');

      const sources = [...context.oscillators, ...context.bufferSources];
      const dependentNodes = [...context.gains, ...context.filters];
      assert.ok(sources.length > 0);
      assert.ok(dependentNodes.length > 0);

      if (action === 'mute') audio.setEnabled(false);
      else audio.destroy();

      for (const source of sources) {
        assert.equal(source.stopCalls.at(-1), undefined, `${action} stops a scheduled source immediately`);
        assert.equal(source.disconnectCalls, 1, `${action} disconnects a scheduled source`);
      }
      for (const node of dependentNodes) {
        assert.equal(node.disconnectCalls, 1, `${action} disconnects dependent audio nodes`);
      }
      assert.equal(audio.activeSources.size, 0);

      const disconnectCounts = [...sources, ...dependentNodes].map((node) => node.disconnectCalls);
      if (action === 'mute') audio.setEnabled(false);
      else audio.destroy();
      sources[0].onended?.();
      assert.deepEqual(
        [...sources, ...dependentNodes].map((node) => node.disconnectCalls),
        disconnectCounts,
        `${action} cleanup is idempotent`
      );
      if (action === 'destroy') assert.equal(context.closed, true);
    });
  }
});

test('partial tone creation and source start or stop failures clean up without escaping', async (t) => {
  await t.test('gain creation throws after oscillator creation', async () => {
    const globalObject = fakeGlobal();
    const audio = new AudioController({ globalObject });
    await audio.unlock();
    const context = globalObject.context;
    context.createGain = () => { throw new Error('gain unavailable'); };

    assert.doesNotThrow(() => audio.tone());
    assert.equal(context.oscillators[0].disconnectCalls, 1);
    assert.equal(audio.activeSources.size, 0);
  });

  for (const method of ['start', 'stop']) {
    await t.test(`${method} throws`, async () => {
      const globalObject = fakeGlobal();
      const audio = new AudioController({ globalObject });
      await audio.unlock();
      const context = globalObject.context;
      const createOscillator = context.createOscillator.bind(context);
      context.createOscillator = () => {
        const oscillator = createOscillator();
        oscillator[method] = function failingSourceMethod(time) {
          this[`${method}Calls`].push(time);
          throw new Error(`${method} unavailable`);
        };
        return oscillator;
      };

      assert.doesNotThrow(() => audio.tone());
      assert.equal(context.oscillators[0].disconnectCalls, 1);
      assert.equal(context.gains[0].disconnectCalls, 1);
      assert.equal(audio.activeSources.size, 0);
    });
  }
});

test('partial noise creation and buffer-source start or stop failures clean up without escaping', async (t) => {
  await t.test('filter creation throws after source creation', async () => {
    const globalObject = fakeGlobal();
    const audio = new AudioController({ globalObject });
    await audio.unlock();
    const context = globalObject.context;
    context.createBiquadFilter = () => { throw new Error('filter creation failed'); };

    assert.doesNotThrow(() => audio.noise());
    assert.equal(context.bufferSources[0].disconnectCalls, 1);
    assert.equal(audio.activeSources.size, 0);
  });

  for (const method of ['start', 'stop']) {
    await t.test(`${method} throws`, async () => {
      const globalObject = fakeGlobal();
      const audio = new AudioController({ globalObject });
      await audio.unlock();
      const context = globalObject.context;
      const createBufferSource = context.createBufferSource.bind(context);
      context.createBufferSource = () => {
        const source = createBufferSource();
        source[method] = function failingSourceMethod(time) {
          this[`${method}Calls`].push(time);
          throw new Error(`${method} unavailable`);
        };
        return source;
      };

      assert.doesNotThrow(() => audio.noise());
      assert.equal(context.bufferSources[0].disconnectCalls, 1);
      assert.equal(context.filters[0].disconnectCalls, 1);
      assert.equal(context.gains[0].disconnectCalls, 1);
      assert.equal(audio.activeSources.size, 0);
    });
  }
});

test('cleanup guards stop and disconnect independently', async () => {
  const globalObject = fakeGlobal();
  const audio = new AudioController({ globalObject });
  await audio.unlock();
  const context = globalObject.context;
  const createOscillator = context.createOscillator.bind(context);
  context.createOscillator = () => {
    const oscillator = createOscillator();
    oscillator.stop = function conditionallyFailingStop(time) {
      this.stopCalls.push(time);
      if (time === undefined) throw new Error('immediate stop rejected');
    };
    oscillator.disconnect = function failingDisconnect() {
      this.disconnectCalls += 1;
      throw new Error('disconnect rejected');
    };
    return oscillator;
  };

  audio.tone();
  assert.doesNotThrow(() => audio.setEnabled(false));
  assert.equal(context.oscillators[0].disconnectCalls, 1);
  assert.equal(context.gains[0].disconnectCalls, 1);
  assert.equal(audio.activeSources.size, 0);
});

test('unsupported and throwing Web Audio APIs preserve safe fallbacks', async (t) => {
  await t.test('missing AudioContext', async () => {
    const audio = new AudioController({ globalObject: {} });
    assert.equal(await audio.unlock(), false);
    assert.doesNotThrow(() => audio.play('shoot'));
  });

  for (const method of ['createBuffer', 'createBufferSource']) {
    await t.test(`missing ${method}`, async () => {
      const globalObject = fakeGlobal();
      const audio = new AudioController({ globalObject });
      await audio.unlock();
      const context = globalObject.context;
      context[method] = undefined;

      assert.doesNotThrow(() => audio.play('shoot'));
      assert.ok(context.oscillators.every((oscillator) => oscillator.startCalls.length === 1));
      assert.equal(context.bufferSources.length, 0);
    });
  }

  await t.test('missing optional filter connects the source through its envelope', async () => {
    const globalObject = fakeGlobal();
    const audio = new AudioController({ globalObject });
    await audio.unlock();
    const context = globalObject.context;
    context.createBiquadFilter = undefined;

    assert.doesNotThrow(() => audio.noise());
    assert.equal(context.bufferSources[0].connections[0], context.gains[0]);
    assert.equal(context.gains[0].connections[0], context.destination);
    assert.equal(context.bufferSources[0].startCalls.length, 1);
  });

  await t.test('throwing buffer creation leaves oscillator fallback playing', async () => {
    const globalObject = fakeGlobal();
    const audio = new AudioController({ globalObject });
    await audio.unlock();
    const context = globalObject.context;
    context.createBuffer = () => { throw new Error('buffer allocation failed'); };

    assert.doesNotThrow(() => audio.play('shoot'));
    assert.ok(context.oscillators.every((oscillator) => oscillator.startCalls.length === 1));
    assert.equal(context.bufferSources.length, 0);
  });

  for (const pannerFailure of ['missing', 'throwing']) {
    await t.test(`${pannerFailure} StereoPanner keeps the threat buzz connected`, async () => {
      const globalObject = fakeGlobal();
      const audio = new AudioController({ globalObject });
      await audio.unlock();
      const context = globalObject.context;
      context.createStereoPanner = pannerFailure === 'missing'
        ? undefined
        : () => { throw new Error('stereo panning unavailable'); };

      assert.doesNotThrow(() => audio.syncThreatBuzz([{ id: 7, distance: 0.2, yaw: 35 }], 0));
      assert.equal(context.startedSourceCount(), 1);
      assert.equal(context.gains.at(-1).connections[0], context.destination);
      audio.syncThreatBuzz([], 0);
    });
  }
});

test('destroy cancels timers, closes the context, and suppresses future sound', async () => {
  const globalObject = fakeGlobal();
  const audio = new AudioController({ globalObject });
  await audio.unlock();
  const context = globalObject.context;

  audio.play('reload');
  assert.equal(globalObject.pendingTimerCount(), 1);
  audio.destroy();

  assert.equal(context.closed, true);
  assert.equal(audio.timers.size, 0);
  assert.equal(globalObject.pendingTimerCount(), 0);
  const destroyedNodeCount = context.createdNodeCount();
  audio.play('shoot');
  assert.equal(context.createdNodeCount(), destroyedNodeCount);
});
