// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BoardData, climberIcon, loadBoard, mount, mountFromScript, Options, parseOptions, renderBoard } from '../src/embed/embed';
import { DEFAULT_API_URL } from '../src/apiUrl';

const OUTFIT = { beanie: '#2f6fdd', shirt: '#e5484d', bag: '#d9622b' };
const board = (over: Partial<BoardData> = {}): BoardData => ({
  board: 'v3',
  title: 'V3',
  kind: 'grade',
  scores: [
    { rank: 1, name: 'Ann', score: 9100, seconds: 0, outfit: OUTFIT },
    { rank: 2, name: 'Bob', score: 7400, seconds: 0, outfit: { beanie: '#f5c518', shirt: '#a05cf0', bag: '#2f6fdd' } },
    { rank: 3, name: 'Cat', score: 100, seconds: 0, outfit: OUTFIT },
  ],
  ...over,
});
const opts = (over: Partial<Options> = {}): Options => ({ ...parseOptions({}, 'https://site.example/Beta-Blast/embed.js'), ...over });
const flush = () => new Promise((r) => setTimeout(r, 0));
const okFetch = (data: unknown) => vi.fn(async () => Response.json(data)) as unknown as typeof fetch;

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe('options', () => {
  it('has sensible defaults', () => {
    expect(parseOptions({}, 'https://site.example/Beta-Blast/embed.js')).toEqual({
      board: 'daily',
      limit: 10,
      title: '',
      theme: 'dark',
      api: DEFAULT_API_URL,
      game: 'https://site.example/Beta-Blast/',
      refresh: 0,
    });
  });

  it('reads the data attributes', () => {
    const o = parseOptions({ board: ' survival ', limit: '5', title: 'Top climbers', theme: 'light', api: 'https://api.example/', game: 'https://play.example/', refresh: '60' }, 'https://x/embed.js');
    expect(o).toEqual({ board: 'survival', limit: 5, title: 'Top climbers', theme: 'light', api: 'https://api.example', game: 'https://play.example/', refresh: 60 });
    expect(parseOptions({ theme: 'auto' }).theme).toBe('auto');
  });

  it('keeps numbers and themes within bounds', () => {
    expect(parseOptions({ limit: '0' }).limit).toBe(1);
    expect(parseOptions({ limit: '99' }).limit).toBe(10);
    expect(parseOptions({ limit: '3.9' }).limit).toBe(3);
    expect(parseOptions({ limit: 'many' }).limit).toBe(10);
    expect(parseOptions({ limit: '' }).limit).toBe(10);
    expect(parseOptions({ refresh: '3' }).refresh).toBe(15); // never faster than every 15 seconds
    expect(parseOptions({ refresh: '-5' }).refresh).toBe(0);
    expect(parseOptions({ theme: 'neon' }).theme).toBe('dark');
    expect(parseOptions({ board: '   ' }).board).toBe('daily');
  });

  it('can hide the play link, or have none when it cannot tell where the game is', () => {
    expect(parseOptions({ link: 'false' }, 'https://x/embed.js').game).toBe('');
    expect(parseOptions({}, '').game).toBe('');
    expect(parseOptions({}, 'not a url').game).toBe('');
  });
});

