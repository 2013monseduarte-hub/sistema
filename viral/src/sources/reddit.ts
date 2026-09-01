/**
 * reddit adapter — public JSON listings, no API key, no login.
 *
 * Reddit is the right first source for this job: the memes that end up on
 * Instagram and TikTok are usually 24-72 hours old on Reddit first, and the
 * comment threads are the raw material for "historia real" style posts. Every
 * endpoint used here is the public `.json` view of a page anyone can open in a
 * browser.
 *
 * Split on purpose: `parse*` functions are pure (fixtures test them offline),
 * `fetch*` functions do the network through the receipted wrapper.
 *
 * Politeness: one request at a time per community with a small delay, a real
 * User-Agent, and `limit` capped. This is a research reader, not a crawler.
 */

import type { SourceResult, ViralItem } from '../types';
import { receiptedFetch, type FetchLike } from '../receipted-fetch';
import { authFromEnv, getAccessToken, hasCredentials, toOAuthUrl, type AuthConfig } from './reddit-auth';

export const USER_AGENT = 'gstack-viral/0.1 (personal content research; +https://github.com/garrytan/gstack)';
export const MAX_LIMIT = 100;
/** ms between requests — keeps a 6-subreddit pack under Reddit's patience */
export const REQUEST_DELAY_MS = 700;
/** how many times a throttled or 5xx request is retried before it becomes an error */
export const MAX_RETRIES = 2;
/** statuses worth retrying: throttling and the transient server-side family */
export const RETRY_STATUS = new Set([429, 500, 502, 503, 504]);
/** hard ceiling on an honored Retry-After — a header asking for an hour is a "come back later", not a wait */
export const MAX_RETRY_WAIT_MS = 60_000;

export type ListingKind = 'top' | 'hot' | 'rising' | 'new';
export type TimeWindow = 'hour' | 'day' | 'week' | 'month' | 'year' | 'all';

export interface FetchOptions {
  listing?: ListingKind;
  window?: TimeWindow;
  limit?: number;
  fetchImpl?: FetchLike;
  delayMs?: number;
  /** retries per request on 429/5xx (default MAX_RETRIES) */
  retries?: number;
  /** injectable sleep — tests pace a whole retry ladder without waiting for it */
  sleepImpl?: (ms: number) => Promise<void>;
  /**
   * Credenciales de la API oficial. Por defecto se leen del entorno; con ellas
   * las peticiones van al host autenticado, que es la única forma de leer
   * Reddit desde una IP de nube (ver reddit-auth.ts). Sin ellas, vía anónima.
   */
  auth?: AuthConfig;
}

const IMAGE_EXT = /\.(jpe?g|png|gif|webp)(\?|$)/i;

export function listingUrl(community: string, opts: FetchOptions = {}): string {
  const listing = opts.listing ?? 'top';
  const window = opts.window ?? 'day';
  const limit = Math.min(opts.limit ?? 50, MAX_LIMIT);
  return `https://www.reddit.com/r/${encodeURIComponent(community)}/${listing}.json?t=${window}&limit=${limit}&raw_json=1`;
}

export function searchUrl(query: string, communities: string[], opts: FetchOptions = {}): string {
  const window = opts.window ?? 'week';
  const limit = Math.min(opts.limit ?? 50, MAX_LIMIT);
  const scope = communities.length > 0 ? `r/${communities.map(encodeURIComponent).join('+')}/` : '';
  const restrict = communities.length > 0 ? '&restrict_sr=1' : '';
  return `https://www.reddit.com/${scope}search.json?q=${encodeURIComponent(query)}${restrict}&sort=top&t=${window}&limit=${limit}&raw_json=1`;
}

export function commentsUrl(postId: string, limit = 50): string {
  return `https://www.reddit.com/comments/${encodeURIComponent(postId)}.json?sort=top&limit=${Math.min(limit, MAX_LIMIT)}&raw_json=1`;
}

/** Accepts a full permalink, a short link, or a bare id and returns the id. */
export function postIdFrom(input: string): string | undefined {
  const trimmed = input.trim();
  const inUrl = trimmed.match(/\/comments\/([a-z0-9]+)/i) || trimmed.match(/redd\.it\/([a-z0-9]+)/i);
  if (inUrl) return inUrl[1];
  if (/^t3_([a-z0-9]+)$/i.test(trimmed)) return trimmed.slice(3);
  if (/^[a-z0-9]{5,10}$/i.test(trimmed)) return trimmed;
  return undefined;
}

