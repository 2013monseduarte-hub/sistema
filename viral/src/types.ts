/**
 * viral — shared types for the meme / viral-comment finder.
 *
 * One shape (`ViralItem`) covers both a post and a comment so the scorer,
 * renderer, and remix engine never branch on source. Adding a second source
 * (TikTok, IG, X) means writing an adapter that emits ViralItem, nothing else.
 */

export type ItemKind = 'post' | 'comment';

export interface ViralMetrics {
  /** hours since the item was published (floored at 0.25 so brand-new items don't divide by ~0) */
  ageHours: number;
  /** upvotes per hour — the anti-survivorship signal: old giants stop looking viral */
  velocity: number;
  /** comments ÷ upvotes — debate density; high means people argue in the replies */
  commentRatio: number;
  /** 0..1 — how directly the text can be lifted as a caption/hook */
  reusability: number;
  /** 0..100 composite */
  viralScore: number;
}

export interface ViralItem {
  id: string;
  kind: ItemKind;
  /** adapter name: 'reddit' today */
  source: string;
  /** community/channel the item came from (subreddit, page, account) */
  community: string;
  author: string;
  /** post title; empty for comments */
  title: string;
  /** selftext for posts, body for comments */
  text: string;
  /** absolute permalink — always keep it: it is the attribution */
  url: string;
  /** direct media link when the item is an image/gif meme */
  mediaUrl?: string;
  isImage: boolean;
  /** unix seconds */
  createdUtc: number;
  score: number;
  comments: number;
  upvoteRatio?: number;
  over18: boolean;
  /** comments only: the post they hang under */
  parentId?: string;
  parentTitle?: string;
  parentUrl?: string;
  depth?: number;
  metrics?: ViralMetrics;
}

export interface SourceResult {
  items: ViralItem[];
  /** per-community failures, surfaced instead of silently dropped */
  errors: { community: string; reason: string }[];
}

export interface RunMeta {
  command: string;
  query?: string;
  pack?: string;
  communities: string[];
  window: string;
  createdAt: string;
  count: number;
}

export interface SavedRun {
  meta: RunMeta;
  items: ViralItem[];
}
