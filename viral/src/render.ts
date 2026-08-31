/**
 * render — the four ways a run comes back out: terminal, JSON, Markdown, HTML.
 *
 * The HTML board matters more than it sounds. Memes are images; a list of
 * titles in a terminal tells you nothing about whether the joke lands. The
 * board shows the actual image next to the score so you can judge in one pass.
 */

import type { RunDiff, Trend } from './diff';
import type { RunMeta, ViralItem } from './types';

const BAR_WIDTH = 10;

export function scoreBar(score: number): string {
  const filled = Math.round((Math.max(0, Math.min(100, score)) / 100) * BAR_WIDTH);
  return '█'.repeat(filled) + '░'.repeat(BAR_WIDTH - filled);
}

export function humanAge(hours: number): string {
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  if (hours < 48) return `${Math.round(hours)}h`;
  return `${Math.round(hours / 24)}d`;
}

export function snippet(item: ViralItem, max = 88): string {
  const raw = (item.kind === 'comment' ? item.text : item.title || item.text).replace(/\s+/g, ' ').trim();
  return raw.length > max ? `${raw.slice(0, max - 1)}…` : raw;
}

export function renderTable(items: ViralItem[]): string {
  if (items.length === 0) return 'Sin resultados. Prueba otra ventana (--window week) o menos filtros.';
  const lines: string[] = [];
  items.forEach((item, i) => {
    const m = item.metrics;
    const score = m?.viralScore ?? 0;
    const idx = String(i + 1).padStart(2, ' ');
    lines.push(
      `${idx}. ${scoreBar(score)} ${String(score).padStart(3, ' ')}  ` +
        `${fmtCount(item.score).padStart(6)} pts  ${fmtCount(Math.round(m?.velocity ?? 0)).padStart(6)}/h  ` +
        `${fmtCount(item.comments).padStart(5)} com  ${humanAge(m?.ageHours ?? 0).padStart(4)}  ` +
        `r/${item.community}${item.isImage ? '  [img]' : ''}${item.over18 ? '  [+18]' : ''}` +
          (item.duplicates ? `  ×${item.duplicates + 1}` : ''),
    );
    lines.push(`    ${snippet(item)}`);
    lines.push(`    ${item.url}`);
    lines.push('');
  });
  return lines.join('\n');
}

export function renderMarkdown(items: ViralItem[], meta: RunMeta): string {
  const out: string[] = [
    `# Virales — ${meta.command}${meta.query ? `: "${meta.query}"` : ''}`,
    '',
    `Ventana: \`${meta.window}\` · Comunidades: ${meta.communities.map((c) => `r/${c}`).join(', ') || '—'} · ${meta.createdAt}`,
    '',
    '| # | Score | Pts | Pts/h | Com | Edad | Comunidad | Contenido |',
    '|---|-------|-----|-------|-----|------|-----------|-----------|',
  ];
  items.forEach((item, i) => {
    const m = item.metrics;
    out.push(
      `| ${i + 1} | ${m?.viralScore ?? 0} | ${fmtCount(item.score)} | ${fmtCount(Math.round(m?.velocity ?? 0))} | ` +
        `${fmtCount(item.comments)} | ${humanAge(m?.ageHours ?? 0)} | r/${item.community} | ` +
        `[${escapePipes(snippet(item, 70))}](${item.url}) |`,
    );
  });
  return `${out.join('\n')}\n`;
}

