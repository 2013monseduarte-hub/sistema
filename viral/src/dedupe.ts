/**
 * dedupe — one meme, one row.
 *
 * The same image gets crossposted to six subreddits, and a pack that reads six
 * subreddits hands you the same joke six times. That is not a top 15, it is a
 * top 4 with padding.
 *
 * Two items are the same when they point at the same media file (the image id,
 * ignoring the resizing and signature query Reddit bolts on) or when their
 * titles are near-identical. The copy with the best score survives and carries
 * `duplicates` so the UI can say "×3" — that count is a signal in itself: a
 * joke that spread to five communities is travelling.
 */

import { similarity } from './remix';
import type { ViralItem } from './types';

/** title similarity above which two items are the same joke */
export const TITLE_MATCH = 0.8;

/**
 * The stable part of a media URL: `preview.redd.it/abc123.jpg?width=640&s=...`
 * and `i.redd.it/abc123.jpg` both reduce to `abc123.jpg`. Returns undefined
 * when there is no media to key on.
 */
export function mediaKey(url: string | undefined): string | undefined {
  if (!url) return undefined;
  const withoutQuery = url.split('?')[0];
  const file = withoutQuery.split('/').pop();
  if (!file || !file.includes('.')) return undefined;
  return file.toLowerCase();
}

function titleKey(item: ViralItem): string {
  return (item.kind === 'comment' ? item.text : item.title)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N} ]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Folds duplicates, keeping the highest-scoring copy of each.
 *
 * Input order decides the winner when scores tie, so rank BEFORE deduping if
 * you want the best copy to be the one that survives.
 */
export function dedupe(items: ViralItem[]): ViralItem[] {
  const kept: ViralItem[] = [];
  const keys: { media?: string; title: string }[] = [];

  for (const item of items) {
    const media = mediaKey(item.mediaUrl);
    const title = titleKey(item);
    let matchIndex = -1;

    for (let i = 0; i < kept.length; i++) {
      if (kept[i].kind !== item.kind) continue;
      const candidate = keys[i];
      const sameMedia = media !== undefined && candidate.media === media;
      const sameTitle =
        title.length > 0 && candidate.title.length > 0 &&
        (candidate.title === title || similarity(candidate.title, title) >= TITLE_MATCH);
      if (sameMedia || sameTitle) {
        matchIndex = i;
        break;
      }
    }

    if (matchIndex === -1) {
      kept.push({ ...item });
      keys.push({ media, title });
      continue;
    }

    const winner = kept[matchIndex];
    const folded = (winner.duplicates ?? 0) + 1;
    // keep whichever copy scores better, but never lose the running count
    if (best(item) > best(winner)) {
      kept[matchIndex] = { ...item, duplicates: folded };
      keys[matchIndex] = { media: media ?? keys[matchIndex].media, title: title || keys[matchIndex].title };
    } else {
      kept[matchIndex] = { ...winner, duplicates: folded };
    }
  }

  return kept;
}

function best(item: ViralItem): number {
  return item.metrics?.viralScore ?? item.score;
}
