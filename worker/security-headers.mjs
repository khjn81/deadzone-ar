const BASELINE_HEADERS = Object.freeze({
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
});

const GAME_CONTENT_SECURITY_POLICY = [
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
].join('; ');

const GAME_PERMISSIONS_POLICY = [
  'camera=(self)',
  'accelerometer=(self)',
  'gyroscope=(self)',
  'magnetometer=(self)',
  'fullscreen=(self)',
  'screen-wake-lock=(self)',
  'microphone=()',
  'geolocation=()',
].join(', ');

function toUrl(value) {
  if (value instanceof URL) return value;
  if (value instanceof Request) return new URL(value.url);
  return new URL(String(value), 'http://deadzone.invalid');
}

function isGamePath(value) {
  const url = toUrl(value);
  return url.protocol === 'http:' || url.protocol === 'https:'
    ? url.pathname.startsWith('/game/')
    : false;
}

/**
 * Build the immutable security policy for a request URL.
 *
 * The worker only serves same-origin requests, so a `/game/` pathname is the
 * scoped game surface. Returning a new Headers object on every call prevents
 * one response's headers from mutating a later response's policy.
 */
export function securityHeadersFor(requestUrl) {
  const headers = new Headers(BASELINE_HEADERS);
  if (isGamePath(requestUrl)) {
    headers.set('Content-Security-Policy', GAME_CONTENT_SECURITY_POLICY);
    headers.set('Permissions-Policy', GAME_PERMISSIONS_POLICY);
  }
  return headers;
}

/**
 * Apply policy headers without reading or buffering the response body.
 */
export function withSecurityHeaders(response, requestUrl) {
  if (!(response instanceof Response)) {
    throw new TypeError('withSecurityHeaders expects a Response');
  }

  const headers = new Headers(response.headers);
  for (const [name, value] of securityHeadersFor(requestUrl)) headers.set(name, value);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export const securityPolicy = Object.freeze({
  contentSecurityPolicy: GAME_CONTENT_SECURITY_POLICY,
  permissionsPolicy: GAME_PERMISSIONS_POLICY,
});
