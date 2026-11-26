import { createHash, randomInt } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { networkInterfaces } from 'node:os';
import { createServer, defineConfig, loadEnv, type Plugin, type ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';

/** 8 easy-to-type characters (no 0/O, 1/I/L). Printed only in this computer's terminal. */
function randomPasscode(): string {
  const A = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  return Array.from({ length: 8 }, () => A[randomInt(A.length)]).join('');
}

/** This computer's private Wi-Fi/LAN IPv4 address (prefers 192.168.x.x, then 10.x, then 172.16–31.x). */
function lanAddress(): string | null {
  const all = Object.values(networkInterfaces())
    .flat()
    .filter((n): n is NonNullable<typeof n> => !!n && n.family === 'IPv4' && !n.internal)
    .map((n) => n.address);
  return (
    all.find((a) => a.startsWith('192.168.')) ??
    all.find((a) => a.startsWith('10.')) ??
    all.find((a) => /^172\.(1[6-9]|2\d|3[01])\./.test(a)) ??
    null
  );
}

type HandlerModule = typeof import('./server/handler');

/** Passes /api/* requests to the same handler the Netlify Function uses. */
function apiMiddleware(load: () => Promise<HandlerModule>) {
  return async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    if (!req.url || !req.url.startsWith('/api/')) return next();
    try {
      const mod = await load();
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) {
        if (typeof v === 'string') headers.set(k, v);
        else if (Array.isArray(v)) headers.set(k, v.join(', '));
      }
      const method = req.method ?? 'GET';
      const request = new Request(`http://${req.headers.host ?? 'localhost'}${req.url}`, {
        method,
        headers,
        body: method === 'GET' || method === 'HEAD' || chunks.length === 0 ? undefined : Buffer.concat(chunks),
      });
      // socketAddress is the real TCP peer (cannot be forged, unlike the Host header). '' = unknown → not local.
      const response = await mod.handleApi(request, {
        ip: req.socket.remoteAddress ?? 'local',
        socketAddress: req.socket.remoteAddress ?? '',
      });
      res.statusCode = response.status;
      response.headers.forEach((value, key) => res.setHeader(key, value));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch (err) {
      console.error('[local-api] failed to handle request:', (err as Error).message);
      res.statusCode = 500;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ error: { code: 'DEV_SERVER_ERROR', message: 'Local API failed. See terminal.' } }));
    }
  };
}

/** Gives the backend the non-VITE_ variables from .env (server-side only; never sent to the browser). */
function loadServerEnv(mode: string, root: string) {
  const env = loadEnv(mode, root, '');
  for (const [k, v] of Object.entries(env)) if (process.env[k] === undefined) process.env[k] = v;
  process.env.RM_LOCAL_DEV = '1';
}

/**
 * Runs the same API code as the Netlify Function inside the Vite dev server, so
 * `npm run dev` starts the whole app (interface + backend) at http://localhost:5173.
 */