describe('drawing a board', () => {
  it('lists each score with its rank, climber and name', () => {
    const box = renderBoard(document, board(), opts());
    expect(box.querySelector('h2')?.textContent).toBe('V3 leaderboard');
    const rows = [...box.querySelectorAll('li')].map((li) => [li.querySelector('.rank')?.textContent, li.querySelector('.name')?.textContent, li.querySelector('.score')?.textContent]);
    expect(rows).toEqual([['1', 'Ann', '9,100'], ['2', 'Bob', '7,400'], ['3', 'Cat', '100']]);
    expect(box.querySelectorAll('li svg')).toHaveLength(3);
    expect(box.getAttribute('aria-label')).toBe('Beta Blast V3 leaderboard');
  });

  it('puts a tick after the name of a signed-in player, and only theirs', () => {
    const data = board({ scores: [{ rank: 1, name: 'Ann', score: 5, seconds: 0, outfit: OUTFIT, verified: true }, { rank: 2, name: 'Bob', score: 4, seconds: 0, outfit: OUTFIT, verified: false }, { rank: 3, name: 'Cat', score: 3, seconds: 0, outfit: OUTFIT }] });
    const ticks = [...renderBoard(document, data, opts()).querySelectorAll('li')].map((li) => li.querySelector('.tick')?.textContent ?? null);
    expect(ticks).toEqual(['✓', null, null]);
  });

  it('uses the title it was given', () => {
    expect(renderBoard(document, board(), opts({ title: 'Our climbers' })).querySelector('h2')?.textContent).toBe('Our climbers');
  });

  it('shows only as many rows as asked for', () => {
    expect(renderBoard(document, board(), opts({ limit: 2 })).querySelectorAll('li')).toHaveLength(2);
  });

  it('shows how long a Survival run lasted', () => {
    const data = board({ kind: 'survival', title: 'Survival', scores: [{ rank: 1, name: 'Ann', score: 5210, seconds: 273, outfit: OUTFIT }] });
    expect(renderBoard(document, data, opts()).querySelector('.time')?.textContent).toBe('4:33');
    expect(renderBoard(document, board(), opts()).querySelector('.time')).toBeNull();
  });

  it('says so when nobody has scored yet', () => {
    const box = renderBoard(document, board({ scores: [] }), opts());
    expect(box.querySelector('.msg')?.textContent).toBe('No scores yet. Be the first!');
    expect(box.querySelector('ol')).toBeNull();
  });

  it('never lets a player\'s name become markup', () => {
    const evil = '<img src=x onerror=alert(1)>';
    const box = renderBoard(document, board({ scores: [{ rank: 1, name: evil, score: 1, seconds: 0, outfit: OUTFIT }] }), opts({ title: '<b>hi</b>' }));
    expect(box.querySelector('.name')?.textContent).toBe(evil);
    expect(box.querySelector('img')).toBeNull();
    expect(box.querySelector('b')).toBeNull();
    expect(box.querySelector('h2')?.textContent).toBe('<b>hi</b>');
  });

  it('links to the game safely, or not at all', () => {
    const link = renderBoard(document, board(), opts({ game: 'https://play.example/' })).querySelector('a')!;
    expect(link.getAttribute('href')).toBe('https://play.example/');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(renderBoard(document, board(), opts({ game: '' })).querySelector('a')).toBeNull();
  });

  it('takes its theme from the options', () => {
    expect(renderBoard(document, board(), opts({ theme: 'light' })).className).toBe('bb light');
  });

  it('draws the climber in the outfit colours, and copes with a bad colour', () => {
    const icon = climberIcon(document, OUTFIT);
    const fills = [...icon.querySelectorAll('[fill]')].map((n) => n.getAttribute('fill'));
    expect(fills).toContain('#2f6fdd');
    expect(fills).toContain('#e5484d');
    expect(icon.getAttribute('aria-hidden')).toBe('true');
    expect(() => climberIcon(document, { beanie: 'red', shirt: '#fff', bag: '' })).not.toThrow();
  });
});

