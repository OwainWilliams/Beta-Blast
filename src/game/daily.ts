// The Daily Boulder: one attempt a day, and the clock until the next one. Pure, so it is easy to test.

/** Milliseconds until the player's next local midnight, when a new Daily Boulder appears. */
export function msUntilNextDay(now = new Date()): number {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime() - now.getTime();
}

/** "5:07:09", counting down. Rounds up, so the last second reads 0:00:01 and never 0:00:00 before the new day. */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const p = (n: number) => String(n).padStart(2, '0');
  return `${Math.floor(total / 3600)}:${p(Math.floor((total % 3600) / 60))}:${p(total % 60)}`;
}
