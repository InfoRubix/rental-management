import { useSyncExternalStore } from 'react';

/**
 * PWA helpers: service-worker registration and updates, the install prompt, and online/offline status.
 * The service worker is only registered in production builds (dev keeps normal, uncached reloads).
 */

type Listener = () => void;
function store<T>(initial: T) {
  let value = initial;
  const listeners = new Set<Listener>();
  return {
    get: () => value,
    set(v: T) {
      value = v;
      listeners.forEach((l) => l());
    },
    subscribe(l: Listener) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
}

// ---------------------------------------------------------------------------
// Updates
// ---------------------------------------------------------------------------

const waitingWorker = store<ServiceWorker | null>(null);
let reloadRequested = false;

function watch(reg: ServiceWorkerRegistration) {
  // A new version that finished installing while this page was open (or before it opened).
  if (reg.waiting && navigator.serviceWorker.controller) waitingWorker.set(reg.waiting);
  reg.addEventListener('updatefound', () => {
    const sw = reg.installing;
    if (!sw) return;
    sw.addEventListener('statechange', () => {
      // "installed" + an existing controller = an update (not the very first install).
      if (sw.state === 'installed' && navigator.serviceWorker.controller) waitingWorker.set(sw);
    });
  });
}

export function registerServiceWorker() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  // Reload once the new version has taken over — only when the user asked for the update.
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloadRequested) window.location.reload();
  });
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .then((reg) => {
        watch(reg);
        // Look for a new version when the app comes back to the foreground, and every 30 minutes.
        const check = () => void reg.update().catch(() => undefined);
        document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && check());
        setInterval(check, 30 * 60 * 1000);
      })
      .catch(() => undefined);
  });
}

/** Activates the waiting version; the page reloads when it has taken over. */
export function applyUpdate() {
  const sw = waitingWorker.get();
  if (!sw) return;
  reloadRequested = true;
  sw.postMessage({ type: 'SKIP_WAITING' });
}

export function dismissUpdate() {
  waitingWorker.set(null); // it will be offered again on the next visit
}

export function useUpdateAvailable(): boolean {
  return useSyncExternalStore(waitingWorker.subscribe, () => waitingWorker.get() !== null, () => false);
}

// ---------------------------------------------------------------------------
// Install
// ---------------------------------------------------------------------------

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const installEvent = store<BeforeInstallPromptEvent | null>(null);
const installed = store<boolean>(false);

export function isStandalone(): boolean {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function listenForInstall() {
  installed.set(isStandalone());
  // Chrome / Edge / Samsung Internet fire this when the app can be installed with a button.
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // we show our own Install button instead of the mini-infobar
    installEvent.set(e as BeforeInstallPromptEvent);
  });
  window.addEventListener('appinstalled', () => {
    installEvent.set(null);
    installed.set(true);
  });
}

/** Shows the browser's install dialog. Returns true if the user accepted. */
export async function promptInstall(): Promise<boolean> {
  const e = installEvent.get();
  if (!e) return false;
  await e.prompt();
  const { outcome } = await e.userChoice;
  installEvent.set(null); // the event can only be used once
  return outcome === 'accepted';
}

export function useInstallState(): { canPrompt: boolean; installed: boolean } {
  const canPrompt = useSyncExternalStore(installEvent.subscribe, () => installEvent.get() !== null, () => false);
  const isInstalled = useSyncExternalStore(installed.subscribe, installed.get, () => false);
  return { canPrompt, installed: isInstalled };
}

// ---------------------------------------------------------------------------
// Online / offline
// ---------------------------------------------------------------------------

function subscribeOnline(l: Listener) {
  window.addEventListener('online', l);
  window.addEventListener('offline', l);
  return () => {
    window.removeEventListener('online', l);
    window.removeEventListener('offline', l);
  };
}

export function useOnline(): boolean {
  return useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
}
