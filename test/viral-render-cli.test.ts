/**
 * viral render + CLI — output shapes and the commands that work with no
 * network at all (packs, help, remix from your own text, the originality gate).
 *
 * The HTML board is checked for escaping: item text comes from strangers on
 * the internet and lands in a file the user opens in a browser.
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fmtCount, humanAge, renderHtml, renderMarkdown, renderTable, scoreBar, snippet } from '../viral/src/render';
import { rank } from '../viral/src/score';
import { HELP, main, parseArgs } from '../viral/src/cli';
import { saveRun, viralHome } from '../viral/src/store';
import type { RunMeta, ViralItem } from '../viral/src/types';

const NOW = 1_700_000_000;

function item(over: Partial<ViralItem> = {}): ViralItem {
  return {
    id: 't3_x', kind: 'post', source: 'reddit', community: 'SpanishMeme', author: 'u',
    title: 'Cuando el lunes te mira fijamente', text: '', url: 'https://www.reddit.com/r/SpanishMeme/comments/x/',
    mediaUrl: 'https://preview.redd.it/x.jpg', isImage: true, createdUtc: NOW - 3600,
    score: 4200, comments: 310, upvoteRatio: 0.95, over18: false, ...over,
  };
}

const meta: RunMeta = {
  command: 'trending', communities: ['SpanishMeme'], window: 'day',
  createdAt: '2026-08-31T12:00:00.000Z', count: 1,
};

let home: string;
let prevHome: string | undefined;

beforeAll(() => {
  prevHome = process.env.GSTACK_HOME;
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'viral-cli-'));
  process.env.GSTACK_HOME = home;
});

afterAll(() => {
  if (prevHome === undefined) delete process.env.GSTACK_HOME;
  else process.env.GSTACK_HOME = prevHome;
  fs.rmSync(home, { recursive: true, force: true });
});

describe('render helpers', () => {
  test('the bar tracks the score and never overflows its width', () => {
    expect(scoreBar(0)).toBe('░'.repeat(10));
    expect(scoreBar(100)).toBe('█'.repeat(10));
    expect(scoreBar(50)).toHaveLength(10);
    expect(scoreBar(500)).toBe('█'.repeat(10));
  });

  test('ages read in minutes, hours, then days', () => {
    expect(humanAge(0.5)).toBe('30m');
    expect(humanAge(6)).toBe('6h');
    expect(humanAge(96)).toBe('4d');
  });

  test('counts shorten past a thousand', () => {
    expect(fmtCount(940)).toBe('940');
    expect(fmtCount(4200)).toBe('4.2k');
    expect(fmtCount(2_400_000)).toBe('2.4M');
  });

  test('snippets collapse whitespace and clip with an ellipsis', () => {
    expect(snippet(item({ title: 'hola    mundo\n\nde   nuevo' }))).toBe('hola mundo de nuevo');
    expect(snippet(item({ title: 'x'.repeat(200) })).endsWith('…')).toBe(true);
  });
});

describe('renderTable', () => {
  test('shows score, votes, velocity and the link for each hit', () => {
    const out = renderTable(rank([item()], NOW));
    expect(out).toContain('4.2k pts');
    expect(out).toContain('/h');
    expect(out).toContain('r/SpanishMeme');
    expect(out).toContain('https://www.reddit.com/r/SpanishMeme/comments/x/');
  });

  test('an empty run says what to try instead of printing nothing', () => {
    expect(renderTable([])).toContain('--window');
  });

  test('a folded crosspost shows how many copies it stood for', () => {
    const out = renderTable(rank([item({ duplicates: 2 })], NOW));
    expect(out).toContain('×3');
    expect(renderTable(rank([item()], NOW))).not.toContain('×');
  });
});

describe('renderMarkdown', () => {
  test('emits a table with the run metadata above it', () => {
    const md = renderMarkdown(rank([item()], NOW), meta);
    expect(md).toContain('| # | Score |');
    expect(md).toContain('r/SpanishMeme');
    expect(md).toContain('day');
  });

  test('pipes inside a title cannot break the table', () => {
    const md = renderMarkdown(rank([item({ title: 'antes | después' })], NOW), meta);
    expect(md).toContain('antes \\| después');
  });
});

describe('renderHtml', () => {
  test('is a self-contained page with the image and the score', () => {
    const html = renderHtml(rank([item()], NOW), meta);
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('preview.redd.it/x.jpg');
    expect(html).toContain('prefers-color-scheme: dark');
    expect(html).not.toContain('<script src=');
  });

  test('escapes hostile text instead of executing it', () => {
    const html = renderHtml(rank([item({ title: '<img src=x onerror="alert(1)">' })], NOW), meta);
    expect(html).not.toContain('<img src=x onerror');
    expect(html).toContain('&lt;img src=x onerror');
  });

  test('escapes quotes in the copy-button payload', () => {
    const html = renderHtml(rank([item({ title: 'dijo "esto" y se fue' })], NOW), meta);
    expect(html).toContain('data-copy="dijo &quot;esto&quot; y se fue"');
  });

  test('the board carries the crosspost count too', () => {
    expect(renderHtml(rank([item({ duplicates: 4 })], NOW), meta)).toContain('×5');
  });

  test('+18 items ship blurred rather than filtered out silently', () => {
    const html = renderHtml(rank([item({ over18: true })], NOW), meta);
    expect(html).toContain('card nsfw');
  });
});

describe('parseArgs', () => {
  test('defaults to trending on the es meme pack', () => {
    const flags = parseArgs([]);
    expect(flags.command).toBe('trending');
    expect(flags.window).toBe('day');
    expect(flags.top).toBe(15);
    expect(flags.save).toBe(true);
  });

  test('english command names alias onto the spanish ones', () => {
    expect(parseArgs(['search', 'gatos']).command).toBe('buscar');
    expect(parseArgs(['comments', 'abc']).command).toBe('comentarios');
    expect(parseArgs(['mine']).command).toBe('mina');
    expect(parseArgs(['last']).command).toBe('ultimo');
  });

  test('--sub accepts a comma list and strips the r/ prefix', () => {
    expect(parseArgs(['trending', '--sub', 'r/memes,SpanishMeme']).subs).toEqual(['memes', 'SpanishMeme']);
  });

  test('crossposts are folded unless you say otherwise', () => {
    expect(parseArgs([]).dedupe).toBe(true);
    expect(parseArgs(['trending', '--no-dedupe']).dedupe).toBe(false);
  });

  test('diff and changes alias onto cambios', () => {
    expect(parseArgs(['diff']).command).toBe('cambios');
    expect(parseArgs(['changes']).command).toBe('cambios');
  });

  test('an unknown option fails loudly instead of being ignored', () => {
    expect(() => parseArgs(['trending', '--turbo'])).toThrow('opción desconocida: --turbo');
  });
});

describe('main (no network)', () => {
  const capture = () => {
    const lines: string[] = [];
    return { lines, out: (s: string) => lines.push(s) };
  };

  test('--help prints usage and exits 0', async () => {
    const { lines, out } = capture();
    expect(await main(['--help'], out)).toBe(0);
    expect(lines.join('\n')).toBe(HELP);
  });

  test('a bad option exits 2 with the reason', async () => {
    const { lines, out } = capture();
    expect(await main(['trending', '--turbo'], out)).toBe(2);
    expect(lines.join('\n')).toContain('--turbo');
  });

  test('packs lists the built-ins and where to override them', async () => {
    const { lines, out } = capture();
    expect(await main(['packs'], out)).toBe(0);
    const text = lines.join('\n');
    expect(text).toContain('memes-es');
    expect(text).toContain('r/SpanishMeme');
    expect(text).toContain(path.join(viralHome(), 'packs.json'));
  });

  test('remix --texto works with nothing saved and no network', async () => {
    const { lines, out } = capture();
    expect(await main(['remix', '--texto', 'Cuando el lunes te mira fijamente', '--nicho', 'gimnasio'], out)).toBe(0);
    const text = lines.join('\n');
    expect(text).toContain('Cambio de contexto');
    expect(text).toContain('gimnasio');
    expect(text).toContain('Historia real');
  });

  test('remix --prompt appends a brief you can paste into a model', async () => {
    const { lines, out } = capture();
    await main(['remix', '--texto', 'algo', '--prompt'], out);
    expect(lines.join('\n')).toContain('brief para pegar');
  });

  test('remix <n> reads item n from the last saved run', async () => {
    saveRun({
      meta: { ...meta, count: 1 },
      items: rank([item({ title: 'el post guardado' })], NOW),
    });
    const { lines, out } = capture();
    expect(await main(['remix', '1'], out)).toBe(0);
    expect(lines.join('\n')).toContain('el post guardado');
  });

  test('remix on an index that does not exist says how many there were', async () => {
    const { lines, out } = capture();
    expect(await main(['remix', '99'], out)).toBe(1);
    expect(lines.join('\n')).toContain('no 99');
  });

  test('ultimo reprints the saved run without touching the network', async () => {
    const { lines, out } = capture();
    expect(await main(['ultimo'], out)).toBe(0);
    expect(lines.join('\n')).toContain('el post guardado');
  });

  test('original exits 3 and warns when the draft is still a copy', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'viral-orig-'));
    const a = path.join(dir, 'a.txt');
    const b = path.join(dir, 'b.txt');
    fs.writeFileSync(a, 'Dije que sabía conducir manual y acabé pagando el embrague de mi jefe.');
    fs.writeFileSync(b, 'Dije que sabía conducir manual y acabé pagando el embrague de mi jefa.');
    const { lines, out } = capture();
    expect(await main(['original', a, b], out)).toBe(3);
    expect(lines.join('\n')).toContain('duplicado');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('original exits 0 on a real rewrite', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'viral-orig2-'));
    const a = path.join(dir, 'a.txt');
    const b = path.join(dir, 'b.txt');
    fs.writeFileSync(a, 'Dije que sabía conducir manual y acabé pagando el embrague de mi jefe.');
    fs.writeFileSync(b, 'Mentí sobre saber Kubernetes en la entrevista y tres semanas después arreglaba producción un domingo.');
    const { lines, out } = capture();
    expect(await main(['original', a, b], out)).toBe(0);
    expect(lines.join('\n')).toContain('se sostiene sola');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('cambios with a single saved run explains how to get a second one', async () => {
    const solo = fs.mkdtempSync(path.join(os.tmpdir(), 'viral-solo-'));
    const previous = process.env.GSTACK_HOME;
    process.env.GSTACK_HOME = solo;
    try {
      saveRun({ meta: { ...meta, createdAt: '2026-09-01T10:00:00.000Z' }, items: rank([item()], NOW) });
      const { lines, out } = capture();
      expect(await main(['cambios'], out)).toBe(1);
      expect(lines.join('\n')).toContain('dos búsquedas');
    } finally {
      process.env.GSTACK_HOME = previous;
      fs.rmSync(solo, { recursive: true, force: true });
    }
  });

  test('cambios compares the last two runs and leads with what is climbing', async () => {
    const base = item({ id: 't3_sube', title: 'este sigue subiendo', score: 1000 });
    saveRun({
      meta: { ...meta, createdAt: '2026-09-01T10:00:00.000Z' },
      items: rank([base], NOW),
    });
    saveRun({
      meta: { ...meta, createdAt: '2026-09-01T12:00:00.000Z' },
      items: rank([{ ...base, score: 9000 }], NOW),
    });
    const { lines, out } = capture();
    expect(await main(['cambios'], out)).toBe(0);
    const text = lines.join('\n');
    expect(text).toContain('SIGUE SUBIENDO');
    expect(text).toContain('este sigue subiendo');
    expect(text).toContain('+8.0k votos');
  });

  test('cambios --json hands back the structured diff', async () => {
    const { lines, out } = capture();
    expect(await main(['cambios', '--json'], out)).toBe(0);
    const parsed = JSON.parse(lines.join('\n'));
    expect(parsed.hoursBetween).toBe(2);
    expect(parsed.entries[0].trend).toBe('acelera');
  });

  test('an unknown pack names the command that lists the real ones', async () => {
    const { lines, out } = capture();
    expect(await main(['trending', '--pack', 'no-existe'], out)).toBe(1);
    expect(lines.join('\n')).toContain('gstack-viral packs');
  });
});
