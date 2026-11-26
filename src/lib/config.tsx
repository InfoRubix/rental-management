import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { AppConfig } from '../../shared/types';
import { ApiError, apiFetch } from './api';
import { FullPageMessage } from '../components/ui';

const ConfigContext = createContext<AppConfig | null>(null);

const CONFIG_KEY = 'rm-config';

/** Settings from this tab's last load, so the app can start drawing without waiting for /config. */
function cachedConfig(): AppConfig | null {
  try {
    const raw = sessionStorage.getItem(CONFIG_KEY);
    return raw ? (JSON.parse(raw) as AppConfig) : null;
  } catch {
    return null;
  }
}

export function ConfigProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<AppConfig | null>(cachedConfig);
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    // Always refresh in the background (e.g. "today" changes at midnight); the cached copy only avoids a wait.
    apiFetch<AppConfig>('/config')
      .then((c) => {
        setConfig(c);
        try {
          sessionStorage.setItem(CONFIG_KEY, JSON.stringify(c));
        } catch {
          /* ignore */
        }
      })
      .catch((e) => {
        // Keep working with the cached copy if we have one; otherwise show the error.
        if (!cachedConfig()) setError(e instanceof ApiError ? e : new ApiError(0, 'ERROR', 'Could not load the app.'));
      });
  }, []);

  if (error) {
    return (
      <FullPageMessage title={error.code === 'CONFIG_ERROR' ? 'The app is not configured yet' : 'Cannot reach the server'}>
        <p>{error.message}</p>
        {error.code === 'CONFIG_ERROR' && <p className="muted">Administrators: see the README section “Environment variables”.</p>}
      </FullPageMessage>
    );
  }
  if (!config) return <FullPageMessage title="Loading…" />;
  return <ConfigContext.Provider value={config}>{children}</ConfigContext.Provider>;
}

export function useConfig(): AppConfig {
  const c = useContext(ConfigContext);
  if (!c) throw new Error('useConfig outside ConfigProvider');
  return c;
}

/** Base URL for links printed in QR codes / shared with customers. */
export function usePublicBaseUrl(): string {
  const c = useConfig();
  return c.publicBaseUrl ?? window.location.origin;
}

export function isLocalUrl(url: string): boolean {
  try {
    const h = new URL(url).hostname;
    return (
      h === 'localhost' ||
      h.endsWith('.localhost') ||
      h === '127.0.0.1' ||
      h === '[::1]' ||
      /^10\./.test(h) ||
      /^192\.168\./.test(h) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(h)
    );
  } catch {
    return true;
  }
}
