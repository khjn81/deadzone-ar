import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const securityUrl = new URL('../worker/security-headers.mjs', import.meta.url);
securityUrl.searchParams.set('test', `${process.pid}-${Date.now()}`);
const { securityHeadersFor, withSecurityHeaders } = await import(securityUrl.href);

const baselineNames = [
  'cross-origin-opener-policy',
  'referrer-policy',
  'x-content-type-options',
  'x-frame-options',
];

test('every response receives the baseline isolation and sniffing headers', () => {
  const headers = securityHeadersFor(new URL('https://deadzone.invalid/'));

  assert.equal(headers instanceof Headers, true);
  assert.equal(headers.get('cross-origin-opener-policy'), 'same-origin');
  assert.equal(headers.get('referrer-policy'), 'no-referrer');
  assert.equal(headers.get('x-content-type-options'), 'nosniff');
  assert.equal(headers.get('x-frame-options'), 'DENY');
  assert.deepEqual(
    baselineNames.map((name) => headers.get(name)),
    ['same-origin', 'no-referrer', 'nosniff', 'DENY'],
  );
  assert.equal(headers.get('content-security-policy'), null);
  assert.equal(headers.get('permissions-policy'), null);
});

test('game responses allow only the capabilities required for local AR', () => {
  const headers = securityHeadersFor(new URL('https://deadzone.invalid/game/index.html'));
  const contentSecurityPolicy = headers.get('content-security-policy');
  const permissionsPolicy = headers.get('permissions-policy');

  assert.ok(contentSecurityPolicy);
  for (const directive of [
    "default-src 'self'",
    "script-src 'self'",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "connect-src 'self'",
    "media-src 'self' blob:",
    "font-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
  ]) {
    assert.match(contentSecurityPolicy, new RegExp(`(?:^|; )${directive.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:;|$)`));
  }

  assert.ok(permissionsPolicy);
  for (const directive of [
    'camera=(self)',
    'accelerometer=(self)',
    'gyroscope=(self)',
    'magnetometer=(self)',
    'fullscreen=(self)',
    'screen-wake-lock=(self)',
    'microphone=()',
    'geolocation=()',
  ]) {
    assert.match(permissionsPolicy, new RegExp(`(?:^|, )${directive.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:,|$)`));
  }
});

test('non-game paths do not receive camera or executable policy exceptions', () => {
  for (const pathname of ['/','/_next/static/chunk.js','/gameplay','/game']) {
    const headers = securityHeadersFor(new URL(`https://deadzone.invalid${pathname}`));
    assert.equal(headers.get('content-security-policy'), null, pathname);
    assert.equal(headers.get('permissions-policy'), null, pathname);
  }
});

test('header application preserves body, status, redirect location, and content type', async () => {
  const response = new Response('redirect body', {
    status: 302,
    headers: {
      location: '/game/index.html',
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
  const secured = withSecurityHeaders(response, new URL('https://deadzone.invalid/game/index.html'));

  assert.equal(secured.status, 302);
  assert.equal(secured.headers.get('location'), '/game/index.html');
  assert.equal(secured.headers.get('content-type'), 'text/plain; charset=utf-8');
  assert.equal(secured.headers.get('cache-control'), 'no-store');
  assert.equal(await secured.text(), 'redirect body');
});

test('image optimization responses keep their binary body and media type', async () => {
  const bytes = new Uint8Array([0, 1, 2, 3, 255]);
  const response = new Response(bytes, {
    status: 200,
    headers: { 'content-type': 'image/avif', etag: 'asset-1' },
  });
  const secured = withSecurityHeaders(response, new URL('https://deadzone.invalid/_vinext/image?w=256'));

  assert.equal(secured.status, 200);
  assert.equal(secured.headers.get('content-type'), 'image/avif');
  assert.equal(secured.headers.get('etag'), 'asset-1');
  assert.deepEqual([...new Uint8Array(await secured.arrayBuffer())], [...bytes]);
  assert.equal(secured.headers.get('content-security-policy'), null);
});

test('worker applies policy to both normal and image optimization branches', async () => {
  const source = await readFile(new URL('../worker/index.ts', import.meta.url), 'utf8');
  assert.match(source, /await handleImageOptimization\(/s);
  assert.match(source, /await handler\.fetch\(/s);
  assert.match(source, /return withSecurityHeaders\(response, url\);/g);
  assert.equal((source.match(/return withSecurityHeaders\(response, url\);/g) || []).length, 2);
});
