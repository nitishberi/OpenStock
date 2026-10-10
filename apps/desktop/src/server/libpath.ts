import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Resolve OpenStock shared libs for both:
 * - Dev: apps/desktop cwd → ../../lib/...
 * - Bundle: Resources/app cwd → ./lib/...
 */
export function openStockRoot(): string {
  if (process.env.AUTODAYTRADER_LIB_ROOT) {
    return path.resolve(process.env.AUTODAYTRADER_LIB_ROOT);
  }
  const candidates = [
    path.resolve(process.cwd()), // Resources/app (bundled)
    path.resolve(process.cwd(), '../..'), // apps/desktop → repo root
    path.resolve(process.cwd(), '../../..'), // apps/desktop/src/... odd cwd
  ];
  for (const root of candidates) {
    if (fs.existsSync(path.join(root, 'lib', 'forecast', 'weights.ts'))) return root;
    if (fs.existsSync(path.join(root, 'lib', 'forecast', 'weights.js'))) return root;
  }
  return path.resolve(process.cwd(), '../..');
}

export async function importForecast(moduleName: string): Promise<Record<string, unknown>> {
  const root = openStockRoot();
  const base = path.join(root, 'lib', 'forecast', moduleName);
  const tries = [`${base}.ts`, `${base}.js`, base];
  let lastErr: unknown;
  for (const file of tries) {
    if (!fs.existsSync(file) && !file.endsWith(moduleName)) continue;
    try {
      return (await import(pathToFileURL(file.endsWith('.ts') || file.endsWith('.js') ? file : `${file}.ts`).href)) as Record<
        string,
        unknown
      >;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error(`Cannot import lib/forecast/${moduleName} from ${root}`);
}
