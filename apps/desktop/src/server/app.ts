import { Hono } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';
import fs from 'node:fs';
import path from 'node:path';
import type { DesktopConfig } from './config.js';
import { authRoutes } from './routes/auth.js';
import { apiRoutes } from './routes/api.js';

export function createApp(cfg: DesktopConfig) {
  const app = new Hono();

  app.use('*', async (c, next) => {
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('X-Frame-Options', 'DENY');
    c.header('Referrer-Policy', 'no-referrer');
    c.header('Content-Security-Policy', "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; connect-src 'self' http://127.0.0.1:* http://localhost:*; frame-ancestors 'none'");
    await next();
  });

  app.route('/auth', authRoutes(cfg));
  app.route('/api', apiRoutes(cfg));

  // Also expose ingest under /api for worker compatibility
  // (api routes already have /media/ingest and /insider/ingest)

  // SPA roots relative to process.cwd() (Resources/app in the .app bundle):
  // - dist/client → vite outDir + assemble-app.sh preferred layout
  // - client      → legacy assemble layout (pre-path fix)
  // - client-dist → optional alias
  const candidates = ['dist/client', 'client', 'client-dist'] as const;
  const staticRoot =
    candidates.find((rel) => fs.existsSync(path.resolve(process.cwd(), rel, 'index.html'))) ??
    null;

  if (staticRoot) {
    app.use('/*', serveStatic({ root: staticRoot }));
    app.get('*', async (c) => {
      const index = path.resolve(process.cwd(), staticRoot, 'index.html');
      if (fs.existsSync(index)) {
        return c.html(fs.readFileSync(index, 'utf8'));
      }
      return c.text('UI not built', 404);
    });
  } else {
    app.get('/', (c) =>
      c.html(`<!doctype html><html><body style="font-family:system-ui;padding:2rem">
        <h1>AutoDayTrader</h1>
        <p>API up on <code>${cfg.host}:${cfg.port}</code>. Build UI with <code>npm run build:ui</code> or run <code>npm run dev:ui</code>.</p>
        <p><a href="/api/health">/api/health</a></p>
      </body></html>`)
    );
  }

  return app;
}
