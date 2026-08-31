/**
 * viral store + packs — where runs land, how many are kept, and how a user
 * overrides the built-in community packs.
 *
 * Runs are saved 0600: what you search for says a lot about what you are about
 * to publish.
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { latestRun, listRuns, loadRun, MAX_RUNS, runsDir, saveRun, viralHome } from '../viral/src/store';
import { BUILTIN_PACKS, loadPacks, resolvePack } from '../viral/src/packs';
import type { SavedRun } from '../viral/src/types';

let home: string;

function run(label: string, createdAt: string): SavedRun {
  return {
    meta: { command: label, communities: ['memes'], window: 'day', createdAt, count: 1 },
    items: [
      {
        id: `t3_${label}`, kind: 'post', source: 'reddit', community: 'memes', author: 'u',
        title: label, text: '', url: 'https://example.com', isImage: false,
        createdUtc: 1_700_000_000, score: 10, comments: 1, over18: false,
      },
    ],
  };
}

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'viral-store-'));
});

afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true });
});

describe('viralHome', () => {
  test('follows GSTACK_HOME so a test never writes to the real ledger dir', () => {
    expect(viralHome({ GSTACK_HOME: '/tmp/algo' } as NodeJS.ProcessEnv)).toBe(path.join('/tmp/algo', 'viral'));
    expect(viralHome({ HOME: '/home/x' } as NodeJS.ProcessEnv)).toBe('/home/x/.gstack/viral');
  });
});

describe('saveRun', () => {
  test('writes owner-only and round-trips', () => {
    const file = saveRun(run('trending', '2026-08-31T10:00:00.000Z'), home);
    expect(fs.existsSync(file)).toBe(true);
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    expect(loadRun(file).items[0].title).toBe('trending');
  });

  test('latestRun returns the newest by timestamp, not by write order', () => {
    saveRun(run('viejo', '2026-08-01T10:00:00.000Z'), home);
    saveRun(run('nuevo', '2026-08-31T10:00:00.000Z'), home);
    saveRun(run('medio', '2026-08-15T10:00:00.000Z'), home);
    expect(latestRun(home)?.meta.command).toBe('nuevo');
  });

  test('prunes to MAX_RUNS so the folder does not grow forever', () => {
    for (let i = 0; i < MAX_RUNS + 5; i++) {
      saveRun(run('t', `2026-08-31T${String(i % 24).padStart(2, '0')}:${String(i).padStart(2, '0')}:00.000Z`), home);
    }
    expect(listRuns(home).length).toBeLessThanOrEqual(MAX_RUNS);
  });

  test('listRuns on a fresh machine is empty, not a crash', () => {
    expect(listRuns(path.join(home, 'nada'))).toEqual([]);
    expect(latestRun(path.join(home, 'nada'))).toBeUndefined();
  });
});

describe('packs', () => {
  test('ships packs for spanish memes, stories and comment threads', () => {
    for (const name of ['memes-es', 'memes', 'historias-es', 'comentarios', 'virales']) {
      expect(BUILTIN_PACKS[name].communities.length).toBeGreaterThan(0);
    }
  });

  test('a user packs.json adds new packs and overrides built-ins', () => {
    fs.mkdirSync(home, { recursive: true });
    fs.writeFileSync(
      path.join(home, 'packs.json'),
      JSON.stringify({
        'mi-nicho': { lang: 'es', about: 'lo mío', communities: ['gimnasio'] },
        memes: { lang: 'en', about: 'reemplazado', communities: ['solo_este'] },
      }),
    );
    const packs = loadPacks(home);
    expect(packs['mi-nicho'].communities).toEqual(['gimnasio']);
    expect(packs.memes.communities).toEqual(['solo_este']);
    expect(packs['memes-es']).toBeDefined();
  });

  test('a broken packs.json warns and falls back instead of killing the run', () => {
    fs.mkdirSync(home, { recursive: true });
    fs.writeFileSync(path.join(home, 'packs.json'), '{ esto no es json');
    expect(loadPacks(home).memes.communities).toEqual(BUILTIN_PACKS.memes.communities);
  });

  test('resolvePack is case-insensitive on the pack name', () => {
    expect(resolvePack('MEMES-ES', home)?.lang).toBe('es');
    expect(resolvePack('no-existe', home)).toBeUndefined();
  });
});

describe('runsDir', () => {
  test('lives under the viral home', () => {
    expect(runsDir(home)).toBe(path.join(home, 'runs'));
  });
});