function mediaFrom(data: Record<string, any>): string | undefined {
  const preview = data?.preview?.images?.[0]?.source?.url;
  if (typeof preview === 'string' && preview.startsWith('http')) return preview;
  if (typeof data?.url_overridden_by_dest === 'string' && IMAGE_EXT.test(data.url_overridden_by_dest)) {
    return data.url_overridden_by_dest;
  }
  if (typeof data?.url === 'string' && IMAGE_EXT.test(data.url)) return data.url;
  if (typeof data?.thumbnail === 'string' && data.thumbnail.startsWith('http')) return data.thumbnail;
  return undefined;
}

/** Pure: Reddit listing JSON -> ViralItem[]. Unknown/odd shapes are skipped, not thrown on. */
export function parseListing(json: unknown): ViralItem[] {
  const children = (json as any)?.data?.children;
  if (!Array.isArray(children)) return [];
  const items: ViralItem[] = [];
  for (const child of children) {
    if (child?.kind !== 't3') continue;
    const d = child.data;
    if (!d?.id) continue;
    if (d.stickied) continue; // pinned mod posts are never the viral thing
    const media = mediaFrom(d);
    items.push({
      id: `t3_${d.id}`,
      kind: 'post',
      source: 'reddit',
      community: d.subreddit ?? '',
      author: d.author ?? '[unknown]',
      title: d.title ?? '',
      text: typeof d.selftext === 'string' ? d.selftext : '',
      url: d.permalink ? `https://www.reddit.com${d.permalink}` : (d.url ?? ''),
      mediaUrl: media,
      isImage: Boolean(media) && (d.post_hint === 'image' || IMAGE_EXT.test(media ?? '')),
      createdUtc: Number(d.created_utc) || 0,
      score: Number(d.score) || 0,
      comments: Number(d.num_comments) || 0,
      upvoteRatio: typeof d.upvote_ratio === 'number' ? d.upvote_ratio : undefined,
      over18: Boolean(d.over_18),
    });
  }
  return items;
}

/**
 * Pure: the comments endpoint returns `[postListing, commentListing]`. Walks
 * the reply tree, skips `more` stubs and deleted bodies, and stamps every
 * comment with the post it came from so attribution survives.
 */
export function parseComments(json: unknown, maxDepth = 2): ViralItem[] {
  const arr = json as any[];
  if (!Array.isArray(arr) || arr.length < 2) return [];
  const post = parseListing(arr[0])[0];
  const out: ViralItem[] = [];

  const walk = (node: any, depth: number): void => {
    if (!node || node.kind !== 't1') return;
    const d = node.data;
    if (!d?.id) return;
    const body = typeof d.body === 'string' ? d.body : '';
    const isDead = body === '[deleted]' || body === '[removed]' || !body;
    if (!isDead && !d.stickied) {
      out.push({
        id: `t1_${d.id}`,
        kind: 'comment',
        source: 'reddit',
        community: d.subreddit ?? post?.community ?? '',
        author: d.author ?? '[unknown]',
        title: '',
        text: body,
        url: d.permalink ? `https://www.reddit.com${d.permalink}` : (post?.url ?? ''),
        isImage: false,
        createdUtc: Number(d.created_utc) || 0,
        score: Number(d.score) || 0,
        comments: Number(d.replies?.data?.children?.length) || 0,
        over18: Boolean(post?.over18),
        parentId: post?.id,
        parentTitle: post?.title,
        parentUrl: post?.url,
        depth,
      });
    }
    if (depth >= maxDepth) return;
    const replies = d.replies?.data?.children;
    if (Array.isArray(replies)) for (const r of replies) walk(r, depth + 1);
  };

  const top = arr[1]?.data?.children;
  if (Array.isArray(top)) for (const c of top) walk(c, 0);
  return out;
}

/**
 * How long to wait before retrying. Reddit answers a throttle with
 * `Retry-After`, in seconds or as an HTTP date; anything else falls back to
 * exponential backoff (1s, 2s, 4s). Returns null when the server is asking for
 * longer than we are willing to block the CLI for.
 */
