/**
 * remix — turn a found item into angles you can actually publish.
 *
 * The trap with "lo copio y le hago un cambio pequeño" is that a small change
 * is exactly what platforms detect and audiences recognise. Reposted-with-a-
 * caption content gets throttled as duplicate, and the account reads as an
 * aggregator instead of a voice. So this module does two things:
 *
 *   1. Gives you angles — concrete ways to rebuild the IDEA in your own
 *      material (context swap, format flip, inversion, true-story reframe...).
 *   2. Measures how close your draft still is to the original and says so.
 *
 * No API key needed: the angles are templates, and `promptFor()` prints a
 * ready-to-paste brief if you want a model to write the draft for you.
 */

import type { ViralItem } from './types';

export type ChangeLevel = 'superficial' | 'medio' | 'profundo';

export interface RemixAngle {
  id: string;
  name: string;
  /** what to change, in one line */
  idea: string;
  /** an opening line you can adapt */
  hook: string;
  /** the shape of the finished post */
  format: string;
  changeLevel: ChangeLevel;
}

export interface RemixOptions {
  /** your niche/topic, e.g. "gimnasio", "programación", "maternidad" */
  niche?: string;
  lang?: 'es' | 'en';
}

const NICHE_FALLBACK = 'tu nicho';

export function remixAngles(item: ViralItem, opts: RemixOptions = {}): RemixAngle[] {
  const niche = opts.niche?.trim() || NICHE_FALLBACK;
  const core = (item.kind === 'comment' ? item.text : item.title || item.text).trim();
  const short = core.length > 120 ? `${core.slice(0, 117)}...` : core;

  return [
    {
      id: 'contexto',
      name: 'Cambio de contexto',
      idea: `Misma estructura, otro mundo: lleva "${short}" a ${niche}.`,
      hook: `En ${niche} pasa exactamente lo mismo, pero nadie lo dice:`,
      format: 'Post corto o meme con tu propia imagen del contexto de tu nicho.',
      changeLevel: 'medio',
    },
    {
      id: 'historia-real',
      name: 'Historia real',
      idea: 'Convierte la idea en algo que te pasó a ti: fecha, lugar, un detalle concreto que solo tendría alguien que estuvo ahí.',
      hook: 'Esto me pasó hace tres semanas y todavía lo pienso:',
      format: 'Texto en primera persona. Gancho, escena, giro, una frase final que se pueda citar.',
      changeLevel: 'profundo',
    },
    {
      id: 'inversion',
      name: 'Inversión',
      idea: 'Sostén lo contrario de lo que dice el original, en serio, con un argumento que aguante los comentarios.',
      hook: 'Opinión impopular:',
      format: 'Post de una idea + una razón. La discusión en comentarios es el alcance.',
      changeLevel: 'profundo',
    },
    {
      id: 'formato',
      name: 'Cambio de formato',
      idea:
        item.kind === 'comment'
          ? 'El comentario es la publicación: sácalo del hilo y hazlo el titular.'
          : 'El post es el guion: pásalo a carrusel, hilo o vídeo de 20 segundos.',
      format: item.kind === 'comment' ? 'Post/tweet corto con la frase como titular.' : 'Carrusel de 5 láminas o vídeo corto.',
      hook: short,
      changeLevel: 'medio',
    },
    {
      id: 'localizacion',
      name: 'Localización',
      idea: 'Adáptalo a tu país y tu forma de hablar: referencias, precios, marcas, modismos. Lo genérico no se comparte.',
      hook: 'Versión local de esto que está circulando:',
      format: 'Mismo chiste, tus referencias. Cambia todos los nombres propios.',
      changeLevel: 'medio',
    },
    {
      id: 'pregunta',
      name: 'Pregunta abierta',
      idea: `Convierte la idea en una pregunta que tu audiencia de ${niche} quiera contestar. La respuesta de la gente es el contenido.`,
      hook: '¿Cuál fue la tuya?',
      format: 'Pregunta + tu propia respuesta primero, para dar el ejemplo.',
      changeLevel: 'profundo',
    },
  ];
}

/** A brief you can paste into any model to get the actual draft written. */
export function promptFor(item: ViralItem, angle: RemixAngle, opts: RemixOptions = {}): string {
  const niche = opts.niche?.trim() || NICHE_FALLBACK;
  const source = (item.kind === 'comment' ? item.text : `${item.title}\n${item.text}`).trim();
  return [
    `Contexto: estoy creando contenido sobre ${niche}.`,
    `Referencia (NO copiar, solo para entender por qué funcionó):`,
    `"""${source.slice(0, 800)}"""`,
    `Métrica: ${item.score} votos y ${item.comments} comentarios en r/${item.community}.`,
    ``,
    `Ángulo a usar: ${angle.name} — ${angle.idea}`,
    `Formato: ${angle.format}`,
    ``,
    `Escríbeme 3 versiones originales. Reglas:`,
    `- Nada de frases textuales de la referencia.`,
    `- Voz propia, en primera persona, con un detalle concreto e inventado por mí que yo pueda sostener.`,
    `- Primera línea que funcione sola como gancho.`,
    `- Sin emojis de relleno ni hashtags genéricos.`,
  ].join('\n');
}

/** Character-trigram Dice coefficient, 0..1. Cheap, language-agnostic, good enough to catch a copy-paste. */
export function similarity(a: string, b: string): number {
  const A = trigrams(a);
  const B = trigrams(b);
  if (A.size === 0 || B.size === 0) return a.trim() === b.trim() ? 1 : 0;
  let shared = 0;
  for (const t of A) if (B.has(t)) shared++;
  return (2 * shared) / (A.size + B.size);
}

/** Above this, your draft is the original wearing a hat. */
export const COPY_THRESHOLD = 0.6;

/**
 * Returns a warning when the draft is still too close to the source, or null
 * when it stands on its own. This is the guardrail against the "cambio
 * pequeño" that platforms flag as duplicate content.
 */
export function originalityCheck(source: string, draft: string): { similarity: number; warning: string | null } {
  const sim = Math.round(similarity(source, draft) * 100) / 100;
  if (sim < COPY_THRESHOLD) return { similarity: sim, warning: null };
  return {
    similarity: sim,
    warning:
      `Tu borrador se parece un ${Math.round(sim * 100)}% al original. A ese nivel es la misma publicación con otra ` +
      `tipografía: las plataformas lo tratan como duplicado y tu audiencia lo reconoce. Cambia la escena, el ejemplo ` +
      `y el final, o cita la fuente y comenta encima.`,
  };
}

function trigrams(text: string): Set<string> {
  const norm = text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const out = new Set<string>();
  for (let i = 0; i + 3 <= norm.length; i++) out.add(norm.slice(i, i + 3));
  return out;
}
