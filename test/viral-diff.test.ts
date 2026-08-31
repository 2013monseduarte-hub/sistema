/**
 * viral diff — what is still climbing between two runs.
 *
 * The subtle part, and the reason this is not a one-liner: an item that stays
 * on the front page all afternoon shows a FALLING average velocity (same votes,
 * more hours) even while it keeps racing. So the trend is judged on the pace
 * BETWEEN the runs, held against the average pace at the earlier run.
 */

import { describe, test, expect } from 'bun:test';
import { byTrend, diffRuns, MIN_HOURS_BETWEEN } from '../viral/src/diff';
import { renderDiff } from '../viral/src/render';
import type { SavedRun, ViralItem } from '../viral/src/types';

const NOW = 1_700_000_000;

function item(id: string, score: number, velocity: number, over: Partial<ViralItem> = {}): ViralItem {
  return {
    id, kind: 'post', source: 'reddit', community: 'memes', author: 'u',
    title: `titulo de ${id}`, text: '', url: `https://reddit.com/${id}`,
    isImage: true, createdUtc: NOW - 3600, score, comments: 10, over18: false,
    metrics: { ageHours: 1, velocity, commentRatio: 0.1, reusability: 1, viralScore: 50 },
    ...over,
  };
}

function run(createdAt: string, items: ViralItem[], over: Partial<SavedRun['meta']> = {}): SavedRun {
  return {
    meta: { command: 'trending', pack: 'memes-es', communities: ['memes'], window: 'day', createdAt, count: items.length, ...over },
    items,
  };
}

const T0 = '2026-08-31T10:00:00.000Z';
const T2 = '2026-08-31T12:00:00.000Z';

describe('diffRuns', () => {
  test('measures the gap between the two runs', () => {
    const diff = diffRuns(run(T0, []), run(T2, []));
    expect(diff.hoursBetween).toBe(2);
  });

  test('an item still gaining votes faster than its old average is accelerating', () => {
    // 1000 -> 5000 in 2h = 2000/h, against an old average of 1000/h
    const before = run(T0, [item('t3_a', 1000, 1000)]);
    const after = run(T2, [item('t3_a', 5000, 750)]);
    const entry = diffRuns(before, after).entries[0];
    expect(entry.trend).toBe('acelera');
    expect(entry.deltaScore).toBe(4000);
    expect(entry.recentPace).toBe(2000);
    expect(entry.previousPace).toBe(1000);
  });

  test('a falling average velocity alone does NOT mark an item as cooling', () => {
    // this is the trap: velocity dropped 1000 -> 750, but the item gained 4000 votes
    const entry = diffRuns(run(T0, [item('t3_a', 1000, 1000)]), run(T2, [item('t3_a', 5000, 750)])).entries[0];
    expect(entry.item.metrics!.velocity).toBeLessThan(1000);
    expect(entry.trend).toBe('acelera');
  });

  test('an item that barely moved is cooling', () => {
    // 5000 -> 5100 in 2h = 50/h, against an old average of 1000/h
    const entry = diffRuns(run(T0, [item('t3_a', 5000, 1000)]), run(T2, [item('t3_a', 5100, 900)])).entries[0];
    expect(entry.trend).toBe('enfria');
    expect(entry.recentPace).toBe(50);
  });

  test('an item absent from the earlier run is new, priced at its own velocity', () => {
    const entry = diffRuns(run(T0, []), run(T2, [item('t3_new', 800, 640)])).entries[0];
    expect(entry.trend).toBe('nuevo');
    expect(entry.recentPace).toBe(640);
    expect(entry.previousPace).toBe(0);
  });

  test('entries come back fastest-first', () => {
    const before = run(T0, [item('t3_slow', 1000, 500), item('t3_fast', 1000, 500)]);
    const after = run(T2, [item('t3_slow', 1100, 500), item('t3_fast', 9000, 500)]);
    expect(diffRuns(before, after).entries.map((e) => e.item.id)).toEqual(['t3_fast', 't3_slow']);
  });

  test('items that fell out of the ranking are reported, not lost', () => {
    const diff = diffRuns(run(T0, [item('t3_gone', 900, 100)]), run(T2, [item('t3_new', 900, 100)]));
    expect(diff.dropped.map((i) => i.id)).toEqual(['t3_gone']);
  });

  test('comparing two different searches is flagged as loose', () => {
    expect(diffRuns(run(T0, [], { pack: 'memes-es' }), run(T2, [], { pack: 'historias-es' })).mismatched).toBe(true);
    expect(diffRuns(run(T0, []), run(T2, [])).mismatched).toBe(false);
  });

  test('two runs a minute apart cannot manufacture an enormous pace', () => {
    const diff = diffRuns(
      run('2026-08-31T12:00:00.000Z', [item('t3_a', 1000, 100)]),
      run('2026-08-31T12:01:00.000Z', [item('t3_a', 1100, 100)]),
    );
    expect(diff.hoursBetween).toBe(MIN_HOURS_BETWEEN);
    expect(diff.entries[0].recentPace).toBe(1000);
  });

  test('byTrend groups without re-sorting', () => {
    const diff = diffRuns(run(T0, [item('t3_a', 1000, 1000)]), run(T2, [item('t3_a', 9000, 900), item('t3_b', 500, 500)]));
    expect(byTrend(diff, 'acelera').map((e) => e.item.id)).toEqual(['t3_a']);
    expect(byTrend(diff, 'nuevo').map((e) => e.item.id)).toEqual(['t3_b']);
    expect(byTrend(diff, 'enfria')).toEqual([]);
  });
});

describe('renderDiff', () => {
  const diff = diffRuns(
    run(T0, [item('t3_a', 1000, 1000), item('t3_gone', 900, 100)]),
    run(T2, [item('t3_a', 9000, 900), item('t3_b', 500, 500)]),
  );
  const text = renderDiff(diff);

  test('leads with what is still climbing', () => {
    expect(text.indexOf('SIGUE SUBIENDO')).toBeLessThan(text.indexOf('NUEVO DESDE'));
    expect(text.indexOf('NUEVO DESDE')).toBeLessThan(text.indexOf('ENFRIANDO'));
  });

  test('shows the gap, the votes gained and the pace', () => {
    expect(text).toContain('2h');
    expect(text).toContain('+8.0k votos');
    expect(text).toContain('/h');
  });

  test('an empty group prints a dash rather than nothing', () => {
    expect(text).toContain('—');
  });

  test('reports what dropped out', () => {
    expect(text).toContain('Salieron del ranking: 1');
  });

  test('warns when the two runs were different searches', () => {
    const loose = renderDiff(diffRuns(run(T0, [], { pack: 'a' }), run(T2, [], { pack: 'b' })));
    expect(loose).toContain('orientativa');
  });
});
