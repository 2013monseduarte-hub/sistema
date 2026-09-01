/**
 * viral reddit adapter — URL shapes, parsing, and the per-community failure
 * contract (a dead subreddit is REPORTED, never silently dropped: a pack that
 * quietly returns nothing is how you end up staring at an empty screen
 * thinking the internet had a slow day).
 *
 * Network is stubbed. GSTACK_HOME is redirected so egress receipts land in a
 * temp dir instead of the operator's ledger.
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  commentsUrl, fetchCommunities, fetchComments, listingUrl, parseComments,
  parseListing, postIdFrom, search, searchUrl, USER_AGENT,
} from '../viral/src/sources/reddit';

const ROOT = path.resolve(import.meta.dir, '..');
const listingFixture = JSON.parse(fs.readFileSync(path.join(ROOT, 'test/fixtures/viral-reddit-listing.json'), 'utf-8'));
const commentsFixture = JSON.parse(fs.readFileSync(path.join(ROOT, 'test/fixtures/viral-reddit-comments.json'), 'utf-8'));

let home: string;
let prevHome: string | undefined;

beforeAll(() => {
  prevHome = process.env.GSTACK_HOME;
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'viral-reddit-'));
  process.env.GSTACK_HOME = home;
});

afterAll(() => {
  if (prevHome === undefined) delete process.env.GSTACK_HOME;
  else process.env.GSTACK_HOME = prevHome;
  fs.rmSync(home, { recursive: true, force: true });
});

function stub(payload: unknown, ok = true, status = 200) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchImpl = (async (url: any, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return { ok, status, json: async () => payload } as unknown as Response;
  }) as typeof globalThis.fetch;
  return { auth: {}, fetchImpl, calls };
}

describe('url building', () => {
  test('listing url carries window, limit and raw_json', () => {
    const url = listingUrl('SpanishMeme', { window: 'week', limit: 30, listing: 'rising' });
    expect(url).toContain('/r/SpanishMeme/rising.json');
    expect(url).toContain('t=week');
    expect(url).toContain('limit=30');
    expect(url).toContain('raw_json=1');
  });

  test('limit is capped at 100 so a typo cannot ask for 10000', () => {
    expect(listingUrl('memes', { limit: 99999 })).toContain('limit=100');
  });

  test('search restricts to the given communities and escapes the query', () => {
    const url = searchUrl('gimnasio y café', ['memes', 'SpanishMeme'], { window: 'month' });
    expect(url).toContain('/r/memes+SpanishMeme/search.json');
    expect(url).toContain('restrict_sr=1');
    expect(url).toContain('q=gimnasio%20y%20caf%C3%A9');
  });

  test('search without communities goes site-wide', () => {
    const url = searchUrl('gatos', []);
    expect(url).toContain('https://www.reddit.com/search.json');
    expect(url).not.toContain('restrict_sr');
  });
});

describe('postIdFrom', () => {
  test('accepts permalinks, short links, fullnames and bare ids', () => {
    expect(postIdFrom('https://www.reddit.com/r/memes/comments/abc123/algo/')).toBe('abc123');
    expect(postIdFrom('https://redd.it/abc123')).toBe('abc123');
    expect(postIdFrom('t3_abc123')).toBe('abc123');
    expect(postIdFrom('abc123')).toBe('abc123');
  });

  test('rejects what it cannot resolve instead of guessing', () => {
    expect(postIdFrom('https://example.com/no-es-reddit')).toBeUndefined();
    expect(postIdFrom('')).toBeUndefined();
  });
});

describe('parseListing', () => {
  const items = parseListing(listingFixture);

  test('maps the fields that matter and builds absolute permalinks', () => {
    const first = items[0];
    expect(first.id).toBe('t3_aaa111');
    expect(first.kind).toBe('post');
    expect(first.community).toBe('SpanishMeme');
    expect(first.score).toBe(4200);
    expect(first.comments).toBe(310);
    expect(first.upvoteRatio).toBe(0.95);
    expect(first.url.startsWith('https://www.reddit.com/r/SpanishMeme/comments/aaa111/')).toBe(true);
    expect(first.mediaUrl).toContain('preview.redd.it');
    expect(first.isImage).toBe(true);
  });

  test('drops stickied mod posts — pinned is not viral', () => {
    expect(items.some((i) => i.id === 't3_ccc333')).toBe(false);
  });

  test('keeps +18 items but flags them, so --sfw can filter later', () => {
    const nsfw = items.find((i) => i.id === 't3_eee555');
    expect(nsfw?.over18).toBe(true);
  });

  test('text posts carry selftext and are not marked as images', () => {
    const story = items.find((i) => i.id === 't3_ddd444')!;
    expect(story.isImage).toBe(false);
    expect(story.text).toContain('camisa');
  });

  test('garbage in, empty array out — never a throw mid-run', () => {
    expect(parseListing(null)).toEqual([]);
    expect(parseListing({ data: {} })).toEqual([]);
    expect(parseListing({ data: { children: [{ kind: 't3', data: {} }] } })).toEqual([]);
  });
});

describe('parseComments', () => {
  const comments = parseComments(commentsFixture);

  test('walks the reply tree and stamps every comment with its post', () => {
    const top = comments.find((c) => c.id === 't1_c1')!;
    expect(top.kind).toBe('comment');
    expect(top.parentTitle).toContain('mentira');
    expect(top.parentId).toBe('t3_zzz999');
    expect(top.depth).toBe(0);
    expect(comments.find((c) => c.id === 't1_c1r1')?.depth).toBe(1);
  });

  test('skips deleted bodies and `more` stubs', () => {
    expect(comments.some((c) => c.text === '[deleted]')).toBe(false);
    expect(comments.every((c) => c.id.startsWith('t1_'))).toBe(true);
  });

  test('respects maxDepth so a 400-deep thread cannot blow the run up', () => {
    expect(parseComments(commentsFixture, 0).every((c) => c.depth === 0)).toBe(true);
  });

  test('a non-thread payload returns empty', () => {
    expect(parseComments({})).toEqual([]);
    expect(parseComments([{}])).toEqual([]);
  });
});

describe('fetching', () => {
  test('sends a real User-Agent and reads every community in the list', async () => {
    const { auth: {}, fetchImpl, calls } = stub(listingFixture);
    const result = await fetchCommunities(['SpanishMeme', 'memexico'], { auth: {}, fetchImpl, delayMs: 0 });
    expect(calls).toHaveLength(2);
    expect((calls[0].init?.headers as Record<string, string>)['User-Agent']).toBe(USER_AGENT);
    expect(result.errors).toEqual([]);
    expect(result.items.length).toBe(8);
  });

  test('one dead community is reported, the rest of the pack still returns', async () => {
    let n = 0;
    const fetchImpl = (async () => {
      n++;
      if (n === 1) return { ok: false, status: 404, json: async () => ({}) } as unknown as Response;
      return { ok: true, status: 200, json: async () => listingFixture } as unknown as Response;
    }) as typeof globalThis.fetch;
    const result = await fetchCommunities(['subredditQueYaNoExiste', 'memexico'], { auth: {}, fetchImpl, delayMs: 0 });
    expect(result.errors).toEqual([{ community: 'subredditQueYaNoExiste', reason: 'HTTP 404' }]);
    expect(result.items.length).toBe(4);
  });

  test('search failures come back as errors, not exceptions', async () => {
    const fetchImpl = (async () => {
      throw new Error('socket hang up');
    }) as typeof globalThis.fetch;
    const result = await search('memes', ['memes'], { auth: {}, fetchImpl, retries: 0 });
    expect(result.items).toEqual([]);
    expect(result.errors[0].reason).toBe('socket hang up');
  });

  test('comments fetch resolves a permalink to the comments endpoint', async () => {
    const { auth: {}, fetchImpl, calls } = stub(commentsFixture);
    const result = await fetchComments('https://www.reddit.com/r/AskReddit/comments/zzz999/slug/', { fetchImpl });
    expect(calls[0].url).toBe(commentsUrl('zzz999', 50));
    expect(result.items.length).toBeGreaterThan(0);
  });

  test('an unresolvable post reference fails before any network call', async () => {
    const { auth: {}, fetchImpl, calls } = stub(commentsFixture);
    const result = await fetchComments('https://example.com/nope', { fetchImpl });
    expect(calls).toHaveLength(0);
    expect(result.errors[0].reason).toContain('id');
  });

  test('every read leaves an egress receipt in the ledger', async () => {
    const { fetchImpl } = stub(listingFixture);
    await fetchCommunities(['memes'], { auth: {}, fetchImpl, delayMs: 0 });
    const ledger = path.join(home, 'security', 'egress.jsonl');
    expect(fs.existsSync(ledger)).toBe(true);
    const lines = fs.readFileSync(ledger, 'utf-8').trim().split('\n').map((l) => JSON.parse(l));
    const mine = lines.filter((l) => l.sink === 'viral-scrape');
    expect(mine.length).toBeGreaterThan(0);
    expect(mine[mine.length - 1].host).toBe('www.reddit.com');
    // content-free: the ledger records that we read, never what came back
    expect(JSON.stringify(mine)).not.toContain('SpanishMeme');
  });
});
