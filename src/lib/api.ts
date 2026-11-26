import type { ApiErrorBody } from '../../shared/types';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fields?: Record<string, string>,
  ) {
    super(message);
  }
}

export interface FetchOptions {
  method?: string;
  body?: unknown;
  token?: string | null;
  signal?: AbortSignal;
}

/** LAN test sign-in passcode (npm run dev:lan). Sent only together with a "dev:" test token. */
let devPasscode: string | null = null;
export function setDevPasscode(p: string | null) {
  devPasscode = p;
}

export async function apiFetch<T>(path: string, opts: FetchOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  if (opts.token?.startsWith('dev:') && devPasscode) headers['x-dev-passcode'] = devPasscode;
  // Never pretend: while offline nothing is sent, so nothing can be (or be shown as) saved.
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new ApiError(0, 'OFFLINE', 'You’re offline. Nothing was sent or saved. Reconnect to the internet and try again.');
  }
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'),
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: opts.signal,
      // Availability and records must always be current: never reuse a stored copy.
      cache: 'no-store',
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new ApiError(
      0,
      'NETWORK',
      'Could not reach the server, so nothing was saved. Check your internet connection and try again.',
    );
  }
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // The backend always returns JSON. Anything else usually means the API isn't running.
    throw new ApiError(
      res.status,
      'BAD_RESPONSE',
      res.status === 404
        ? 'The backend API was not found. Start the app with "npm run dev" (see README).'
        : 'Unexpected response from the server.',
    );
  }
  if (!res.ok) {
    const err = (data as ApiErrorBody | null)?.error;
    throw new ApiError(res.status, err?.code ?? 'ERROR', err?.message ?? `Request failed (${res.status}).`, err?.fields);
  }
  return data as T;
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  return 'Something went wrong. Please try again.';
}
