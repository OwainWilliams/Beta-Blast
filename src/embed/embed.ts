// The Beta Blast leaderboard as a widget for any website:
//
//   <script src="https://thesecretstage.vip/Beta-Blast/embed.js" data-board="daily" async></script>
//
// It draws the top scores for a board where the tag is, inside a shadow root so the page's styles can't break it.
// Options go on the script tag as data attributes (see parseOptions). It is built on its own into dist/embed.js.
import { DEFAULT_API_URL } from '../apiUrl';
import { formatTime } from '../game/format';
import { lighten } from '../game/looks';

export interface Options {
  board: string; // "daily", "survival", "v3", or "daily-2026-10-12"
  limit: number; // how many rows, 1 to 10
  title: string; // heading; empty uses the board's own name
  theme: 'dark' | 'light' | 'auto';
  api: string; // the API's address
  game: string; // where "Play Beta Blast" goes; empty hides the link
  refresh: number; // seconds between updates; 0 for never
}

export interface Outfit {
  beanie: string;
  shirt: string;
  bag: string;
}
export interface Row {
  rank: number;
  name: string;
  score: number;
  seconds: number;
  outfit: Outfit;
}
export interface BoardData {
  board: string;
  title: string;
  kind: string;
  scores: Row[];
}

const SVG = 'http://www.w3.org/2000/svg';
const INK = '#1d2233';
const SKIN = '#f2c9a0';
const MIN_REFRESH = 15;

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));
const num = (v: string | undefined, fallback: number): number => (v !== undefined && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : fallback);

/** Read the options from a script tag's data attributes. `src` is the script's own address, which tells us where the game is. */
export function parseOptions(data: DOMStringMap, src = ''): Options {
  const theme = data.theme === 'light' || data.theme === 'auto' ? data.theme : 'dark';
  const refresh = num(data.refresh, 0);
  let game = '';
  try {
    game = data.link === 'false' ? '' : (data.game ?? new URL('./', src).href);
  } catch {
    /* no usable address: no link */
  }
  return {
    board: (data.board ?? 'daily').trim() || 'daily',
    limit: Math.floor(clamp(num(data.limit, 10), 1, 10)),
    title: data.title ?? '',
    theme,
    api: (data.api ?? DEFAULT_API_URL).replace(/\/+$/, ''),
    game,
    refresh: refresh > 0 ? Math.max(MIN_REFRESH, refresh) : 0,
  };
}

const CSS = `
:host { display: block; max-width: 420px; }
.bb { --bg: var(--bb-bg, #1f2433); --fg: var(--bb-fg, #e8ecf8); --muted: var(--bb-muted, #9aa6cf); --line: var(--bb-line, #34405f); --accent: var(--bb-accent, #ffd166); --me: var(--bb-highlight, rgba(255, 209, 102, 0.12));
  font: 15px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif; color: var(--fg); background: var(--bg); border: 1px solid var(--line); border-radius: 12px; padding: 14px 16px; box-sizing: border-box; }
.bb.light { --bg: var(--bb-bg, #ffffff); --fg: var(--bb-fg, #1d2233); --muted: var(--bb-muted, #5b6482); --line: var(--bb-line, #d9deee); --accent: var(--bb-accent, #b4690e); }
@media (prefers-color-scheme: light) { .bb.auto { --bg: var(--bb-bg, #ffffff); --fg: var(--bb-fg, #1d2233); --muted: var(--bb-muted, #5b6482); --line: var(--bb-line, #d9deee); --accent: var(--bb-accent, #b4690e); } }
h2 { margin: 0 0 8px; font-size: 17px; color: var(--accent); letter-spacing: 0.02em; }
ol { list-style: none; margin: 0; padding: 0; }
li { display: flex; align-items: center; gap: 10px; padding: 5px 4px; border-top: 1px solid var(--line); }
li:first-child { border-top: 0; }
.rank { width: 1.6em; text-align: right; color: var(--muted); font-variant-numeric: tabular-nums; }
li:nth-child(-n+3) .rank, li:nth-child(-n+3) .name { color: var(--fg); font-weight: 700; }
.icon { flex: none; }
.name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.score { font-variant-numeric: tabular-nums; font-weight: 700; }
.time { color: var(--muted); font-weight: 400; font-size: 13px; margin-left: 6px; }
.msg { margin: 8px 0; color: var(--muted); }
a { display: inline-block; margin-top: 10px; color: var(--accent); font-weight: 700; text-decoration: none; }
a:hover, a:focus-visible { text-decoration: underline; }
`;

