import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { DesktopConfig } from '../config.js';

/**
 * Vendored Scrapling worker interface.
 *
 * In the .app bundle, CPython + Scrapling live under:
 *   AutoDayTrader.app/Contents/Resources/python/
 *   AutoDayTrader.app/Contents/Resources/scrapling-worker/
 *
 * Locally / Linux CI: uses repo services/scrapling-worker with system python3.
 *
 * See resources/PYTHON_VENDOR.md for Mac mini packaging steps.
 */

let child: ChildProcess | null = null;

export function resolveWorkerPaths(bundleResources?: string): {
  python: string;
  workerDir: string;
  mainPy: string;
} {
  if (bundleResources) {
    const python = path.join(bundleResources, 'python', 'bin', 'python3');
    const workerDir = path.join(bundleResources, 'scrapling-worker');
    return { python, workerDir, mainPy: path.join(workerDir, 'main.py') };
  }

  // Dev: repo layout apps/desktop -> ../../services/scrapling-worker
  const repoWorker = path.resolve(process.cwd(), '../../services/scrapling-worker');
  const alt = path.resolve(process.cwd(), 'services/scrapling-worker');
  const workerDir = fs.existsSync(repoWorker) ? repoWorker : alt;
  return {
    python: process.env.PYTHON_BIN || 'python3',
    workerDir,
    mainPy: path.join(workerDir, 'main.py'),
  };
}

export function startScraplingWorker(cfg: DesktopConfig, bundleResources?: string): ChildProcess | null {
  if (child && !child.killed) return child;

  const { python, workerDir, mainPy } = resolveWorkerPaths(bundleResources);
  if (!fs.existsSync(mainPy)) {
    console.warn('[worker] Scrapling main.py not found at', mainPy);
    return null;
  }

  if (!cfg.scraplingWorkerToken && cfg.workerTokenRequired) {
    console.warn('[worker] SCRAPLING_WORKER_TOKEN required — not starting worker');
    return null;
  }

  const env = {
    ...process.env,
    APP_TOKEN: cfg.scraplingWorkerToken,
    SCRAPLING_WORKER_TOKEN: cfg.scraplingWorkerToken,
    WEB_INGEST_URL: `${cfg.appUrl}/api/media/ingest`,
    WEB_INSIDER_INGEST_URL: `${cfg.appUrl}/api/insider/ingest`,
    PORT: '8091',
  };

  child = spawn(
    python,
    ['-m', 'uvicorn', 'main:app', '--host', '127.0.0.1', '--port', '8091'],
    {
      cwd: workerDir,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );

  child.stdout?.on('data', (d) => process.stdout.write(`[scrapling] ${d}`));
  child.stderr?.on('data', (d) => process.stderr.write(`[scrapling] ${d}`));
  child.on('exit', (code) => {
    console.warn('[worker] exited', code);
    child = null;
  });

  return child;
}

export function stopScraplingWorker(): void {
  if (child && !child.killed) {
    child.kill('SIGTERM');
    child = null;
  }
}
