#!/usr/bin/env bun
/**
 * gstack-viral — buscador de memes y comentarios virales.
 *
 * Encuentra lo que está explotando AHORA (no lo que explotó hace tres días),
 * te enseña por qué funcionó, y te da ángulos para hacer tu propia versión.
 *
 * Comandos:
 *   trending      lo más viral ahora mismo en un pack de comunidades
 *   buscar        búsqueda por palabra clave
 *   comentarios   los mejores comentarios de un post concreto
 *   mina          posts virales + sus mejores comentarios, en una pasada
 *   remix         ángulos para adaptar un resultado a tu cuenta
 *   original      compara tu borrador con el original y avisa si es un calco
 *   packs         lista los packs de comunidades disponibles
 *   ultimo        vuelve a mostrar la última búsqueda (sin red)
 */

import fs from 'node:fs';
import path from 'node:path';
import type { RunMeta, SavedRun, SourceResult, ViralItem } from './types';
import { rank } from './score';
import { loadPacks, resolvePack } from './packs';
import * as reddit from './sources/reddit';
import { renderHtml, renderMarkdown, renderTable } from './render';
import { latestRun, saveRun, viralHome } from './store';
import { originalityCheck, promptFor, remixAngles } from './remix';

export interface Flags {
  command: string;
  positional: string[];
  pack?: string;
  subs: string[];
  window: reddit.TimeWindow;
  listing: reddit.ListingKind;
  limit: number;
  top: number;
  minScore: number;
  sfw: boolean;
  json: boolean;
  md: boolean;
  html?: string;
  save: boolean;
  niche?: string;
  texto?: string;
  prompt: boolean;
  delayMs?: number;
  help: boolean;
}

const DEFAULT_PACK = 'memes-es';