function localApi(): Plugin {
  return {
    name: 'rental-management-local-api',
    apply: 'serve',
    configureServer(server: ViteDevServer) {
      // Under `netlify dev` (mode "netlify") the real Netlify Function serves /api, so stay out of the way.
      if (server.config.mode === 'netlify') return;
      loadServerEnv(server.config.mode, server.config.root);
      const mode = process.env.BACKEND_MODE || 'firebase';

      // `npm run dev:lan` (Vite mode "lan"): reachable from phones on the same Wi-Fi.
      const lan = server.config.mode === 'lan';
      let lanUrl: string | null = null;
      if (lan) {
        process.env.RM_DEV_LAN = '1';
        if (!process.env.DEV_LAN_PASSCODE) process.env.DEV_LAN_PASSCODE = randomPasscode();
        const ip = process.env.DEV_LAN_HOST?.trim() || lanAddress();
        if (ip) {
          lanUrl = `http://${ip}:${server.config.server.port ?? 5173}`;
          // QR codes must open on the phones, so don't print localhost into them while testing on the LAN.
          if (!process.env.PUBLIC_BASE_URL || /\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/.test(process.env.PUBLIC_BASE_URL)) {
            process.env.PUBLIC_BASE_URL = lanUrl;
          }
        }
      }

      server.httpServer?.once('listening', () => {
        const project =
          mode === 'firebase'
            ? ` | Firebase project: ${process.env.FIREBASE_PROJECT_ID || '(not set)'}`
            : ' | data kept in memory only (not Firebase)';
        console.log(`\n  [api] Backend API running at /api | BACKEND_MODE=${mode}${project}\n`);
        if (lan) {
          const pc = process.env.DEV_LAN_PASSCODE!;
          console.log(
            [
              '  [lan] Phone testing on your Wi-Fi is ON',
              `  [lan]   Open on the phone:   ${lanUrl ?? '(could not detect this computer’s Wi-Fi address — set DEV_LAN_HOST)'}`,
              `  [lan]   QR codes point to:   ${process.env.PUBLIC_BASE_URL}`,
              process.env.DEV_STAFF_LOGIN === 'true' || mode === 'memory'
                ? `  [lan]   Test sign-in passcode: ${pc.length === 8 ? `${pc.slice(0, 4)}-${pc.slice(4)}` : pc}   (new every start; keep it private)`
                : '  [lan]   Test sign-in is off (DEV_STAFF_LOGIN is not true). Use Google sign-in.',
              '',
            ].join('\n'),
          );
        }
      });

      server.middlewares.use(apiMiddleware(() => server.ssrLoadModule('/server/handler.ts') as Promise<HandlerModule>));
    },
  };
}

/**
 * `npm run preview` serves the PRODUCTION build (with the service worker) and the real API, so the
 * installed-app behaviour can be tested locally before deploying.
 */
function previewApi(): Plugin {
  return {
    name: 'rental-management-preview-api',
    async configurePreviewServer(server) {
      loadServerEnv('production', server.config.root);
      // A small Vite instance only to load the TypeScript backend (no HMR, no config file → no recursion).
      const loader = await createServer({
        configFile: false,
        root: server.config.root,
        appType: 'custom',
        logLevel: 'error',
        server: { middlewareMode: true, hmr: false, ws: false },
      });
      server.middlewares.use(apiMiddleware(() => loader.ssrLoadModule('/server/handler.ts') as Promise<HandlerModule>));
      server.httpServer?.once('close', () => void loader.close());
    },
  };
}

/** Public files the service worker keeps for offline start-up (besides the built JS/CSS). */
const PWA_STATIC = [
  '/manifest.webmanifest',
  '/favicon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/maskable-512.png',
  '/icons/apple-touch-icon.png',
];

/**
 * Writes dist/sw.js from pwa/sw.js with this build's file list and a version ID. The ID changes whenever
 * any built file changes, which is how browsers notice an update.
 */
function pwaServiceWorker(): Plugin {
  return {
    name: 'rental-management-pwa',
    apply: 'build',
    generateBundle(_options, bundle) {
      const built = Object.values(bundle)
        .map((f) => '/' + f.fileName)
        .filter((f) => /\.(js|css|svg|png|woff2?)$/.test(f));
      const precache = [...new Set([...built, ...PWA_STATIC])].sort();
      const template = readFileSync(new URL('./pwa/sw.js', import.meta.url), 'utf8');
      const html = bundle['index.html'];
      const htmlSource = html && html.type === 'asset' ? String(html.source) : '';
      const buildId = createHash('sha256').update(template).update(precache.join('|')).update(htmlSource).digest('hex').slice(0, 12);
      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source: template.replace("'__BUILD_ID__'", JSON.stringify(buildId)).replace('__PRECACHE__', JSON.stringify(precache)),
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), localApi(), previewApi(), pwaServiceWorker()],
  // 127.0.0.1 (IPv4) so USB port forwarding to a phone (edge://inspect) can reach it.
  // http://localhost:5173 keeps working in the computer's browser.
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  preview: { host: '127.0.0.1', port: 4173, strictPort: true },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    env: {
      BACKEND_MODE: 'memory',
      DEV_STAFF_EMAILS: 'staff@test.local,staff2@test.local',
      DEV_ADMIN_EMAILS: 'admin@test.local',
      APP_TIMEZONE: 'UTC',
    },
  },
} as Parameters<typeof defineConfig>[0]);
