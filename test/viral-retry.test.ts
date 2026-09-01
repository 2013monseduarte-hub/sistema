/**
 * viral retry ladder — what happens when Reddit says "slow down".
 *
 * The failure this prevents: a pack of six communities hitting a 429 and
 * silently coming back with two of them, which reads like a quiet day on the
 * internet instead of a throttle.
 *
 * Sleep is injected everywhere, so the whole ladder runs in microseconds.
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  fetchComments, fetchCommentsBatch, fetchCommunities, MAX_RETRIES, MAX_RETRY_WAIT_MS,
  REQUEST_DELAY_MS, retryDelayMs, RETRY_STATUS,
} from '../viral/src/sources/reddit';

const ROOT = path.resolve(import.meta.dir, '..');
const listing = JSON.parse(fs.readFileSync(path.join(ROOT, 'test/fixtures/viral-reddit-listing.json'), 'utf-8'));
const thread = JSON.parse(fs.readFileSync(path.join(ROOT, 'test/fixtures/viral-reddit-comments.json'), 'utf-8'));

let home: string;
let prevHome: string | undefined;

beforeAll(() => {
  prevHome = process.env.GSTACK_HOME;
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'viral-retry-'));
  process.env.GSTACK_HOME = home;
});

afterAll(() => {
  if (prevHome === undefined) delete process.env.GSTACK_HOME;
  else process.env.GSTACK_HOME = prevHome;
  fs.rmSync(home, { recursive: true, force: true });
});

/** A response whose status comes from the script, one entry per call. */
function scripted(statuses: (number | 'throw')[], payload: unknown, headers: Record<string, string> = {}) {
  let call = 0;
  const fetchImpl = (async () => {
    const status = statuses[Math.min(call, statuses.length - 1)];
    call++;
    if (status === 'throw') throw new Error('socket hang up');
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (name: string) => headers[name] ?? null },
      json: async () => payload,
    } as unknown as Response;
  }) as typeof globalThis.fetch;
  return { auth: {}, fetchImpl, calls: () => call };
}

function recorder() {
  const waits: number[] = [];
  return { waits, sleepImpl: async (ms: number) => { waits.push(ms); } };
}

describe('retryDelayMs', () => {
  test('honors a numeric Retry-After in seconds', () => {
    expect(retryDelayMs({ headers: { get: () => '3' } }, 0)).toBe(3000);
  });

  test('honors an HTTP-date Retry-After', () => {
    const now = Date.parse('2026-08-31T12:00:00Z');
    const later = new Date(now + 5000).toUTCString();
    expect(retryDelayMs({ headers: { get: () => later } }, 0, now)).toBeGreaterThan(3000);
  });

  test('gives up rather than blocking the CLI for an hour', () => {
    expect(retryDelayMs({ headers: { get: () => '3600' } }, 0)).toBeNull();
  });

  test('falls back to exponential backoff without the header', () => {
    expect(retryDelayMs({}, 0)).toBe(1000);
    expect(retryDelayMs({}, 1)).toBe(2000);
    expect(retryDelayMs({}, 2)).toBe(4000);
  });

  test('backoff is capped', () => {
    expect(retryDelayMs({}, 20)).toBe(MAX_RETRY_WAIT_MS);
  });

  test('a past date or garbage header still yields a usable backoff', () => {
    expect(retryDelayMs({ headers: { get: () => 'ayer' } }, 0)).toBe(1000);
    expect(retryDelayMs({ headers: { get: () => '-5' } }, 1)).toBe(2000);
  });
});

