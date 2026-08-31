/**
 * buscar — la búsqueda de virales como función de servidor.
 *
 * Devuelve el tablero HTML ya montado (el mismo `renderHtml` que usa la CLI) o
 * JSON con `?formato=json`. La lógica es la que está probada en test/viral-*;
 * aquí solo hay traducción de parámetros y límites propios del entorno.
 *
 * LÍMITE QUE MANDA: una función de Netlify tiene ~10 segundos. Un pack de seis
 * comunidades con la pausa de 700ms de la CLI se come casi todo el presupuesto,
 * así que aquí la pausa baja a 350ms, se topa el número de comunidades y se
 * reintenta una sola vez. La respuesta se cachea 5 minutos: sin eso, cada
 * recarga del navegador sería otra ronda de peticiones a Reddit.
 */

import { dedupe } from '../../viral/src/dedupe';
import { BUILTIN_PACKS, resolvePack } from '../../viral/src/packs';
import { renderHtml } from '../../viral/src/render';
import { rank } from '../../viral/src/score';
import { fetchCommunities, search, type TimeWindow } from '../../viral/src/sources/reddit';
import type { RunMeta } from '../../viral/src/types';

/** cuántas comunidades caben en el presupuesto de tiempo de la función */
const MAX_COMMUNITIES = 6;
/** pausa entre peticiones: más corta que en la CLI porque aquí el reloj corre */
const DELAY_MS = 350;
const CACHE_SECONDS = 300;
const WINDOWS: TimeWindow[] = ['hour', 'day', 'week', 'month', 'year', 'all'];

export default async (req: Request): Promise<Response> => {
  const url = new URL(req.url);
  const packName = url.searchParams.get('pack') ?? 'memes-es';
  const query = url.searchParams.get('q')?.trim() ?? '';
  const asJson = url.searchParams.get('formato') === 'json';
  const windowParam = url.searchParams.get('ventana') ?? 'day';
  const window: TimeWindow = WINDOWS.includes(windowParam as TimeWindow) ? (windowParam as TimeWindow) : 'day';
  const top = clamp(Number(url.searchParams.get('top')) || 15, 1, 50);

  const pack = resolvePack(packName);
  if (!pack) {
    return json({ error: `pack desconocido: ${packName}`, packs: Object.keys(BUILTIN_PACKS) }, 400);
  }
  const communities = pack.communities.slice(0, MAX_COMMUNITIES);
  const opts = { window, limit: 50, delayMs: DELAY_MS, retries: 1 };

  const result = query
    ? await search(query, communities, opts)
    : await fetchCommunities(communities, opts);

  const items = dedupe(rank(result.items.filter((i) => !i.over18))).slice(0, top);
  const meta: RunMeta = {
    command: query ? `buscar "${query}"` : `trending · ${packName}`,
    query: query || undefined,
    pack: packName,
    communities,
    window,
    createdAt: new Date().toISOString(),
    count: items.length,
  };

  if (asJson) return json({ meta, items, errores: result.errors }, 200);

  // Las comunidades caídas se ven en la página, no se pierden en un log.
  const avisos = result.errors
    .map((e) => `<p class="aviso">r/${escapeHtml(e.community)}: ${escapeHtml(e.reason)} — ¿existe, es privada, o cambió de nombre?</p>`)
    .join('\n');
  const page = renderHtml(items, meta).replace('<main class="grid">', `${avisos}\n<main class="grid">`);

  return new Response(page, {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': `public, max-age=${CACHE_SECONDS}`,
    },
  });
};

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': `public, max-age=${CACHE_SECONDS}`,
    },
  });
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(Math.max(n, min), max);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
