/**
 * score — deterministic viral scoring.
 *
 * Raw upvotes rank the past. A post with 90K points from three days ago is
 * finished; a post with 4K points from 40 minutes ago is the one you can still
 * ride. So the headline number is VELOCITY (points/hour) on a log curve, not
 * the raw count.
 *
 * Weights differ by kind on purpose:
 *   - posts    lean on velocity + upvote ratio (is the crowd actually agreeing?)
 *   - comments lean on velocity + reusability (can this line be lifted as-is?)
 *
 * Pure functions, no clock reads inside the math — `now` is always injected so
 * the tests are stable.
 */

import type { ViralItem, ViralMetrics } from './types';

/** points/hour that maps to a ~1.0 velocity component. Front-page pace. */
export const VELOCITY_REF = 2000;
/** comments ÷ upvotes at which the engagement component saturates */
export const ENGAGEMENT_REF = 0.15;
/** text length band that reads best as a caption or a hook */
export const IDEAL_MIN_CHARS = 40;
export const IDEAL_MAX_CHARS = 280;

const BOT_MARKERS = [
  'i am a bot',
  'this action was performed automatically',
  'soy un bot',
  'bot de reddit',
];

export function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

/**
 * 0..1 — how directly this text can be lifted into your own post.
 *
 * Long essays and one-word replies both score low: the first needs rewriting,
 * the second carries no idea. Links and bot boilerplate zero it out.
 */
export function reusability(text: string): number {
  const trimmed = (text || '').trim();
  if (!trimmed) return 0;
  const lower = trimmed.toLowerCase();
  if (lower === '[deleted]' || lower === '[removed]') return 0;
  if (BOT_MARKERS.some((m) => lower.includes(m))) return 0;

  const len = trimmed.length;
  let base: number;
  if (len < IDEAL_MIN_CHARS) base = len / IDEAL_MIN_CHARS;
  else if (len <= IDEAL_MAX_CHARS) base = 1;
  else base = Math.max(0.25, IDEAL_MAX_CHARS / len);

  if (/https?:\/\//.test(trimmed)) base *= 0.7;
  // a punchline or an open question travels further than a flat statement
  if (/[?!]$/.test(trimmed)) base = Math.min(1, base * 1.05);
  return clamp01(base);
}

/** hours since publication, floored so a 2-minute-old post is not divided by ~0 */
export function ageHours(createdUtc: number, nowSeconds: number): number {
  return Math.max((nowSeconds - createdUtc) / 3600, 0.25);
}

export function scoreItem(item: ViralItem, nowSeconds: number = Date.now() / 1000): ViralMetrics {
  const age = ageHours(item.createdUtc, nowSeconds);
  const velocity = Math.max(item.score, 0) / age;
  const commentRatio = item.comments / Math.max(item.score, 1);

  const velocityPart = clamp01(Math.log10(1 + velocity) / Math.log10(1 + VELOCITY_REF));
  const engagementPart = clamp01(commentRatio / ENGAGEMENT_REF);
  const reuse = reusability(item.kind === 'comment' ? item.text : `${item.title} ${item.text}`.trim());
  const quality = clamp01(item.upvoteRatio ?? 0.9);

  const composite =
    item.kind === 'comment'
      ? 0.55 * velocityPart + 0.15 * engagementPart + 0.3 * reuse
      : 0.6 * velocityPart + 0.25 * engagementPart + 0.15 * quality;

  return {
    ageHours: round(age, 2),
    velocity: round(velocity, 1),
    commentRatio: round(commentRatio, 3),
    reusability: round(reuse, 3),
    viralScore: Math.round(clamp01(composite) * 100),
  };
}

/** Score every item and return a new array sorted best-first. */
export function rank(items: ViralItem[], nowSeconds: number = Date.now() / 1000): ViralItem[] {
  return items
    .map((item) => ({ ...item, metrics: scoreItem(item, nowSeconds) }))
    .sort((a, b) => (b.metrics!.viralScore - a.metrics!.viralScore) || (b.score - a.score));
}

function round(n: number, places: number): number {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}