export function retryDelayMs(res: { headers?: { get?(name: string): string | null } }, attempt: number, now = Date.now()): number | null {
  const header = res.headers?.get?.('Retry-After') ?? null;
  if (header) {
    const seconds = Number(header);
    const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(header) - now;
    if (Number.isFinite(ms) && ms > 0) return ms > MAX_RETRY_WAIT_MS ? null : ms;
  }
  return Math.min(1000 * 2 ** attempt, MAX_RETRY_WAIT_MS);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * One request, with retries on throttling, transient server errors, and
 * network faults (a socket hang up is the single most common failure on a
 * flaky connection, and it is exactly the one worth repeating).
 *
 * A 404 (community gone) or a 403 (private) is NOT retried: repeating it just
 * makes us look worse to the host and the answer will not change.
 */
async function getJson(payloadClass: string, url: string, opts: FetchOptions = {}): Promise<unknown> {
  const retries = opts.retries ?? MAX_RETRIES;
  const nap = opts.sleepImpl ?? sleep;
  const auth = opts.auth ?? authFromEnv();

  // Con credenciales: host autenticado y cabecera Bearer. Sin ellas: como
  // siempre. El fallo al pedir el token se propaga tal cual, porque
  // "credenciales mal" y "subreddit caído" son problemas distintos y no deben
  // parecer el mismo aviso.
  let target = url;
  const headers: Record<string, string> = { 'User-Agent': USER_AGENT, Accept: 'application/json' };
  if (hasCredentials(auth)) {
    headers.Authorization = `bearer ${await getAccessToken({ ...auth, fetchImpl: opts.fetchImpl ?? auth.fetchImpl, userAgent: USER_AGENT })}`;
    target = toOAuthUrl(url);
  }

  let lastError = new Error('HTTP 0');
  for (let attempt = 0; attempt <= retries; attempt++) {
    let wait: number | null = null;
    try {
      const res = await receiptedFetch(
        payloadClass,
        target,
        { headers },
        opts.fetchImpl ?? globalThis.fetch,
      );
      if (res.ok) return await res.json();
      lastError = new Error(`HTTP ${res.status}`);
      if (!RETRY_STATUS.has(res.status)) break;
      wait = retryDelayMs(res, attempt);
    } catch (err) {
      lastError = err as Error;
      wait = retryDelayMs({}, attempt);
    }
    // out of attempts, or the host asked for longer than we will hold the CLI
    if (attempt === retries || wait === null) break;
    await nap(wait);
  }
  throw lastError;
}

/** Top/hot/rising posts across a list of communities. Per-community failures are collected, not thrown. */
export async function fetchCommunities(communities: string[], opts: FetchOptions = {}): Promise<SourceResult> {
  const items: ViralItem[] = [];
  const errors: SourceResult['errors'] = [];
  const delay = opts.delayMs ?? REQUEST_DELAY_MS;
  for (const [i, community] of communities.entries()) {
    if (i > 0 && delay > 0) await sleep(delay);
    try {
      items.push(...parseListing(await getJson('reddit-listing', listingUrl(community, opts), opts)));
    } catch (err) {
      errors.push({ community, reason: (err as Error).message });
    }
  }
  return { items, errors };
}

/** Keyword search, optionally restricted to a set of communities. */
export async function search(query: string, communities: string[], opts: FetchOptions = {}): Promise<SourceResult> {
  try {
    const json = await getJson('reddit-search', searchUrl(query, communities, opts), opts);
    return { items: parseListing(json), errors: [] };
  } catch (err) {
    return { items: [], errors: [{ community: communities.join('+') || 'all', reason: (err as Error).message }] };
  }
}

/**
 * Top comments of several posts, paced like every other read.
 *
 * Pacing lives here, in the adapter, and not in the caller: a loop in a command
 * that forgets to sleep is exactly how a polite tool starts collecting 429s
 * (which is what `mina` used to do).
 */
export async function fetchCommentsBatch(postRefs: string[], opts: FetchOptions = {}): Promise<SourceResult> {
  const items: ViralItem[] = [];
  const errors: SourceResult['errors'] = [];
  const delay = opts.delayMs ?? REQUEST_DELAY_MS;
  const nap = opts.sleepImpl ?? sleep;
  for (const [i, ref] of postRefs.entries()) {
    if (i > 0 && delay > 0) await nap(delay);
    const result = await fetchComments(ref, opts);
    items.push(...result.items);
    errors.push(...result.errors);
  }
  return { items, errors };
}

/** Top comments of one post. `postRef` may be a permalink, a short link, or an id. */
export async function fetchComments(postRef: string, opts: FetchOptions = {}): Promise<SourceResult> {
  const id = postIdFrom(postRef);
  if (!id) return { items: [], errors: [{ community: postRef, reason: 'no pude extraer el id del post' }] };
  try {
    const json = await getJson('reddit-comments', commentsUrl(id, opts.limit ?? 50), opts);
    return { items: parseComments(json), errors: [] };
  } catch (err) {
    return { items: [], errors: [{ community: id, reason: (err as Error).message }] };
  }
}
