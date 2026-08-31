/**
 * viral dedupe — one meme, one row.
 *
 * A six-subreddit pack that returns the same crossposted image six times gives
 * you a top 15 that is really a top 4. The count of folded copies is kept
 * because it is signal: a joke in five communities is travelling.
 */

import { describe, test, expect } from 'bun:test';
import { dedupe, mediaKey, TITLE_MATCH } from '../viral/src/dedupe';
import { rank } from '../viral/src/score';
import type { ViralItem } from '../viral/src/types';

const NOW = 1_700_000_000;

function item(over: Partial<ViralItem> = {}): ViralItem {
  return {
    id: 't3_a', kind: 'post', source: 'reddit', community: 'memes', author: 'u',
    title: 'Cuando el lunes te mira fijamente', text: '', url: 'https://reddit.com/a',
    isImage: true, createdUtc: NOW - 3600, score: 1000, comments: 100, over18: false, ...over,
  };
}

describe('mediaKey', () => {
  test('strips the resize and signature query reddit bolts on', () => {
    expect(mediaKey('https://preview.redd.it/abc123.jpg?width=640&s=deadbeef')).toBe('abc123.jpg');
    expect(mediaKey('https://i.redd.it/abc123.jpg')).toBe('abc123.jpg');
  });

  test('is case-insensitive and undefined when there is nothing to key on', () => {
    expect(mediaKey('https://i.redd.it/ABC.PNG')).toBe('abc.png');
    expect(mediaKey(undefined)).toBeUndefined();
    expect(mediaKey('https://www.reddit.com/r/memes/comments/x/')).toBeUndefined();
  });
});

describe('dedupe', () => {
  test('folds the same image posted to three communities into one row', () => {
    const out = dedupe([
      item({ id: 't3_a', community: 'memes', mediaUrl: 'https://preview.redd.it/x.jpg?width=640&s=aaa' }),
      item({ id: 't3_b', community: 'dankmemes', mediaUrl: 'https://i.redd.it/x.jpg', title: 'otro titulo' }),
      item({ id: 't3_c', community: 'meme', mediaUrl: 'https://preview.redd.it/x.jpg?width=320&s=bbb', title: 'y otro' }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].duplicates).toBe(2);
  });

  test('keeps the best-scoring copy, and the count survives the swap', () => {
    const ranked = rank(
      [
        item({ id: 't3_weak', community: 'memes', score: 100, mediaUrl: 'https://i.redd.it/x.jpg' }),
        item({ id: 't3_strong', community: 'dankmemes', score: 9000, mediaUrl: 'https://i.redd.it/x.jpg' }),
      ],
      NOW,
    );
    const out = dedupe(ranked);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('t3_strong');
    expect(out[0].duplicates).toBe(1);
  });

  test('near-identical titles fold even without shared media', () => {
    const out = dedupe([
      item({ id: 't3_a', mediaUrl: undefined, isImage: false, title: 'Mi jefe me pidió trabajar el domingo' }),
      item({ id: 't3_b', mediaUrl: undefined, isImage: false, title: 'Mi jefe me pidio trabajar el domingo!' }),
    ]);
    expect(out).toHaveLength(1);
  });

  test('different jokes stay separate', () => {
    const out = dedupe([
      item({ id: 't3_a', mediaUrl: 'https://i.redd.it/uno.jpg', title: 'Cuando el lunes te mira' }),
      item({ id: 't3_b', mediaUrl: 'https://i.redd.it/dos.jpg', title: 'Receta de tortilla de patatas' }),
    ]);
    expect(out).toHaveLength(2);
    expect(out.every((i) => i.duplicates === undefined)).toBe(true);
  });

  test('a post and a comment never fold into each other', () => {
    const shared = 'Mi jefe me pidió trabajar el domingo';
    const out = dedupe([
      item({ id: 't3_a', mediaUrl: undefined, title: shared }),
      item({ id: 't1_b', kind: 'comment', mediaUrl: undefined, title: '', text: shared }),
    ]);
    expect(out).toHaveLength(2);
  });

  test('empty titles do not collapse every untitled item into one', () => {
    const out = dedupe([
      item({ id: 't3_a', title: '', mediaUrl: 'https://i.redd.it/uno.jpg' }),
      item({ id: 't3_b', title: '', mediaUrl: 'https://i.redd.it/dos.jpg' }),
    ]);
    expect(out).toHaveLength(2);
  });

  test('the input array is not mutated', () => {
    const input = [
      item({ id: 't3_a', mediaUrl: 'https://i.redd.it/x.jpg' }),
      item({ id: 't3_b', mediaUrl: 'https://i.redd.it/x.jpg' }),
    ];
    dedupe(input);
    expect(input).toHaveLength(2);
    expect(input[0].duplicates).toBeUndefined();
  });

  test('the title threshold is a real similarity, not an exact match', () => {
    expect(TITLE_MATCH).toBeGreaterThan(0.5);
    expect(TITLE_MATCH).toBeLessThan(1);
  });

  test('an empty list is an empty list', () => {
    expect(dedupe([])).toEqual([]);
  });
});
