import { GLTFLoader, THREE, cloneSkeleton } from './vendor/three-runtime.mjs';
import { createThreeInsectScene } from './three-insect-scene.mjs';
import { createThreeCombatEffects } from './three-combat-effects.mjs';

const MAX_DPR = 1.5;
const num = (value, fallback = 1) => { try { const result = Number(value); return Number.isFinite(result) ? result : fallback; } catch { return fallback; } };
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const propertyOf = (source, key, fallback) => { try { return source == null ? fallback : source[key]; } catch { return fallback; } };
const EMPTY_FRAME = Object.freeze({});

function abortError() {
  try { return new DOMException('Three.js world layer creation was aborted', 'AbortError'); } catch {
    const error = new Error('Three.js world layer creation was aborted');
    error.name = 'AbortError';
    return error;
  }
}

export async function createThreeWorldLayer(canvas, options = {}) {
  if (!canvas) throw new TypeError('A canvas is required to create the Three.js world layer');
  const runtime = options.runtime || { THREE, GLTFLoader, cloneSkeleton };
  const T = runtime.THREE;
  let renderer, scene, camera, insects, effects;
  let destroyed = false, contextLost = false, shaderFailure = null, shaderErrorCount = 0, renderCount = 0, listener = false, rendererCleaned = false;
  let aborted = Boolean(options.signal?.aborted), abortListener = false;
  let viewport = { width: 1, height: 1 };
  const onContextLost = (event) => { event?.preventDefault?.(); contextLost = true; };
  const safely = (callback) => { try { callback?.(); } catch {} };
  const cleanup = () => {
    if (listener) { safely(() => canvas.removeEventListener?.('webglcontextlost', onContextLost, false)); listener = false; }
    if (abortListener) { safely(() => options.signal?.removeEventListener?.('abort', onAbort)); abortListener = false; }
    safely(() => insects?.destroy());
    safely(() => effects?.destroy());
    if (!rendererCleaned) {
      rendererCleaned = true;
      safely(() => renderer?.dispose());
      safely(() => renderer?.forceContextLoss?.());
    }
  };
  const onAbort = () => { aborted = true; destroyed = true; cleanup(); };
  function resize(width = canvas.clientWidth, height = canvas.clientHeight, dpr = options.pixelRatio) {
    if (destroyed) throw new Error('Three.js world layer has been destroyed');
    viewport = { width: Math.max(1, num(width)), height: Math.max(1, num(height)) };
    renderer.setPixelRatio(clamp(num(dpr, num(globalThis.devicePixelRatio, 1)), 1, MAX_DPR)); renderer.setSize(viewport.width, viewport.height, false);
    camera.left = -viewport.width / 2; camera.right = viewport.width / 2; camera.top = viewport.height / 2; camera.bottom = -viewport.height / 2; camera.updateProjectionMatrix?.();
  }
  try {
    if (aborted) throw abortError();
    renderer = new T.WebGLRenderer({ canvas, alpha: true, antialias: false, powerPreference: 'high-performance' });
    renderer.setClearColor(0x000000, 0); if (renderer.shadowMap) renderer.shadowMap.enabled = false; renderer.outputColorSpace = T.SRGBColorSpace;
    if (!renderer.debug || typeof renderer.debug !== 'object') renderer.debug = {};
    renderer.debug.checkShaderErrors = true;
    renderer.debug.onShaderError = (gl, program, vertex, fragment) => { shaderErrorCount += 1; const logs = [gl?.getProgramInfoLog?.(program), gl?.getShaderInfoLog?.(vertex), gl?.getShaderInfoLog?.(fragment)].filter(Boolean).join('\n'); shaderFailure ||= new Error(`Insect shader failed to compile or link${logs ? `: ${logs}` : ''}`); };
    scene = new T.Scene(); camera = new T.OrthographicCamera(-1, 1, 1, -1, 0.1, 50000); camera.position.set(0, 0, 1000); camera.lookAt(0, 0, 0);
    const fill = new T.HemisphereLight(0xd8dedd, 0x202522, 1); const key = new T.DirectionalLight(0xffd7ba, 1.7); key.position.set(-3, 4, 7); scene.add(fill, key);
    listener = true; canvas.addEventListener?.('webglcontextlost', onContextLost, false);
    if (options.signal?.addEventListener) { abortListener = true; options.signal.addEventListener('abort', onAbort, { once: true }); }
    resize();
    insects = await createThreeInsectScene(scene, runtime, options);
    if (aborted) throw abortError();
    if (contextLost) throw new Error('WebGL context lost while loading the insect model');
    effects = createThreeCombatEffects(scene, T);
  } catch (error) { cleanup(); throw error; }
  function render(frame = EMPTY_FRAME, timestamp = 0) {
    if (destroyed || contextLost || shaderFailure) return false;
    insects.renderLive(propertyOf(frame, 'insects', null), timestamp, viewport);
    insects.renderCorpses(propertyOf(frame, 'corpses', null), timestamp, viewport);
    effects.render(propertyOf(frame, 'effects', EMPTY_FRAME), viewport);
    shaderFailure = null; renderer.render(scene, camera); if (shaderFailure || contextLost) return false; renderCount += 1; return true;
  }
  function getDiagnostics() { return { ...insects.getDiagnostics(), ...effects.getDiagnostics(), programCount: Array.isArray(renderer?.info?.programs) ? renderer.info.programs.length : 0, shaderErrorCount, renderCount, ...(options.exposeDiagnostics === true ? { drawCalls: num(renderer?.info?.render?.calls, 0), triangles: num(renderer?.info?.render?.triangles, 0) } : {}), modelReady: !destroyed && Boolean(insects), destroyed, contextLost }; }
  function resetMission() { if (!destroyed) effects.resetMission(); }
  function destroy() { if (destroyed) return; destroyed = true; cleanup(); }
  return { resize, render, resetMission, getDiagnostics, destroy };
}
