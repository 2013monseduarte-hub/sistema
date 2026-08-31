/**
 * viral score — the ranking is the product. If velocity stops beating raw
 * upvotes, the tool starts recommending memes that already peaked.
 */

import { describe, test, expect } from 'bun:test';
import { ageHours, clamp01, rank, reusability, scoreItem, VELOCITY_REF } from '../viral/src/score';
import type { ViralItem } from '../viral/src/types';

const NOW = 1_700_000_000;

function item(over: Partial<ViralItem> = {}): ViralItem {
  return {
    id: 't3_x', kind: 'post', source: 'reddit', community: 'memes', author: 'u',
    title: 'un titulo cualquiera que sirve de relleno', text: '', url: 'https://example.com/x',
    isImage: true, createdUtc: NOW - 3600, score: 1000, comments: 100, upvoteRatio: 0.95,
    over18: false, ...over,
  };
}

describe('reusability', () => {
  test('empty, deleted and bot text score zero', () => {
    expect(reusability('')).toBe(0);
    expect(reusability('[deleted]')).toBe(0);
    expect(reusability('[removed]')).toBe(0);
    expect(reusability('Beep boop. I am a bot and this action was performed automatically.')).toBe(0);
    expect(reusability('Soy un bot, no me hagas caso')).toBe(0);
  });

  test('a caption-length line beats a one-word reply and a wall of text', () => {
    const punchy = reusability('Dije que sabía conducir manual y acabé pagando el embrague de mi jefe.');
    const tiny = reusability('No');
    const wall = reusability('x'.repeat(3000));
    expect(punchy).toBe(1);
    expect(tiny).toBeLessThan(0.2);
    expect(wall).toBeLessThan(0.3);
    expect(punchy).toBeGreaterThan(wall);
  });

  test('a link discounts the text — you cannot lift a URL into your own post', () => {
    const plain = 'Esta es la mejor explicación que he leído sobre el tema y me cambió la semana.';
    expect(reusability(`${plain} https://ejemplo.com/articulo`)).toBeLessThan(reusability(plain));
  });
});

describe('scoreItem', () => {
  test('age is floored so a brand-new post does not divide by ~zero', () => {
    expect(ageHours(NOW, NOW)).toBe(0.25);
    expect(ageHours(NOW - 7200, NOW)).toBe(2);
  });

  test('velocity beats raw upvotes: fresh and smaller outranks old and huge', () => {
    const fresh = scoreItem(item({ score: 4200, comments: 310, createdUtc: NOW - 0.7 * 3600 }), NOW);
    const old = scoreItem(item({ score: 90000, comments: 1200, createdUtc: NOW - 72 * 3600 }), NOW);
    expect(fresh.velocity).toBeGreaterThan(old.velocity);
    expect(fresh.viralScore).toBeGreaterThan(old.viralScore);
  });

  test('scores stay inside 0..100 at both extremes', () => {
    const nothing = scoreItem(item({ score: 0, comments: 0, upvoteRatio: 0 }), NOW);
    const absurd = scoreItem(item({ score: 10_000_000, comments: 5_000_000, createdUtc: NOW }), NOW);
    expect(nothing.viralScore).toBeGreaterThanOrEqual(0);
    expect(absurd.viralScore).toBeLessThanOrEqual(100);
  });

  test('a post at the reference pace lands near the top of the velocity band', () => {
    const atRef = scoreItem(item({ score: VELOCITY_REF, createdUtc: NOW - 3600, comments: 300 }), NOW);
    expect(atRef.viralScore).toBeGreaterThan(80);
  });

  test('comments are scored on reusability, posts on upvote ratio', () => {
    const quotable = scoreItem(
      item({ kind: 'comment', text: 'Dije que sabía conducir manual. Acabé pagando el embrague de mi jefe.', score: 900, comments: 10 }),
      NOW,
    );
    const mumble = scoreItem(item({ kind: 'comment', text: 'esto', score: 900, comments: 10 }), NOW);
    expect(quotable.viralScore).toBeGreaterThan(mumble.viralScore);
  });

  test('clamp01 survives NaN rather than poisoning the score', () => {
    expect(clamp01(Number.NaN)).toBe(0);
    expect(clamp01(-3)).toBe(0);
    expect(clamp01(9)).toBe(1);
  });
});

describe('rank', () => {
  test('returns best-first without mutating the input array', () => {
    const input = [
      item({ id: 'slow', score: 100, createdUtc: NOW - 100 * 3600 }),
      item({ id: 'fast', score: 5000, createdUtc: NOW - 3600 }),
    ];
    const out = rank(input, NOW);
    expect(out[0].id).toBe('fast');
    expect(out.every((i) => i.metrics !== undefined)).toBe(true);
    expect(input[0].metrics).toBeUndefined();
  });
});