export function renderHtml(items: ViralItem[], meta: RunMeta): string {
  const cards = items
    .map((item, i) => {
      const m = item.metrics;
      const score = m?.viralScore ?? 0;
      const img = item.mediaUrl
        ? `<img loading="lazy" src="${attr(item.mediaUrl)}" alt="">`
        : `<div class="noimg">${esc(item.kind === 'comment' ? '💬' : '📝')}</div>`;
      const body = esc(item.kind === 'comment' ? item.text : item.title || item.text).slice(0, 600);
      const parent = item.parentTitle
        ? `<div class="parent">en: ${esc(item.parentTitle.slice(0, 100))}</div>`
        : '';
      return `<article class="card${item.over18 ? ' nsfw' : ''}">
  <div class="rank">#${i + 1}</div>
  <div class="thumb">${img}</div>
  <div class="meta">
    <span class="badge s${bucket(score)}">${score}</span>
    <span>${fmtCount(item.score)} pts</span>
    <span>${fmtCount(Math.round(m?.velocity ?? 0))}/h</span>
    <span>${fmtCount(item.comments)} com</span>
    <span>${humanAge(m?.ageHours ?? 0)}</span>
    ${item.duplicates ? `<span title="copias en otras comunidades">×${item.duplicates + 1}</span>` : ''}
    <span class="sub">r/${esc(item.community)}</span>
  </div>
  ${parent}
  <p class="text">${body}</p>
  <div class="actions">
    <a href="${attr(item.url)}" target="_blank" rel="noopener noreferrer">ver original</a>
    <button type="button" data-copy="${attr(item.kind === 'comment' ? item.text : item.title)}">copiar texto</button>
  </div>
</article>`;
    })
    .join('\n');

  return `<!doctype html>
<html lang="es">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Virales · ${esc(meta.command)}</title>
<style>
  :root { color-scheme: light dark; --bg:#fbfaf8; --fg:#1a1a1a; --mut:#6b6b6b; --card:#fff; --line:#e6e3de; --accent:#c2410c; }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#141414; --fg:#ededed; --mut:#9a9a9a; --card:#1d1d1d; --line:#2e2e2e; --accent:#fb923c; }
  }
  * { box-sizing: border-box; }
  body { margin:0; padding:24px; background:var(--bg); color:var(--fg);
         font:15px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif; }
  header { max-width:1200px; margin:0 auto 20px; }
  h1 { font-size:22px; margin:0 0 6px; }
  .sub-head { color:var(--mut); font-size:13px; }
  .grid { max-width:1200px; margin:0 auto; display:grid; gap:16px;
          grid-template-columns:repeat(auto-fill,minmax(280px,1fr)); }
  .card { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:14px; position:relative; overflow:hidden; }
  .rank { position:absolute; top:10px; right:12px; color:var(--mut); font-size:12px; }
  .thumb img { width:100%; height:180px; object-fit:cover; border-radius:8px; background:var(--line); }
  .noimg { height:180px; display:grid; place-items:center; font-size:38px; background:var(--line); border-radius:8px; }
  .meta { display:flex; flex-wrap:wrap; gap:8px; align-items:center; font-size:12px; color:var(--mut); margin:10px 0 6px; }
  .badge { font-weight:700; color:#fff; border-radius:999px; padding:2px 9px; background:#9ca3af; }
  .badge.s3 { background:#dc2626; } .badge.s2 { background:#ea580c; } .badge.s1 { background:#65a30d; }
  .sub { margin-left:auto; }
  .parent { font-size:12px; color:var(--mut); margin-bottom:4px; }
  .text { margin:0 0 12px; white-space:pre-wrap; word-break:break-word; max-height:9em; overflow:hidden; }
  .actions { display:flex; gap:10px; align-items:center; font-size:13px; }
  a { color:var(--accent); }
  button { font:inherit; font-size:13px; cursor:pointer; background:none; border:1px solid var(--line);
           color:var(--fg); border-radius:6px; padding:3px 10px; }
  .nsfw .thumb img { filter:blur(14px); transition:filter .15s; }
  .nsfw:hover .thumb img { filter:none; }
</style>
<header>
  <h1>Virales · ${esc(meta.command)}${meta.query ? ` · "${esc(meta.query)}"` : ''}</h1>
  <div class="sub-head">${items.length} resultados · ventana <code>${esc(meta.window)}</code> ·
    ${esc(meta.communities.map((c) => `r/${c}`).join(', ') || '—')} · ${esc(meta.createdAt)}</div>
</header>
<main class="grid">
${cards}
</main>
<script>
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-copy]');
    if (!btn) return;
    navigator.clipboard.writeText(btn.dataset.copy || '').then(() => {
      const old = btn.textContent; btn.textContent = 'copiado'; setTimeout(() => { btn.textContent = old; }, 1200);
    }).catch(() => { btn.textContent = 'no se pudo copiar'; });
  });
</script>
</html>
`;
}

function bucket(score: number): 1 | 2 | 3 {
  if (score >= 70) return 3;
  if (score >= 45) return 2;
  return 1;
}

export function fmtCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function esc(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function attr(s: string): string {
  return esc(s).replace(/"/g, '&quot;');
}

function escapePipes(s: string): string {
  return s.replace(/\|/g, '\\|');
}

const TREND_LABEL: Record<Trend, string> = {
  acelera: 'SIGUE SUBIENDO',
  nuevo: 'NUEVO DESDE LA ÚLTIMA VEZ',
  enfria: 'YA SE ESTÁ ENFRIANDO',
};

/**
 * The diff view. Order is deliberate: what is still climbing first, because
 * that is the only group you can still act on.
 */
export function renderDiff(diff: RunDiff): string {
  const lines: string[] = [
    `Comparando dos búsquedas separadas por ${diff.hoursBetween}h.`,
  ];
  if (diff.mismatched) {
    lines.push('[aviso] las dos búsquedas no usaron el mismo comando/pack: la comparación es orientativa.');
  }
  lines.push('');

  for (const trend of ['acelera', 'nuevo', 'enfria'] as Trend[]) {
    const group = diff.entries.filter((e) => e.trend === trend);
    lines.push(`${TREND_LABEL[trend]} (${group.length})`);
    if (group.length === 0) lines.push('   —');
    group.slice(0, 10).forEach((entry) => {
      const delta = entry.deltaScore >= 0 ? `+${fmtCount(entry.deltaScore)}` : fmtCount(entry.deltaScore);
      const pace = `${fmtCount(Math.round(entry.recentPace))}/h`;
      const before = entry.trend === 'nuevo' ? '' : ` (antes ${fmtCount(Math.round(entry.previousPace))}/h)`;
      lines.push(`   ${delta.padStart(7)} votos · ${pace.padStart(8)}${before}  r/${entry.item.community}`);
      lines.push(`           ${snippet(entry.item, 76)}`);
      lines.push(`           ${entry.item.url}`);
    });
    lines.push('');
  }

  if (diff.dropped.length > 0) {
    lines.push(`Salieron del ranking: ${diff.dropped.length}`);
  }
  return lines.join('\n');
}
