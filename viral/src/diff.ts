/**
 * diff — what is ACCELERATING since your last run.
 *
 * A single run tells you what is hot. Two runs tell you what is still climbing,
 * which is the only one you can still catch. The trick is not to compare the
 * velocity fields: an item that stays on the front page all afternoon shows a
 * FALLING average velocity (same votes, more hours) even while it keeps racing.
 *
 * So the measure is the pace BETWEEN the two runs — votes gained divided by the
 * hours elapsed — held against the average pace the item had at the previous
 * run. Recent pace above the old average means it is still picking up speed.
 */

import type { SavedRun, ViralItem } from './types';

export type Trend = 'nuevo' | 'acelera' | 'enfria';

export interface DiffEntry {
  item: ViralItem;
  trend: Trend;
  /** votes gained between the two runs */
  deltaScore: number;
  /** votes per hour between the two runs */
  recentPace: number;
  /** the item's average votes/hour as of the earlier run (0 for new items) */
  previousPace: number;
}

export interface RunDiff {
  hoursBetween: number;
  entries: DiffEntry[];
  /** true when the two runs asked different questions, so the comparison is loose */
  mismatched: boolean;
  /** items in the earlier run that the later one no longer surfaces */
  dropped: ViralItem[];
}

/** floor on the gap so two runs a minute apart cannot manufacture a huge pace */
export const MIN_HOURS_BETWEEN = 0.1;

export function diffRuns(previous: SavedRun, current: SavedRun): RunDiff {
  const hoursBetween = Math.max(
    (Date.parse(current.meta.createdAt) - Date.parse(previous.meta.createdAt)) / 3_600_000,
    MIN_HOURS_BETWEEN,
  );
  const before = new Map(previous.items.map((i) => [i.id, i]));
  const entries: DiffEntry[] = [];

  for (const item of current.items) {
    const old = before.get(item.id);
    if (!old) {
      entries.push({
        item,
        trend: 'nuevo',
        deltaScore: item.score,
        recentPace: item.metrics?.velocity ?? 0,
        previousPace: 0,
      });
      continue;
    }
    const deltaScore = item.score - old.score;
    const recentPace = deltaScore / hoursBetween;
    const previousPace = old.metrics?.velocity ?? 0;
    entries.push({
      item,
      trend: recentPace >= previousPace ? 'acelera' : 'enfria',
      deltaScore,
      recentPace,
      previousPace,
    });
  }

  entries.sort((a, b) => b.recentPace - a.recentPace);
  const now = new Set(current.items.map((i) => i.id));
  return {
    hoursBetween: Math.round(hoursBetween * 100) / 100,
    entries,
    mismatched:
      previous.meta.command !== current.meta.command || previous.meta.pack !== current.meta.pack,
    dropped: previous.items.filter((i) => !now.has(i.id)),
  };
}

export function byTrend(diff: RunDiff, trend: Trend): DiffEntry[] {
  return diff.entries.filter((e) => e.trend === trend);
}
