const KEY = 'crimp-and-pop.v1';

interface Save {
  best: Record<string, number>;
  sent: Record<string, boolean>;
  muted: boolean;
}

function load(): Save {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { best: {}, sent: {}, muted: false, ...JSON.parse(raw) };
  } catch {
    /* storage unavailable */
  }
  return { best: {}, sent: {}, muted: false };
}

function save(s: Save): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable */
  }
}

export const getBest = (id: string): number => load().best[id] ?? 0;
export const isSent = (id: string): boolean => !!load().sent[id];
export const isMuted = (): boolean => load().muted;

export function setMuted(muted: boolean): void {
  save({ ...load(), muted });
}

export function recordResult(id: string, score: number, sent: boolean): void {
  const s = load();
  s.best[id] = Math.max(s.best[id] ?? 0, score);
  if (sent) s.sent[id] = true;
  save(s);
}
