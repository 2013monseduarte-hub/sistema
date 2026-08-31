/**
 * store — where runs live on disk: ~/.gstack/viral/
 *
 *   runs/<timestamp>-<label>.json   one saved search, items + metadata
 *   packs.json                      user pack overrides (see packs.ts)
 *
 * Runs are kept so `viral remix 3` can address item #3 of the last search
 * without hitting the network again, and so you can diff what was hot
 * yesterday against today.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { SavedRun } from './types';

/** Mirrors lib/egress-receipt's home resolution so GSTACK_HOME moves everything together. */
export function viralHome(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.GSTACK_HOME || env.GSTACK_STATE_DIR;
  const root = configured ? path.resolve(configured) : path.join(env.HOME || os.homedir(), '.gstack');
  return path.join(root, 'viral');
}

export function runsDir(home: string = viralHome()): string {
  return path.join(home, 'runs');
}

/** How many runs to keep before the oldest are pruned. */
export const MAX_RUNS = 50;

export function saveRun(run: SavedRun, home: string = viralHome()): string {
  const dir = runsDir(home);
  fs.mkdirSync(dir, { recursive: true });
  const stamp = run.meta.createdAt.replace(/[:.]/g, '-');
  const label = run.meta.command.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  const file = path.join(dir, `${stamp}-${label}.json`);
  fs.writeFileSync(file, JSON.stringify(run, null, 2), { mode: 0o600 });
  prune(dir);
  return file;
}

export function listRuns(home: string = viralHome()): string[] {
  const dir = runsDir(home);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => path.join(dir, f));
}

export function loadRun(file: string): SavedRun {
  return JSON.parse(fs.readFileSync(file, 'utf-8')) as SavedRun;
}

export function latestRun(home: string = viralHome()): SavedRun | undefined {
  const runs = listRuns(home);
  if (runs.length === 0) return undefined;
  return loadRun(runs[runs.length - 1]);
}

function prune(dir: string): void {
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort();
  for (const stale of files.slice(0, Math.max(0, files.length - MAX_RUNS))) {
    try {
      fs.unlinkSync(path.join(dir, stale));
    } catch {
      // best-effort pruning: a run left behind costs nothing
    }
  }
}
