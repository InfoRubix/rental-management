import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { getConfig } from '../server/config';

/**
 * Loads pwa/sw.js into a fake service-worker scope and returns its fetch handler, so the caching rules
 * can be checked without a browser.
 */
function loadServiceWorker() {
  const handlers: Record<string, (e: unknown) => void> = {};
  const self = {
    location: { origin: 'https://rentals.example' },
    addEventListener: (type: string, fn: (e: unknown) => void) => (handlers[type] = fn),
    clients: { claim: async () => undefined },
    skipWaiting: () => undefined,
  };
  const src = readFileSync(new URL('../pwa/sw.js', import.meta.url), 'utf8')
    .replace("'__BUILD_ID__'", '"test"')
    .replace('__PRECACHE__', JSON.stringify(['/assets/index-abc.js', '/manifest.webmanifest']));
  new Function('self', 'caches', 'fetch', 'Response', 'Request', src)(self, {}, fetch, Response, Request);
  return (url: string, init: { method?: string; mode?: string } = {}) => {
    let handled = false;
    handlers.fetch!({
      request: { url, method: init.method ?? 'GET', mode: init.mode ?? 'cors' },
      respondWith: () => (handled = true),
    });
    return handled;
  };
}

describe('service worker caching rules', () => {
  const handles = loadServiceWorker();

  it('never handles (or caches) API calls, including sign-in and private records', () => {
    expect(handles('https://rentals.example/api/me')).toBe(false);
    expect(handles('https://rentals.example/api/my/requests')).toBe(false);
    expect(handles('https://rentals.example/api/admin/requests/abc')).toBe(false);
    expect(handles('https://rentals.example/api/items/x/image?v=1')).toBe(false);
    expect(handles('https://rentals.example/.netlify/functions/api/me')).toBe(false);
  });

  it('never handles other sites (Google sign-in, Firebase)', () => {
    expect(handles('https://identitytoolkit.googleapis.com/v1/accounts:lookup')).toBe(false);
    expect(handles('https://rentalmanagement-db.firebaseapp.com/__/auth/handler')).toBe(false);
  });

  it('never handles writes', () => {
    expect(handles('https://rentals.example/assets/index-abc.js', { method: 'POST' })).toBe(false);
  });

  it('handles page loads (offline fallback) and built static files', () => {
    expect(handles('https://rentals.example/item/abc', { mode: 'navigate' })).toBe(true);
    expect(handles('https://rentals.example/assets/index-abc.js')).toBe(true);
    expect(handles('https://rentals.example/icons/icon-192.png')).toBe(true);
    expect(handles('https://rentals.example/manifest.webmanifest')).toBe(true);
  });
});

describe('QR code base URL', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it('ignores a localhost PUBLIC_BASE_URL on a deployed site', () => {
    process.env.BACKEND_MODE = 'firebase';
    process.env.PUBLIC_BASE_URL = 'http://localhost:5173';
    process.env.AWS_LAMBDA_FUNCTION_NAME = 'api';
    delete process.env.DEV_STAFF_LOGIN;
    expect(getConfig().publicBaseUrl).toBeNull();
  });

  it('keeps a real deployed address', () => {
    process.env.BACKEND_MODE = 'firebase';
    process.env.PUBLIC_BASE_URL = 'https://rentals.example/';
    process.env.AWS_LAMBDA_FUNCTION_NAME = 'api';
    delete process.env.DEV_STAFF_LOGIN;
    expect(getConfig().publicBaseUrl).toBe('https://rentals.example');
  });
});