export function parseArgs(argv: string[]): Flags {
  const flags: Flags = {
    command: 'trending',
    positional: [],
    subs: [],
    window: 'day',
    listing: 'top',
    limit: 50,
    top: 15,
    minScore: 0,
    sfw: false,
    json: false,
    md: false,
    save: true,
    prompt: false,
    help: false,
  };
  const rest = [...argv];
  if (rest.length > 0 && !rest[0].startsWith('-')) flags.command = normalizeCommand(rest.shift()!);

  while (rest.length > 0) {
    const arg = rest.shift()!;
    const next = () => rest.shift() ?? '';
    switch (arg) {
      case '--pack': case '-p': flags.pack = next(); break;
      case '--sub': case '-s': flags.subs.push(...next().split(',').map((s) => s.replace(/^r\//, '').trim()).filter(Boolean)); break;
      case '--window': case '-w': flags.window = next() as reddit.TimeWindow; break;
      case '--listing': case '-l': flags.listing = next() as reddit.ListingKind; break;
      case '--limit': flags.limit = Number(next()) || 50; break;
      case '--top': case '-n': flags.top = Number(next()) || 15; break;
      case '--min-score': flags.minScore = Number(next()) || 0; break;
      case '--sfw': flags.sfw = true; break;
      case '--json': flags.json = true; break;
      case '--md': case '--markdown': flags.md = true; break;
      case '--html': flags.html = next(); break;
      case '--no-save': flags.save = false; break;
      case '--nicho': case '--niche': flags.niche = next(); break;
      case '--texto': case '--text': flags.texto = next(); break;
      case '--prompt': flags.prompt = true; break;
      case '--delay': flags.delayMs = Number(next()) || 0; break;
      case '--help': case '-h': flags.help = true; break;
      default:
        if (arg.startsWith('-')) throw new Error(`opción desconocida: ${arg}`);
        flags.positional.push(arg);
    }
  }
  return flags;
}

function normalizeCommand(cmd: string): string {
  const alias: Record<string, string> = {
    search: 'buscar', busca: 'buscar',
    comments: 'comentarios', coment: 'comentarios',
    mine: 'mina', dig: 'mina',
    last: 'ultimo', último: 'ultimo',
    originality: 'original',
    help: 'ayuda',
  };
  return alias[cmd] ?? cmd;
}

export const HELP = `gstack-viral — buscador de memes y comentarios virales

USO
  gstack-viral <comando> [opciones]

COMANDOS
  trending                  lo más viral ahora en un pack de comunidades (por defecto)
  buscar <texto>            busca por palabra clave
  comentarios <url|id>      los mejores comentarios de un post
  mina                      posts virales + sus mejores comentarios en una pasada
  remix <n|--texto "...">   ángulos para adaptar el resultado n de la última búsqueda
  original <fuente> <tuyo>  compara dos archivos de texto y avisa si tu versión es un calco
  packs                     lista los packs de comunidades
  ultimo                    reimprime la última búsqueda guardada (sin red)

OPCIONES
  -p, --pack <nombre>       pack de comunidades (por defecto: ${DEFAULT_PACK})
  -s, --sub <a,b,c>         comunidades sueltas (se suman al pack)
  -w, --window <t>          hour|day|week|month|year|all   (por defecto: day)
  -l, --listing <t>         top|hot|rising|new             (por defecto: top)
      --limit <n>           resultados a pedir por comunidad (máx 100)
  -n, --top <n>             resultados a mostrar (por defecto: 15)
      --min-score <n>       descarta lo que tenga menos de n votos
      --sfw                 fuera todo lo marcado +18
      --json                salida JSON
      --md                  salida Markdown
      --html <archivo>      escribe un tablero HTML con las imágenes
      --nicho "<tema>"      tu nicho, para que remix hable de lo tuyo
      --texto "<frase>"     en remix, parte de un texto tuyo en vez de un resultado
      --prompt              en remix, imprime el brief listo para pegar en un modelo
      --no-save             no guarda la búsqueda en ~/.gstack/viral/runs/
      --delay <ms>          espera entre comunidades (por defecto: ${reddit.REQUEST_DELAY_MS})

EJEMPLOS
  gstack-viral trending --pack memes-es --window day -n 20
  gstack-viral trending --pack memes --html /tmp/tablero.html
  gstack-viral buscar "gimnasio" --pack memes-es --window week
  gstack-viral mina --pack comentarios-es -n 8
  gstack-viral comentarios https://www.reddit.com/r/AskReddit/comments/abc123/...
  gstack-viral remix 3 --nicho "programación" --prompt

CÓMO SE PUNTÚA
  El score 0-100 pesa velocidad (votos/hora, no votos totales), densidad de
  comentarios, y en los comentarios cuánto se puede reutilizar el texto tal cual.
  Un post de hace 40 minutos con 4k votos gana a uno de 90k de hace tres días:
  ese ya pasó, este todavía lo puedes montar.

DE DÓNDE SALEN LOS DATOS
  Listados públicos .json de Reddit — las mismas páginas que abres en el
  navegador. Sin API key, sin login. Cada petición deja un recibo de egress
  (bin/gstack-egress list).
`;

async function collect(flags: Flags): Promise<{ result: SourceResult; communities: string[] }> {
  const communities = communitiesFor(flags);
  const opts: reddit.FetchOptions = {
    listing: flags.listing,
    window: flags.window,
    limit: flags.limit,
    delayMs: flags.delayMs,
  };
  if (flags.command === 'buscar') {
    const query = flags.positional.join(' ');
    if (!query) throw new Error('buscar necesita un texto: gstack-viral buscar "gimnasio"');
    return { result: await reddit.search(query, communities, opts), communities };
  }
  return { result: await reddit.fetchCommunities(communities, opts), communities };
}

function communitiesFor(flags: Flags): string[] {
  const out: string[] = [];
  const packName = flags.pack ?? (flags.subs.length > 0 ? undefined : DEFAULT_PACK);
  if (packName) {
    const pack = resolvePack(packName);
    if (!pack) throw new Error(`pack desconocido: ${packName} (mira: gstack-viral packs)`);
    out.push(...pack.communities);
  }
  out.push(...flags.subs);
  return [...new Set(out)];
}

function filterItems(items: ViralItem[], flags: Flags): ViralItem[] {
  return items.filter((i) => (!flags.sfw || !i.over18) && i.score >= flags.minScore);
}

function emit(items: ViralItem[], meta: RunMeta, flags: Flags, out: (s: string) => void): void {
  if (flags.json) out(JSON.stringify({ meta, items }, null, 2));
  else if (flags.md) out(renderMarkdown(items, meta));
  else out(renderTable(items));

  if (flags.html) {
    const file = path.resolve(flags.html);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, renderHtml(items, meta));
    out(`Tablero HTML: ${file}`);
  }
}

function reportErrors(result: SourceResult, out: (s: string) => void): void {
  for (const e of result.errors) {
    out(`[aviso] r/${e.community}: ${e.reason} — ¿existe, es privada, o cambió de nombre?`);
  }
}

function meta(flags: Flags, communities: string[], count: number): RunMeta {
  return {
    command: flags.command,
    query: flags.command === 'buscar' ? flags.positional.join(' ') : undefined,
    pack: flags.pack,
    communities,
    window: flags.window,
    createdAt: new Date().toISOString(),
    count,
  };
}

export async function main(argv: string[], out: (s: string) => void = (s) => process.stdout.write(`${s}\n`)): Promise<number> {
  let flags: Flags;
  try {
    flags = parseArgs(argv);
  } catch (err) {
    out(`Error: ${(err as Error).message}`);
    return 2;
  }
  if (flags.help || flags.command === 'ayuda') {
    out(HELP);
    return 0;
  }

  try {
    switch (flags.command) {
      case 'packs': {
        const packs = loadPacks();
        for (const [name, pack] of Object.entries(packs)) {
          out(`${name}  [${pack.lang}]  ${pack.about}`);
          out(`   ${pack.communities.map((c) => `r/${c}`).join(' ')}`);
        }
        out('');
        out(`Añade los tuyos en ${path.join(viralHome(), 'packs.json')}`);
        return 0;
      }

      case 'ultimo': {
        const run = latestRun();
        if (!run) {
          out('No hay búsquedas guardadas todavía. Lanza: gstack-viral trending');
          return 1;
        }
        emit(run.items.slice(0, flags.top), run.meta, flags, out);
        return 0;
      }

      case 'original': {
        const [a, b] = flags.positional;
        if (!a || !b) {
          out('Uso: gstack-viral original <archivo-original> <archivo-tuyo>');
          return 2;
        }
        const check = originalityCheck(fs.readFileSync(a, 'utf-8'), fs.readFileSync(b, 'utf-8'));
        out(`Similitud: ${Math.round(check.similarity * 100)}%`);
        if (check.warning) {
          out(check.warning);
          return 3;
        }
        out('Tu versión se sostiene sola. Cita la fuente si la idea es reconocible.');
        return 0;
      }

      case 'remix': {
        const item = await itemForRemix(flags);
        if (!item) return 2;
        if (item.source === 'manual') {
          out(`Punto de partida: "${item.title}"`);
        } else {
          out(`Original: ${item.url}`);
          out(
            `Por qué funcionó: ${item.score} votos, ${item.comments} comentarios en r/${item.community}` +
              (item.metrics ? ` · ${Math.round(item.metrics.velocity)} votos/hora · score ${item.metrics.viralScore}` : ''),
          );
        }
        out('');
        const angles = remixAngles(item, { niche: flags.niche });
        angles.forEach((angle, i) => {
          out(`${i + 1}. ${angle.name}  [cambio ${angle.changeLevel}]`);
          out(`   ${angle.idea}`);
          out(`   Gancho: "${angle.hook}"`);
          out(`   Formato: ${angle.format}`);
          out('');
        });
        if (flags.prompt) {
          out('--- brief para pegar en un modelo ---');
          out(promptFor(item, angles[0], { niche: flags.niche }));
        }
        out('Antes de publicar: gstack-viral original original.txt borrador.txt');
        return 0;
      }

      case 'comentarios': {
        const ref = flags.positional[0];
        if (!ref) {
          out('Uso: gstack-viral comentarios <url-del-post|id>');
          return 2;
        }
        const result = await reddit.fetchComments(ref, { limit: flags.limit });
        reportErrors(result, out);
        const items = rank(filterItems(result.items, flags)).slice(0, flags.top);
        const runMeta = meta(flags, [items[0]?.community ?? ''], items.length);
        if (flags.save) saveRun({ meta: runMeta, items });
        emit(items, runMeta, flags, out);
        return items.length > 0 ? 0 : 1;
      }

      case 'mina': {
        const { result, communities } = await collect(flags);
        reportErrors(result, out);
        const posts = rank(filterItems(result.items, flags)).slice(0, flags.top);
        const comments: ViralItem[] = [];
        for (const post of posts.slice(0, Math.min(posts.length, 5))) {
          const r = await reddit.fetchComments(post.id, { limit: 50, delayMs: flags.delayMs });
          comments.push(...rank(filterItems(r.items, flags)).slice(0, 3));
        }
        const items = [...posts, ...rank(comments)];
        const runMeta = meta(flags, communities, items.length);
        if (flags.save) saveRun({ meta: runMeta, items });
        out('POSTS');
        emit(posts, runMeta, { ...flags, html: undefined }, out);
        out('COMENTARIOS REUTILIZABLES');
        emit(rank(comments).slice(0, flags.top), runMeta, flags, out);
        return items.length > 0 ? 0 : 1;
      }

      case 'trending':
      case 'buscar': {
        const { result, communities } = await collect(flags);
        reportErrors(result, out);
        const items = rank(filterItems(result.items, flags)).slice(0, flags.top);
        const runMeta = meta(flags, communities, items.length);
        if (flags.save) saveRun({ meta: runMeta, items });
        emit(items, runMeta, flags, out);
        if (items.length === 0 && result.errors.length === communities.length) return 1;
        return items.length > 0 ? 0 : 1;
      }

      default:
        out(`Comando desconocido: ${flags.command}`);
        out(HELP);
        return 2;
    }
  } catch (err) {
    out(`Error: ${(err as Error).message}`);
    return 1;
  }
}

async function itemForRemix(flags: Flags): Promise<ViralItem | undefined> {
  if (flags.texto) return manualItem(flags.texto);
  const ref = flags.positional[0];
  if (ref && /^\d+$/.test(ref)) {
    const run = latestRun();
    if (!run) throw new Error('no hay búsqueda guardada — lanza gstack-viral trending primero');
    const item = run.items[Number(ref) - 1];
    if (!item) throw new Error(`la última búsqueda tiene ${run.items.length} resultados, no ${ref}`);
    return item;
  }
  if (ref && /^https?:\/\//.test(ref)) {
    const result = await reddit.fetchComments(ref, { limit: 1 });
    const post = result.items[0];
    if (post) return { ...post, kind: 'post', title: post.parentTitle ?? post.title, url: post.parentUrl ?? post.url };
    throw new Error('no pude leer ese post');
  }
  if (ref) return manualItem(flags.positional.join(' '));
  throw new Error('remix necesita un número de resultado, una URL, o --texto "..."');
}

/** A piece of text you paste yourself, wrapped as an item so remix treats it like any other. */
function manualItem(text: string): ViralItem {
  return {
    id: 'manual', kind: 'post', source: 'manual', community: 'manual', author: 'tú',
    title: text, text: '', url: '(texto propio)', isImage: false,
    createdUtc: Date.now() / 1000, score: 0, comments: 0, over18: false,
  };
}

if (import.meta.main) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