const el = <K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] => {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

const svg = (doc: Document, tag: string, attrs: Record<string, string | number>): SVGElement => {
  const node = doc.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
};

const toNumber = (hex: string): number => (/^#[0-9a-f]{6}$/i.test(hex) ? parseInt(hex.slice(1), 16) : 0x888888);
const toHex = (n: number): string => `#${n.toString(16).padStart(6, '0')}`;

/** A small head-and-shoulders picture of a climber in this outfit. */
export function climberIcon(doc: Document, outfit: Outfit): SVGElement {
  const wool = outfit.beanie;
  const root = svg(doc, 'svg', { viewBox: '0 0 40 44', width: 28, height: 31, class: 'icon', 'aria-hidden': 'true', focusable: 'false' });
  const stroke = { stroke: INK, 'stroke-width': 1.6 };
  root.append(
    svg(doc, 'rect', { x: 9, y: 29, width: 22, height: 14, rx: 6, fill: outfit.shirt, ...stroke }),
    svg(doc, 'circle', { cx: 20, cy: 23, r: 9.5, fill: SKIN, ...stroke }),
    svg(doc, 'circle', { cx: 16.4, cy: 24.6, r: 1.4, fill: INK }),
    svg(doc, 'circle', { cx: 23.6, cy: 24.6, r: 1.4, fill: INK }),
    svg(doc, 'path', { d: 'M9.5 20 a10.5 10.5 0 0 1 21 0 Z', fill: wool, ...stroke }),
    svg(doc, 'rect', { x: 8.2, y: 17.6, width: 23.6, height: 5, rx: 2.4, fill: toHex(lighten(toNumber(wool), 0.28)), ...stroke }),
    svg(doc, 'circle', { cx: 20, cy: 6.4, r: 3.4, fill: '#ffffff', ...stroke }),
  );
  return root;
}

/** The rows of a board, as a ready-to-insert element. Text only ever goes in as text. */
export function renderBoard(doc: Document, data: BoardData, opts: Options): HTMLElement {
  const box = el(doc, 'div', `bb ${opts.theme}`);
  const heading = opts.title || `${data.title} leaderboard`;
  box.setAttribute('role', 'region');
  box.setAttribute('aria-label', `Beta Blast ${heading}`);
  box.append(el(doc, 'h2', undefined, heading));
  if (!data.scores.length) box.append(el(doc, 'p', 'msg', 'No scores yet. Be the first!'));
  else {
    const list = el(doc, 'ol');
    for (const row of data.scores.slice(0, opts.limit)) {
      const item = el(doc, 'li');
      const score = el(doc, 'span', 'score', row.score.toLocaleString('en-GB'));
      if (data.kind === 'survival' && row.seconds > 0) score.append(el(doc, 'span', 'time', formatTime(row.seconds)));
      item.append(el(doc, 'span', 'rank', String(row.rank)), climberIcon(doc, row.outfit), el(doc, 'span', 'name', row.name), score);
      list.append(item);
    }
    box.append(list);
  }
  if (opts.game) {
    const link = el(doc, 'a', undefined, 'Play Beta Blast');
    link.setAttribute('href', opts.game);
    link.setAttribute('target', '_blank');
    link.setAttribute('rel', 'noopener noreferrer');
    box.append(link);
  }
  return box;
}

const message = (doc: Document, text: string, opts: Options): HTMLElement => {
  const box = el(doc, 'div', `bb ${opts.theme}`);
  box.append(el(doc, 'p', 'msg', text));
  return box;
};

/** Fetch a board. Rejects if the API can't be reached or doesn't answer properly. */
export async function loadBoard(opts: Options, fetcher: typeof fetch = fetch): Promise<BoardData> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 8000);
  try {
    const res = await fetcher(`${opts.api}/v1/boards/${encodeURIComponent(opts.board)}?limit=${opts.limit}`, { signal: ctl.signal, headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as BoardData;
    if (!data || !Array.isArray(data.scores)) throw new Error('Unexpected answer');
    return data;
  } finally {
    clearTimeout(timer);
  }
}

/** Draw a board into `target`, and keep it up to date if a refresh time was asked for. Returns a function that stops the updates. */
export function mount(target: HTMLElement, options: Partial<Options> = {}, fetcher: typeof fetch = fetch): () => void {
  const opts: Options = { ...parseOptions({}), ...options };
  const doc = target.ownerDocument;
  const root = target.shadowRoot ?? target.attachShadow({ mode: 'open' });
  const style = el(doc, 'style');
  style.textContent = CSS;
  let timer: ReturnType<typeof setInterval> | undefined;
  let stopped = false;

  const show = (node: HTMLElement) => root.replaceChildren(style.cloneNode(true), node);
  const update = async () => {
    try {
      const data = await loadBoard(opts, fetcher);
      if (!stopped) show(renderBoard(doc, data, opts));
    } catch {
      if (!stopped && !root.querySelector('ol')) show(message(doc, "Couldn't load the leaderboard.", opts)); // keep the last good list if an update fails
    }
  };
  show(message(doc, 'Loading…', opts));
  void update();
  if (opts.refresh > 0) timer = setInterval(() => void update(), opts.refresh * 1000);
  return () => {
    stopped = true;
    if (timer) clearInterval(timer);
  };
}

/** Put a board where a script tag is (or where its data-target says), once per tag. */
export function mountFromScript(script: HTMLScriptElement): HTMLElement | null {
  if (script.dataset.mounted) return null;
  script.dataset.mounted = '1';
  const doc = script.ownerDocument;
  const wanted = script.dataset.target;
  const target = (wanted && doc.querySelector<HTMLElement>(wanted)) || el(doc, 'div');
  if (!target.isConnected) script.insertAdjacentElement('afterend', target);
  mount(target, parseOptions(script.dataset, script.src));
  return target;
}

declare global {
  interface Window {
    BetaBlast?: { mount: typeof mount };
  }
}

if (typeof document !== 'undefined') {
  window.BetaBlast = { mount };
  const current = document.currentScript;
  if (current instanceof HTMLScriptElement) mountFromScript(current);
  else document.querySelectorAll<HTMLScriptElement>('script[src$="embed.js"][data-board]').forEach((s) => mountFromScript(s));
}