describe('loading', () => {
  it('asks the API for the board and limit', async () => {
    const f = okFetch(board());
    await loadBoard(opts({ api: 'https://api.example', board: 'daily-2026-10-12', limit: 4 }), f);
    expect((f as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe('https://api.example/v1/boards/daily-2026-10-12?limit=4');
  });

  it('rejects when the API fails or answers with something else', async () => {
    await expect(loadBoard(opts(), vi.fn(async () => new Response('no', { status: 500 })) as unknown as typeof fetch)).rejects.toThrow();
    await expect(loadBoard(opts(), okFetch({ hello: 1 }))).rejects.toThrow();
    await expect(loadBoard(opts(), okFetch(null))).rejects.toThrow();
    await expect(loadBoard(opts(), vi.fn(async () => Promise.reject(new Error('offline'))) as unknown as typeof fetch)).rejects.toThrow();
  });
});

describe('mounting', () => {
  let host: HTMLElement;
  beforeEach(() => {
    host = document.createElement('div');
    document.body.append(host);
  });

  it('shows loading, then the scores, inside a shadow root', async () => {
    let finish: (r: Response) => void = () => {};
    const f = vi.fn(() => new Promise<Response>((r) => (finish = r))) as unknown as typeof fetch;
    mount(host, opts(), f);
    expect(host.shadowRoot?.textContent).toContain('Loading…');
    finish(Response.json(board()));
    await flush();
    expect(host.shadowRoot?.querySelectorAll('li')).toHaveLength(3);
    expect(host.shadowRoot?.querySelector('style')).not.toBeNull();
    expect(host.querySelector('li')).toBeNull(); // not in the page's own tree
  });

  it('says so if the leaderboard cannot be reached', async () => {
    mount(host, opts(), vi.fn(async () => Promise.reject(new Error('offline'))) as unknown as typeof fetch);
    await flush();
    expect(host.shadowRoot?.textContent).toContain("Couldn't load the leaderboard.");
  });

  it('refreshes on a timer, keeps the last list if an update fails, and stops when told', async () => {
    vi.useFakeTimers();
    const f = vi.fn().mockResolvedValueOnce(Response.json(board())).mockRejectedValueOnce(new Error('offline')).mockImplementation(async () => Response.json(board({ scores: [] })));
    const stop = mount(host, opts({ refresh: 20 }), f as unknown as typeof fetch);
    await vi.advanceTimersByTimeAsync(0);
    expect(host.shadowRoot?.querySelectorAll('li')).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(20_000); // the update fails: the old list stays
    expect(host.shadowRoot?.querySelectorAll('li')).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(20_000); // the next works: it is now empty
    expect(host.shadowRoot?.textContent).toContain('No scores yet');
    stop();
    const calls = f.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(f.mock.calls.length).toBe(calls);
  });

  it('does not refresh unless asked to', async () => {
    vi.useFakeTimers();
    const f = okFetch(board());
    mount(host, opts({ refresh: 0 }), f);
    await vi.advanceTimersByTimeAsync(120_000);
    expect((f as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
  });
});

describe('script tags', () => {
  const tag = (attrs: Record<string, string> = {}) => {
    const s = document.createElement('script');
    s.src = 'https://site.example/Beta-Blast/embed.js';
    for (const [k, v] of Object.entries(attrs)) s.setAttribute(`data-${k}`, v);
    document.body.append(s);
    return s;
  };
  beforeEach(() => {
    vi.stubGlobal('fetch', okFetch(board()));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('puts the board right after the script tag, once', async () => {
    const s = tag({ board: 'v3' });
    const where = mountFromScript(s)!;
    expect(s.nextElementSibling).toBe(where);
    await flush();
    expect(where.shadowRoot?.querySelectorAll('li')).toHaveLength(3);
    expect(mountFromScript(s)).toBeNull(); // running it twice doesn't add a second board
    expect(document.body.children).toHaveLength(2);
  });

  it('draws into the element named by data-target, if there is one', () => {
    const slot = document.createElement('div');
    slot.id = 'leaders';
    document.body.append(slot);
    const where = mountFromScript(tag({ target: '#leaders' }))!;
    expect(where).toBe(slot);
    expect(slot.shadowRoot).not.toBeNull();
  });

  it('falls back to the spot after the tag when the target is missing', () => {
    const s = tag({ target: '#nope' });
    expect(mountFromScript(s)).toBe(s.nextElementSibling);
  });

  it('exposes mount for pages that want to draw a board themselves', () => {
    expect(typeof window.BetaBlast?.mount).toBe('function');
  });
});
