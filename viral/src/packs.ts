/**
 * packs — named bundles of communities, so you type `--pack memes-es` instead
 * of a comma list you have to remember.
 *
 * These are STARTING POINTS, not gospel. Communities die, rename, and go
 * private. A community that no longer resolves is reported in the run output
 * (never silently dropped) so you can edit the pack.
 *
 * Override any pack, or add your own, in ~/.gstack/viral/packs.json:
 *
 *   { "mi-nicho": { "lang": "es", "about": "...", "communities": ["..."] } }
 */

import fs from 'node:fs';
import path from 'node:path';
import { viralHome } from './store';

export interface Pack {
  lang: 'es' | 'en' | 'mixed';
  about: string;
  communities: string[];
}

export const BUILTIN_PACKS: Record<string, Pack> = {
  'memes-es': {
    lang: 'es',
    about: 'Memes en español (España + LatAm)',
    communities: ['SpanishMeme', 'memexico', 'MemesESP', 'ArgentinaBenderStyle', 'yo_elvr', 'chistes'],
  },
  memes: {
    lang: 'en',
    about: 'Memes en inglés, el formato que después se traduce',
    communities: ['memes', 'dankmemes', 'meme', 'MemeEconomy', 'wholesomememes', 'funny'],
  },
  'historias-es': {
    lang: 'es',
    about: 'Historias reales y relatos en español',
    communities: ['HistoriasDeReddit', 'askspain', 'preguntaleareddit', 'Mexico', 'republicaargentina'],
  },
  historias: {
    lang: 'en',
    about: 'Historias reales en inglés: el pozo sin fondo de "esto me pasó"',
    communities: ['TrueOffMyChest', 'tifu', 'AmItheAsshole', 'confession', 'offmychest'],
  },
  comentarios: {
    lang: 'en',
    about: 'Hilos donde el oro está en los comentarios, no en el post',
    communities: ['AskReddit', 'NoStupidQuestions', 'Showerthoughts', 'AskMen', 'AskWomen'],
  },
  'comentarios-es': {
    lang: 'es',
    about: 'Hilos en español donde los comentarios son el contenido',
    communities: ['preguntaleareddit', 'askspain', 'Mexico', 'chile', 'uruguay'],
  },
  virales: {
    lang: 'mixed',
    about: 'Mezcla amplia: lo que explota hoy en cualquier formato',
    communities: ['memes', 'SpanishMeme', 'AskReddit', 'interestingasfuck', 'Damnthatsinteresting', 'nextfuckinglevel'],
  },
};

/** Built-in packs plus any user overrides from ~/.gstack/viral/packs.json. */
export function loadPacks(home: string = viralHome()): Record<string, Pack> {
  const file = path.join(home, 'packs.json');
  if (!fs.existsSync(file)) return { ...BUILTIN_PACKS };
  try {
    const custom = JSON.parse(fs.readFileSync(file, 'utf-8')) as Record<string, Pack>;
    return { ...BUILTIN_PACKS, ...custom };
  } catch (err) {
    process.stderr.write(`[viral] ${file} no es JSON válido (${(err as Error).message}) — uso los packs por defecto\n`);
    return { ...BUILTIN_PACKS };
  }
}

export function resolvePack(name: string, home?: string): Pack | undefined {
  const packs = loadPacks(home);
  return packs[name] ?? packs[name.toLowerCase()];
}
