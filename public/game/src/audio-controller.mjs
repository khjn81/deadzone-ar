const HAPTIC_PATTERNS = Object.freeze({
  shoot: 12,
  empty: 20,
  reload: [8, 55, 8],
  hit: 16,
  'critical-hit': [14, 22, 18],
  kill: [12, 18, 28],
  'player-hit': [35, 25, 45],
  wave: [18, 45, 18],
  'mission-end': [28, 45, 28, 45, 55]
});

function clampGain(value) {
  return Math.min(0.22, Math.max(0.0001, Number(value) || 0.0001));
}

function finiteNumber(value, fallback = 0) {
  let number;
  try {
    number = Number(value);
  } catch {
    return fallback;
  }
  return Number.isFinite(number) ? number : fallback;
}

function readProperty(value, property, fallback) {
  try {
    return value?.[property] ?? fallback;
  } catch {
    return fallback;
  }
}

function validThreatId(id) {
  if (typeof id === 'number') return Number.isFinite(id);
  return typeof id === 'string' || typeof id === 'bigint' || typeof id === 'symbol';
}

function snapshotThreat(threat) {
  if ((typeof threat !== 'object' && typeof threat !== 'function') || threat === null) return null;
  const id = readProperty(threat, 'id', null);
  const distance = finiteNumber(readProperty(threat, 'distance', 1), 1);
  const yaw = finiteNumber(readProperty(threat, 'yaw', 0), 0);
  const typeValue = readProperty(threat, 'type', '');
  const elite = readProperty(threat, 'elite', false) === true;
  if (!validThreatId(id)) return null;
  return {
    id,
    distance,
    yaw,
    type: typeof typeValue === 'string' ? typeValue : '',
    elite
  };
}

