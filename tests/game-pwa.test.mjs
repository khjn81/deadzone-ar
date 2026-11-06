import { expectedCacheName } from '../scripts/cache-version.mjs';
import assert from 'node:assert/strict';
import { access, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const publicRoot = path.join(root, 'public');
const gameRoot = path.join(publicRoot, 'game');

async function exists(target) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

async function gameModules(directory = gameRoot) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return gameModules(target);
    return entry.name.endsWith('.mjs') ? [target] : [];
  }));
  return nested.flat();
}

async function loadPwaConfig() {
  const target = path.join(gameRoot, 'src', 'pwa-config.mjs');
  assert.equal(await exists(target), true, 'the offline shell must publish a PWA config module');
  return import(`${pathToFileURL(target).href}?test=${process.pid}-${Date.now()}`);
}

test('manifest is a portrait standalone game with valid local icons', async () => {
  const target = path.join(gameRoot, 'manifest.webmanifest');
  assert.equal(await exists(target), true, 'the installable game must publish a web manifest');
  const manifest = JSON.parse(await readFile(target, 'utf8'));

  assert.equal(manifest.start_url, '/game/index.html');
  assert.equal(manifest.scope, '/game/');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.orientation, 'portrait');
  assert.equal(manifest.background_color, '#050a08');
  assert.deepEqual(manifest.icons.map(({ src, sizes, type, purpose }) => ({ src, sizes, type, purpose })), [
    { src: '/game/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: '/game/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
  ]);

  for (const icon of manifest.icons) {
    assert.equal(new URL(icon.src, 'https://deadzone.invalid').origin, 'https://deadzone.invalid');
    const bytes = await readFile(path.join(publicRoot, icon.src));
    assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    const expectedSize = Number.parseInt(icon.sizes, 10);
    assert.equal(bytes.readUInt32BE(16), expectedSize);
    assert.equal(bytes.readUInt32BE(20), expectedSize);
  }
});

test('offline shell inventories every local game module and required asset exactly once', async () => {
  const { APP_SHELL, CACHE_NAME, CACHE_PREFIX } = await loadPwaConfig();

  assert.equal(CACHE_PREFIX, 'deadzone-swarm-');
  assert.equal(CACHE_NAME, await expectedCacheName(), 'cache revision must match every offline-shell byte');
  assert.equal(new Set(APP_SHELL).size, APP_SHELL.length, 'cache inventory must not contain duplicates');
  assert.ok(APP_SHELL.every((asset) => asset.startsWith('/game/') && !asset.includes('://')));

  const requiredAssets = [
    '/game/index.html',
    '/game/styles.css',
    '/game/manifest.webmanifest',
    '/game/icons/icon-192.png',
    '/game/icons/icon-512.png',
    '/game/assets/models/infected-swarmer.glb',
    '/game/assets/models/infected-swarmer.CC-BY-4.0.txt',
    '/game/assets/models/infected-stinger.glb',
    '/game/assets/models/infected-stinger.CC0-1.0.txt',
    '/game/assets/models/infected-bulwark.glb',
    '/game/assets/models/infected-bulwark.CC0-1.0.txt',
    '/game/assets/models/infected-queen.glb',
    '/game/assets/models/infected-queen.CC0-1.0.txt',
    '/game/src/vendor/THREE-LICENSE.txt',
  ];
  for (const asset of requiredAssets) assert.ok(APP_SHELL.includes(asset), `offline shell is missing ${asset}`);

  const speciesAssets = [
    'infected-stinger.glb',
    'infected-stinger.CC0-1.0.txt',
    'infected-bulwark.glb',
    'infected-bulwark.CC0-1.0.txt',
    'infected-queen.glb',
    'infected-queen.CC0-1.0.txt',
  ];
  for (const asset of speciesAssets) {
    const pathName = `/game/assets/models/${asset}`;
    assert.equal(APP_SHELL.filter((entry) => entry === pathName).length, 1, `offline shell must cache ${pathName} exactly once`);
  }

  const authoredModules = (await gameModules()).map((target) => (
    `/game/${path.relative(gameRoot, target).split(path.sep).join('/')}`
  ));
  for (const modulePath of authoredModules) {
    assert.ok(APP_SHELL.includes(modulePath), `offline shell is missing ${modulePath}`);
  }
  for (const asset of APP_SHELL) {
    const target = path.resolve(publicRoot, asset.slice(1));
    assert.ok(target.startsWith(`${publicRoot}${path.sep}`), `offline shell escapes public/: ${asset}`);
    assert.equal(await exists(target), true, `offline shell references a missing file: ${asset}`);
  }
});

test('service worker only handles same-origin GET requests inside the game scope', async () => {
  const workerPath = path.join(gameRoot, 'sw.js');
  assert.equal(await exists(workerPath), true, 'the installable game must publish its service worker');
  const listeners = new Map();
  const previousSelf = globalThis.self;
  const previousCaches = globalThis.caches;
  const previousFetch = globalThis.fetch;
  globalThis.self = {
    addEventListener(type, listener) { listeners.set(type, listener); },
    clients: { claim: async () => undefined },
    location: { origin: 'https://deadzone.invalid' },
    skipWaiting: async () => undefined,
  };
  globalThis.caches = {
    async open() {
      return {
        async match() { return undefined; },
        async put() {},
      };
    },
  };
  globalThis.fetch = async () => new Response('game asset');
  try {
    await import(`${pathToFileURL(workerPath).href}?test=${process.pid}-${Date.now()}`);
    const fetchListener = listeners.get('fetch');
    assert.equal(typeof fetchListener, 'function');

    const isHandled = async (url, method = 'GET') => {
      let handled = false;
      let responsePromise;
      fetchListener({
        request: new Request(url, { method }),
        respondWith(response) {
          handled = true;
          responsePromise = response;
        },
        waitUntil() {},
      });
      if (responsePromise) await responsePromise;
      return handled;
    };

    assert.equal(await isHandled('https://deadzone.invalid/game/index.html'), true);
    assert.equal(await isHandled('https://deadzone.invalid/game/src/app.mjs'), true);
    assert.equal(await isHandled('https://deadzone.invalid/game/index.html', 'POST'), false);
    assert.equal(await isHandled('https://deadzone.invalid/sign-in'), false);
    assert.equal(await isHandled('https://deadzone.invalid/og.png'), false);
    assert.equal(await isHandled('https://external.invalid/game/index.html'), false);
  } finally {
    globalThis.self = previousSelf;
    globalThis.caches = previousCaches;
    globalThis.fetch = previousFetch;
  }
});
