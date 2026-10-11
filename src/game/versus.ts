// The rules of a two-player match. Kept apart so they are easy to see and to change.

export const VERSUS_RULES = {
  /** Popping first cancels rows queued against you, and only the surplus is sent on. */
  cancelWithPops: true,
  /** Rows sent to you wait until you miss a shot. If false they land after every shot. */
  deferUntilMiss: true,
  /** Cutting off this many holds in one shot earns a second row. */
  bigDrop: 4,
  /** Clearing every colour sends this many rows. */
  sweepRows: 3,
};

/** Rows a shot sends to the opponent: one for every "connection" (a pop), plus bonuses for big plays. */
export function attackFor(popped: number, fallen: number, sweep: boolean): number {
  if (popped === 0) return 0;
  return 1 + (fallen >= VERSUS_RULES.bigDrop ? 1 : 0) + (sweep ? VERSUS_RULES.sweepRows : 0);
}