function snapshotThreatArray(threats) {
  try {
    if (!Array.isArray(threats)) return [];
    return Array.from(threats);
  } catch {
    return [];
  }
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function yawDelta(targetYaw, viewYaw) {
  return ((finiteNumber(targetYaw) - finiteNumber(viewYaw) + 540) % 360) - 180;
}

function setParam(param, value, time) {
  try {
    param?.setValueAtTime?.(value, time);
  } catch (_error) {
    // Continuous spatial feedback is optional on partial Web Audio implementations.
  }
}

export class AudioController {
  constructor({ globalObject = globalThis } = {}) {
    this.globalObject = globalObject;
    this.context = null;
    this.enabled = true;
    this.timers = new Set();
    this.activeSources = new Set();
    this.sourceRecords = new Map();
    this.threatBuzz = new Map();
    this.destroyed = false;
  }

  async unlock() {
    if (!this.enabled || this.destroyed) return false;
    try {
      if (!this.context) {
        const Context = this.globalObject?.AudioContext || this.globalObject?.webkitAudioContext;
        if (typeof Context !== 'function') return false;
        this.context = new Context();
      }
      if (this.context.state === 'suspended') await this.context.resume?.();
      return this.context.state !== 'closed';
    } catch (_error) {
      this.context = null;
      return false;
    }
  }

  setEnabled(value) {
    if (this.destroyed) return;
    this.enabled = Boolean(value);
    if (!this.enabled) {
      this.cancelScheduledTimers();
      this.stopActiveSources();
    }
  }

  cancelScheduledTimers() {
    const clearTimer = typeof this.globalObject?.clearTimeout === 'function'
      ? this.globalObject.clearTimeout.bind(this.globalObject)
      : clearTimeout;
    for (const timer of this.timers) {
      try {
        clearTimer(timer);
      } catch (_error) {
        // Optional feedback cleanup must not interrupt the game.
      }
    }
    this.timers.clear();
  }

  cleanupSource(record, { stop = false } = {}) {
    if (!record || record.cleaned) return;
    record.cleaned = true;
    const source = record.source;
    if (source) {
      this.activeSources.delete(source);
      this.sourceRecords.delete(source);
    }
    if (record.threatId !== undefined && this.threatBuzz.get(record.threatId) === record) {
      this.threatBuzz.delete(record.threatId);
    }
    if (stop && source) {
      try {
        source.stop?.();
      } catch (_error) {
        // A source can reject stop before start or after it has already ended.
      }
    }
    for (const node of new Set(record.nodes)) {
      try {
        node?.disconnect?.();
      } catch (_error) {
        // Disconnect each node independently so one unsupported node cannot leak the rest.
      }
    }
  }

  stopActiveSources() {
    for (const source of [...this.activeSources]) {
      const record = this.sourceRecords.get(source)
        || { source, nodes: [source], cleaned: false };
      this.cleanupSource(record, { stop: true });
    }
    this.activeSources.clear();
    this.sourceRecords.clear();
    this.threatBuzz.clear();
  }

  schedule(callback, delay) {
    const setTimer = typeof this.globalObject?.setTimeout === 'function'
      ? this.globalObject.setTimeout.bind(this.globalObject)
      : setTimeout;
    try {
      const timer = setTimer(() => {
        this.timers.delete(timer);
        if (this.enabled && !this.destroyed) callback();
      }, delay);
      this.timers.add(timer);
    } catch (_error) {
      // Timed layers are optional when the host timer API is unavailable.
    }
  }

  tone({
    frequency = 220,
    endFrequency = frequency,
    duration = 0.08,
    type = 'sine',
    gain = 0.08,
    delay = 0
  } = {}) {
    const context = this.context;
    if (!this.enabled || this.destroyed || !context?.createOscillator || !context?.createGain) return;

    const record = { source: null, nodes: [], cleaned: false };
    try {
      const oscillator = context.createOscillator();
      record.source = oscillator;
      record.nodes.push(oscillator);
      const envelope = context.createGain();
      record.nodes.push(envelope);
      const start = context.currentTime + Math.max(0, delay);
      const end = start + Math.max(0.025, duration);
      const safeGain = clampGain(gain);
      oscillator.type = type;
      oscillator.frequency.setValueAtTime(Math.max(20, frequency), start);
      oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, endFrequency), end);
      envelope.gain.setValueAtTime(0.0001, start);
      envelope.gain.linearRampToValueAtTime(safeGain, start + Math.min(0.012, duration * 0.25));
      envelope.gain.exponentialRampToValueAtTime(0.0001, end);
      oscillator.connect(envelope);
      envelope.connect(context.destination);
      this.activeSources.add(oscillator);
      this.sourceRecords.set(oscillator, record);
      oscillator.onended = () => this.cleanupSource(record);
      oscillator.start(start);
      oscillator.stop(end + 0.01);
    } catch (_error) {
      this.cleanupSource(record, { stop: true });
      // Audio is feedback only; unsupported node behavior must never stop play.
    }
  }

  noise({
    duration = 0.06,
    filterType = 'bandpass',
    frequency = 1200,
    Q = 0.7,
    gain = 0.05,
    delay = 0
  } = {}) {
    const context = this.context;
    if (!this.enabled || this.destroyed || !context?.createBuffer || !context?.createBufferSource || !context?.createGain) return;

    const record = { source: null, nodes: [], cleaned: false };
    try {
      const safeDuration = Math.max(0.025, duration);
      const sampleRate = Math.max(1, Number(context.sampleRate) || 44100);
      const buffer = context.createBuffer(1, Math.ceil(sampleRate * safeDuration), sampleRate);
      const data = buffer.getChannelData(0);
      const source = context.createBufferSource();
      record.source = source;
      record.nodes.push(source);
      const filter = context.createBiquadFilter?.();
      if (filter) record.nodes.push(filter);
      const envelope = context.createGain();
      record.nodes.push(envelope);
      const start = context.currentTime + Math.max(0, delay);
      const end = start + safeDuration;
      const safeGain = clampGain(gain);

      for (let index = 0; index < data.length; index += 1) data[index] = Math.random() * 2 - 1;
      source.buffer = buffer;
      filter?.frequency?.setValueAtTime(Math.max(20, frequency), start);
      filter?.Q?.setValueAtTime(Math.max(0.0001, Q), start);
      if (filter) filter.type = filterType;
      envelope.gain.setValueAtTime(0.0001, start);
      envelope.gain.exponentialRampToValueAtTime(safeGain, start + Math.min(0.008, safeDuration * 0.2));
      envelope.gain.exponentialRampToValueAtTime(0.0001, end);
      source.connect(filter || envelope);
      if (filter) filter.connect(envelope);
      envelope.connect(context.destination);
      this.activeSources.add(source);
      this.sourceRecords.set(source, record);
      source.onended = () => this.cleanupSource(record);
      source.start(start);
      source.stop(end + 0.01);
    } catch (_error) {
      this.cleanupSource(record, { stop: true });
      // Audio is feedback only; unsupported node behavior must never stop play.
    }
  }

  play(cue) {
    if (cue === 'mission-end') this.stopThreatBuzz();
    if (!this.enabled || this.destroyed || !this.context) return;

    switch (cue) {
      case 'spawn':
        this.tone({ frequency: 150, endFrequency: 220, duration: 0.24, type: 'sawtooth', gain: 0.075 });
        this.tone({ frequency: 220, endFrequency: 150, duration: 0.2, type: 'triangle', gain: 0.045, delay: 0.018 });
        this.tone({ frequency: 1800, endFrequency: 1450, duration: 0.045, type: 'square', gain: 0.032, delay: 0.028 });
        break;
      case 'elite-spawn':
        this.tone({ frequency: 70, endFrequency: 42, duration: 0.46, type: 'sawtooth', gain: 0.14 });
        this.tone({ frequency: 120, endFrequency: 165, duration: 0.38, type: 'triangle', gain: 0.065 });
        this.tone({ frequency: 1650, endFrequency: 1150, duration: 0.04, type: 'square', gain: 0.038, delay: 0.075 });
        this.tone({ frequency: 2250, endFrequency: 1550, duration: 0.035, type: 'square', gain: 0.032, delay: 0.155 });
        break;
      case 'shoot':
        this.tone({ frequency: 115, endFrequency: 42, duration: 0.085, type: 'square', gain: 0.19 });
        this.tone({ frequency: 240, endFrequency: 88, duration: 0.052, type: 'sawtooth', gain: 0.065 });
        this.noise({ duration: 0.035, frequency: 2600, Q: 0.9, gain: 0.055 });
        this.schedule(() => this.play('casing'), 260);
        break;
      case 'rail':
        this.tone({ frequency: 880, endFrequency: 120, duration: 0.18, type: 'sawtooth', gain: 0.15 });
        this.tone({ frequency: 1320, endFrequency: 440, duration: 0.1, type: 'square', gain: 0.06, delay: 0.012 });
        this.noise({ duration: 0.075, frequency: 3600, Q: 1.4, gain: 0.055 });
        this.schedule(() => this.play('casing'), 260);
        break;
      case 'cryo':
        this.tone({ frequency: 640, endFrequency: 180, duration: 0.22, type: 'triangle', gain: 0.095 });
        this.tone({ frequency: 1800, endFrequency: 950, duration: 0.16, type: 'sine', gain: 0.045, delay: 0.025 });
        this.noise({ duration: 0.1, filterType: 'bandpass', frequency: 2350, Q: 2.4, gain: 0.032 });
        break;
      case 'casing':
        this.tone({ frequency: 2400, endFrequency: 1700, duration: 0.065, type: 'triangle', gain: 0.035, delay: 0.045 });
        break;
      case 'empty':
        this.tone({ frequency: 155, endFrequency: 125, duration: 0.045, type: 'square', gain: 0.055 });
        break;
      case 'reload':
        this.tone({ frequency: 205, endFrequency: 150, duration: 0.045, type: 'triangle', gain: 0.07 });
        this.schedule(() => this.tone({ frequency: 315, endFrequency: 235, duration: 0.055, type: 'triangle', gain: 0.075 }), 220);
        break;
      case 'hit':
        this.noise({ duration: 0.042, filterType: 'bandpass', frequency: 1900, Q: 1.8, gain: 0.06 });
        this.noise({ duration: 0.07, filterType: 'lowpass', frequency: 260, Q: 0.55, gain: 0.043, delay: 0.006 });
        break;
      case 'critical-hit':
        this.noise({ duration: 0.035, filterType: 'bandpass', frequency: 2800, Q: 2.2, gain: 0.068 });
        this.tone({ frequency: 420, endFrequency: 180, duration: 0.11, type: 'sawtooth', gain: 0.075 });
        break;
      case 'kill':
        this.tone({ frequency: 220, endFrequency: 20, duration: 0.18, type: 'sawtooth', gain: 0.065 });
        this.noise({ duration: 0.075, filterType: 'lowpass', frequency: 520, Q: 0.8, gain: 0.052, delay: 0.025 });
        break;
      case 'miss':
        this.noise({ duration: 0.042, filterType: 'bandpass', frequency: 1200, Q: 1.4, gain: 0.042 });
        this.tone({ frequency: 1250, endFrequency: 860, duration: 0.038, type: 'triangle', gain: 0.022 });
        break;
      case 'player-hit':
        this.tone({ frequency: 92, endFrequency: 41, duration: 0.13, type: 'sawtooth', gain: 0.17 });
        break;
      case 'wave':
        this.tone({ frequency: 280, endFrequency: 390, duration: 0.12, type: 'square', gain: 0.06 });
        this.schedule(() => this.tone({ frequency: 390, endFrequency: 520, duration: 0.14, type: 'square', gain: 0.055 }), 145);
        break;
      case 'mission-end':
        this.tone({ frequency: 190, endFrequency: 95, duration: 0.42, type: 'sawtooth', gain: 0.09 });
        this.tone({ frequency: 380, endFrequency: 210, duration: 0.36, type: 'triangle', gain: 0.05, delay: 0.08 });
        break;
      default:
        break;
    }
  }

  updateThreatBuzz(record, threat, viewYaw) {
    const context = this.context;
    if (!record || !context) return;
    const baseFrequency = {
      swarmer: 220,
      stinger: 185,
      bulwark: 150,
      queen: 160
    }[threat?.type] || (threat?.elite ? 160 : 185);
    const distance = clamp(finiteNumber(threat?.distance, 1), 0, 1);
    const gain = clampGain(0.012 + (1 - distance) * 0.026 + (threat?.elite ? 0.006 : 0));
    const pan = Math.sin(clamp(yawDelta(threat?.yaw, viewYaw), -90, 90) * Math.PI / 180);
    const now = finiteNumber(context.currentTime);
    setParam(record.source?.frequency, baseFrequency, now);
    setParam(record.envelope?.gain, gain, now);
    setParam(record.panner?.pan, pan, now);
  }

  createThreatBuzz(threat, viewYaw) {
    const context = this.context;
    if (!this.enabled || this.destroyed || !context?.createOscillator || !context?.createGain) return null;
    const record = {
      source: null,
      envelope: null,
      panner: null,
      threatId: threat.id,
      nodes: [],
      cleaned: false
    };
    try {
      const oscillator = context.createOscillator();
      record.source = oscillator;
      record.nodes.push(oscillator);
      const envelope = context.createGain();
      record.envelope = envelope;
      record.nodes.push(envelope);
      oscillator.type = 'sawtooth';
      oscillator.connect(envelope);

      let connected = false;
      let attemptedPanner = null;
      if (typeof context.createStereoPanner === 'function') {
        try {
          attemptedPanner = context.createStereoPanner();
          attemptedPanner.connect(context.destination);
          envelope.connect(attemptedPanner);
          record.panner = attemptedPanner;
          record.nodes.push(attemptedPanner);
          connected = true;
        } catch (_error) {
          try {
            attemptedPanner?.disconnect?.();
          } catch (_disconnectError) {
            // The destination fallback below remains usable without panning.
          }
        }
      }
      if (!connected) envelope.connect(context.destination);

      this.updateThreatBuzz(record, threat, viewYaw);
      this.activeSources.add(oscillator);
      this.sourceRecords.set(oscillator, record);
      oscillator.onended = () => this.cleanupSource(record);
      oscillator.start(context.currentTime);
      return record;
    } catch (_error) {
      this.cleanupSource(record, { stop: true });
      return null;
    }
  }

  stopThreatBuzz() {
    for (const record of [...this.threatBuzz.values()]) {
      this.cleanupSource(record, { stop: true });
    }
    this.threatBuzz.clear();
  }

  syncThreatBuzz(threats, viewYaw) {
    if (!this.enabled || this.destroyed || !this.context || this.context.state === 'closed') {
      this.stopThreatBuzz();
      return;
    }
    const selected = [];
    const seen = new Set();
    const candidates = snapshotThreatArray(threats)
      .map(snapshotThreat)
      .filter(Boolean)
      .sort((left, right) => left.distance - right.distance);
    for (const threat of candidates) {
      if (seen.has(threat.id)) continue;
      seen.add(threat.id);
      selected.push(threat);
      if (selected.length === 2) break;
    }

    const selectedIds = new Set(selected.map(({ id }) => id));
    for (const [threatId, record] of [...this.threatBuzz]) {
      if (!selectedIds.has(threatId)) this.cleanupSource(record, { stop: true });
    }
    for (const threat of selected) {
      let record = this.threatBuzz.get(threat.id);
      if (!record) {
        record = this.createThreatBuzz(threat, viewYaw);
        if (record) this.threatBuzz.set(threat.id, record);
      } else {
        this.updateThreatBuzz(record, threat, viewYaw);
      }
    }
  }

  vibrate(cue) {
    if (!this.enabled) return;
    const pattern = HAPTIC_PATTERNS[cue];
    if (pattern === undefined) return;
    try {
      this.globalObject?.navigator?.vibrate?.(pattern);
    } catch (_error) {
      // Haptics are optional feedback.
    }
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.enabled = false;
    this.cancelScheduledTimers();
    this.stopActiveSources();
    try {
      this.context?.close?.();
    } catch (_error) {
      // Ignore shutdown errors from already-closed contexts.
    }
    this.context = null;
  }
}
