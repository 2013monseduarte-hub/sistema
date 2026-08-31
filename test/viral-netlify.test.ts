/**
 * Netlify deploy wiring — static tripwires for the pieces that only break in
 * production.
 *
 * The function bundles with esbuild on Netlify's builders, where there is no
 * Bun: an import that reaches viral/src/cli.ts would drag in `import.meta.main`
 * and blow up at bundle time. And the picker on the landing page is a hardcoded
 * list of packs, so renaming a pack silently ships a form that 400s.
 */

import { describe, test, expect } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import { BUILTIN_PACKS } from '../viral/src/packs';

const ROOT = path.resolve(import.meta.dir, '..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf-8');

const toml = read('netlify.toml');
const fn = read('netlify/functions/buscar.mts');
const page = read('web/index.html');

describe('netlify.toml', () => {
  test('publishes the static dir and points at the functions dir', () => {
    expect(toml).toMatch(/publish\s*=\s*"web"/);
    expect(toml).toMatch(/directory\s*=\s*"netlify\/functions"/);
  });

  test('routes /api/buscar to the function as a rewrite, not a redirect', () => {
    expect(toml).toContain('from = "/api/buscar"');
    expect(toml).toContain('to = "/.netlify/functions/buscar"');
    expect(toml).toMatch(/status\s*=\s*200/);
  });

  test('points GSTACK_HOME at /tmp — the only writable path on the runtime', () => {
    expect(toml).toMatch(/GSTACK_HOME\s*=\s*"\/tmp\/gstack"/);
  });
});

describe('the function', () => {
  test('never imports the CLI: it carries Bun-only import.meta.main', () => {
    expect(fn).not.toMatch(/from '.*viral\/src\/cli'/);
    expect(read('viral/src/cli.ts')).toContain('import.meta.main');
  });

  test('imports only from viral/src, so the bundle stays self-contained', () => {
    const imports = [...fn.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
    expect(imports.length).toBeGreaterThan(0);
    for (const spec of imports) {
      expect(spec.startsWith('../../viral/src/'), `import externo inesperado: ${spec}`).toBe(true);
    }
  });

  test('keeps the request budget under the function timeout', () => {
    // A pack of six communities at the CLI's 700ms pace eats most of a 10s
    // budget; these two constants are what keep the function inside it.
    const communities = Number(fn.match(/MAX_COMMUNITIES = (\d+)/)![1]);
    const delay = Number(fn.match(/DELAY_MS = (\d+)/)![1]);
    expect(communities).toBeLessThanOrEqual(6);
    expect(delay).toBeLessThanOrEqual(400);
    expect((communities - 1) * delay).toBeLessThan(3000);
  });

  test('caches, so a browser refresh is not another round of requests', () => {
    expect(fn).toContain('cache-control');
    expect(Number(fn.match(/CACHE_SECONDS = (\d+)/)![1])).toBeGreaterThanOrEqual(60);
  });

  test('drops +18 items: the deploy is a public URL', () => {
    expect(fn).toContain('!i.over18');
  });
});

describe('the landing page', () => {
  const options = [...page.matchAll(/<option value="([a-z-]+)"/g)].map((m) => m[1]);
  const packOptions = options.filter((o) => !['hour', 'day', 'week', 'month', 'year', 'all'].includes(o));

  test('every pack in the picker exists', () => {
    expect(packOptions.length).toBeGreaterThan(0);
    for (const name of packOptions) {
      expect(BUILTIN_PACKS[name], `el formulario ofrece un pack que no existe: ${name}`).toBeDefined();
    }
  });

  test('offers every built-in pack — a new pack should not stay hidden', () => {
    expect(packOptions.sort()).toEqual(Object.keys(BUILTIN_PACKS).sort());
  });

  test('posts to the stable /api path, not the internal function path', () => {
    expect(page).toContain('action="/api/buscar"');
    expect(page).not.toContain('/.netlify/functions/');
  });

  test('loads nothing from a third party', () => {
    expect(page).not.toMatch(/(?:src|href)="https?:/);
  });
});