describe('getJson retries', () => {
  test('a 429 is retried and the run recovers', async () => {
    const { auth: {}, fetchImpl, calls } = scripted([429, 200], listing, { 'Retry-After': '2' });
    const { waits, sleepImpl } = recorder();
    const result = await fetchCommunities(['memes'], { auth: {}, fetchImpl, sleepImpl, delayMs: 0 });
    expect(calls()).toBe(2);
    expect(waits).toEqual([2000]);
    expect(result.errors).toEqual([]);
    expect(result.items.length).toBe(4);
  });

  test('every retryable status is in the ladder, 404 and 403 are not', () => {
    expect([...RETRY_STATUS].sort((a, b) => a - b)).toEqual([429, 500, 502, 503, 504]);
    expect(RETRY_STATUS.has(404)).toBe(false);
    expect(RETRY_STATUS.has(403)).toBe(false);
  });

  test('a 404 is not retried — the answer will not change', async () => {
    const { auth: {}, fetchImpl, calls } = scripted([404], listing);
    const { waits, sleepImpl } = recorder();
    const result = await fetchCommunities(['yaNoExiste'], { auth: {}, fetchImpl, sleepImpl, delayMs: 0 });
    expect(calls()).toBe(1);
    expect(waits).toEqual([]);
    expect(result.errors[0].reason).toBe('HTTP 404');
  });

  test('a network fault is retried too, then reported', async () => {
    const { auth: {}, fetchImpl, calls } = scripted(['throw'], listing);
    const { waits, sleepImpl } = recorder();
    const result = await fetchCommunities(['memes'], { auth: {}, fetchImpl, sleepImpl, delayMs: 0 });
    expect(calls()).toBe(MAX_RETRIES + 1);
    expect(waits).toEqual([1000, 2000]);
    expect(result.errors[0].reason).toBe('socket hang up');
  });

  test('a sustained throttle gives up after the ladder and says 429', async () => {
    const { auth: {}, fetchImpl, calls } = scripted([429], listing);
    const { sleepImpl } = recorder();
    const result = await fetchCommunities(['memes'], { auth: {}, fetchImpl, sleepImpl, delayMs: 0 });
    expect(calls()).toBe(MAX_RETRIES + 1);
    expect(result.errors[0].reason).toBe('HTTP 429');
  });

  test('a Retry-After longer than the ceiling stops the ladder immediately', async () => {
    const { auth: {}, fetchImpl, calls } = scripted([503], listing, { 'Retry-After': '7200' });
    const { waits, sleepImpl } = recorder();
    await fetchCommunities(['memes'], { auth: {}, fetchImpl, sleepImpl, delayMs: 0 });
    expect(calls()).toBe(1);
    expect(waits).toEqual([]);
  });

  test('--retries 0 opts out entirely', async () => {
    const { auth: {}, fetchImpl, calls } = scripted([429], listing);
    await fetchCommunities(['memes'], { auth: {}, fetchImpl, retries: 0, delayMs: 0 });
    expect(calls()).toBe(1);
  });
});

describe('fetchCommentsBatch', () => {
  test('paces the comment reads the same way as the listing reads', async () => {
    const { auth: {}, fetchImpl, calls } = scripted([200], thread);
    const { waits, sleepImpl } = recorder();
    const result = await fetchCommentsBatch(['t3_a', 't3_b', 't3_c'], { auth: {}, fetchImpl, sleepImpl });
    expect(calls()).toBe(3);
    // three requests, two gaps — the bug this replaced fired all three back to back
    expect(waits).toEqual([REQUEST_DELAY_MS, REQUEST_DELAY_MS]);
    expect(result.items.length).toBeGreaterThan(0);
  });

  test('one bad post reference does not sink the batch', async () => {
    const { fetchImpl } = scripted([200], thread);
    const result = await fetchCommentsBatch(['t3_a', 'https://example.com/no'], { auth: {}, fetchImpl, delayMs: 0 });
    expect(result.errors).toHaveLength(1);
    expect(result.items.length).toBeGreaterThan(0);
  });

  test('an empty batch is a no-op, not a request', async () => {
    const { auth: {}, fetchImpl, calls } = scripted([200], thread);
    const result = await fetchCommentsBatch([], { fetchImpl });
    expect(calls()).toBe(0);
    expect(result).toEqual({ items: [], errors: [] });
  });

  test('a single fetchComments still works unchanged', async () => {
    const { fetchImpl } = scripted([200], thread);
    const result = await fetchComments('t3_zzz999', { fetchImpl });
    expect(result.items.length).toBeGreaterThan(0);
  });
});
