// What the climber can wear, and what unlocks it. Pure data and rules, so the game, its tests and the
// leaderboard Worker all share them.

export type Slot = 'beanie' | 'shirt' | 'bag';
export const SLOTS: Slot[] = ['beanie', 'shirt', 'bag'];
export const SLOT_NAMES: Record<Slot, string> = { beanie: 'Beanie', shirt: 'Shirt', bag: 'Chalk bag' };

/** What a player has done so far. All of it comes from the save, so nothing new has to be tracked. */
export interface Progress {
  gradesSent: number; // how many V grades have been sent
  topGrade: number; // highest V grade sent, -1 if none
  dailiesSent: number;
  survivalSeconds: number; // longest Survival run
  bestScore: number; // best score in any single round
}

export const NO_PROGRESS: Progress = { gradesSent: 0, topGrade: -1, dailiesSent: 0, survivalSeconds: 0, bestScore: 0 };

type Unlock =
  | { kind: 'free' }
  | { kind: 'grades'; n: number }
  | { kind: 'grade'; g: number }
  | { kind: 'dailies'; n: number }
  | { kind: 'survival'; seconds: number }
  | { kind: 'score'; n: number };

export interface Swatch {
  name: string;
  colour: number;
  unlock: Unlock;
}

const m = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

/** How to earn something, for the locked-swatch hint. */
export function unlockHint(u: Unlock): string {
  switch (u.kind) {
    case 'free':
      return 'Yours from the start';
    case 'grades':
      return `Send ${u.n} grade${u.n > 1 ? 's' : ''}`;
    case 'grade':
      return `Send V${u.g}`;
    case 'dailies':
      return `Send ${u.n} Daily Boulder${u.n > 1 ? 's' : ''}`;
    case 'survival':
      return `Survive ${m(u.seconds)} in Survival`;
    case 'score':
      return `Score ${u.n.toLocaleString('en-GB')} in one round`;
  }
}

export function isUnlocked(u: Unlock, p: Progress): boolean {
  switch (u.kind) {
    case 'free':
      return true;
    case 'grades':
      return p.gradesSent >= u.n;
    case 'grade':
      return p.topGrade >= u.g;
    case 'dailies':
      return p.dailiesSent >= u.n;
    case 'survival':
      return p.survivalSeconds >= u.seconds;
    case 'score':
      return p.bestScore >= u.n;
  }
}

export const SWATCHES: Record<Slot, Swatch[]> = {
  beanie: [
    { name: 'Blue', colour: 0x2f6fdd, unlock: { kind: 'free' } },
    { name: 'Red', colour: 0xe5484d, unlock: { kind: 'grades', n: 3 } },
    { name: 'Green', colour: 0x30c46b, unlock: { kind: 'grades', n: 6 } },
    { name: 'Purple', colour: 0xa05cf0, unlock: { kind: 'grades', n: 10 } },
    { name: 'Orange', colour: 0xd9622b, unlock: { kind: 'dailies', n: 3 } },
    { name: 'Pink', colour: 0xf06aa8, unlock: { kind: 'dailies', n: 7 } },
    { name: 'Black', colour: 0x2b2f3a, unlock: { kind: 'survival', seconds: 180 } },
    { name: 'Gold', colour: 0xf5c518, unlock: { kind: 'survival', seconds: 300 } },
  ],
  shirt: [
    { name: 'Red', colour: 0xe5484d, unlock: { kind: 'free' } },
    { name: 'Blue', colour: 0x3e8ef7, unlock: { kind: 'grades', n: 1 } },
    { name: 'Green', colour: 0x30c46b, unlock: { kind: 'grades', n: 4 } },
    { name: 'Yellow', colour: 0xf5c518, unlock: { kind: 'grades', n: 8 } },
    { name: 'Purple', colour: 0xa05cf0, unlock: { kind: 'grade', g: 5 } },
    { name: 'Teal', colour: 0x1fa3a3, unlock: { kind: 'survival', seconds: 120 } },
    { name: 'Orange', colour: 0xd9622b, unlock: { kind: 'dailies', n: 5 } },
    { name: 'White', colour: 0xeef0f7, unlock: { kind: 'score', n: 5000 } },
  ],
  bag: [
    { name: 'Orange', colour: 0xd9622b, unlock: { kind: 'free' } },
    { name: 'Blue', colour: 0x2f6fdd, unlock: { kind: 'grades', n: 2 } },
    { name: 'Green', colour: 0x30c46b, unlock: { kind: 'grades', n: 5 } },
    { name: 'Purple', colour: 0xa05cf0, unlock: { kind: 'grades', n: 9 } },
    { name: 'Red', colour: 0xe5484d, unlock: { kind: 'dailies', n: 2 } },
    { name: 'Yellow', colour: 0xf5c518, unlock: { kind: 'grade', g: 8 } },
    { name: 'Teal', colour: 0x1fa3a3, unlock: { kind: 'survival', seconds: 90 } },
    { name: 'Black', colour: 0x2b2f3a, unlock: { kind: 'score', n: 10000 } },
  ],
};

/** The chosen swatch for each slot, as indexes. */
export type Look = Record<Slot, number>;
export const DEFAULT_LOOK: Look = { beanie: 0, shirt: 0, bag: 0 };

/** A look as a short code ("203": beanie 2, shirt 0, bag 3) for saving and for the leaderboard. */
export const encodeLook = (l: Look): string => SLOTS.map((s) => l[s]).join('');

/** Read a look code. Null if it isn't one (wrong length, or an index past the palette). */
export function decodeLook(code: unknown): Look | null {
  if (typeof code !== 'string' || !/^\d{3}$/.test(code)) return null;
  const look = {} as Look;
  for (const [i, slot] of SLOTS.entries()) {
    const n = Number(code[i]);
    if (n >= SWATCHES[slot].length) return null;
    look[slot] = n;
  }
  return look;
}

export const lookOrDefault = (code: unknown): Look => decodeLook(code) ?? DEFAULT_LOOK;

export const colourOf = (slot: Slot, look: Look): number => SWATCHES[slot][look[slot]].colour;

/** Every swatch, with whether it is unlocked. */
export function unlockedCount(p: Progress): { have: number; total: number } {
  let have = 0;
  let total = 0;
  for (const slot of SLOTS)
    for (const s of SWATCHES[slot]) {
      total++;
      if (isUnlocked(s.unlock, p)) have++;
    }
  return { have, total };
}

/** Mix a colour towards white, for the cuff and highlights. */
export function lighten(colour: number, amount = 0.3): number {
  const mix = (c: number) => Math.round(c + (255 - c) * amount);
  return (mix((colour >> 16) & 255) << 16) | (mix((colour >> 8) & 255) << 8) | mix(colour & 255);
}
