// The keyword a host shares: two climbing words and two digits, like CHALK-DYNO-58.
// 20 x 20 x 90 combinations, picked with the browser's secure random numbers.

const WORDS = ['CHALK', 'CRIMP', 'DYNO', 'JUG', 'SLOPER', 'PINCH', 'POCKET', 'FLASH', 'SEND', 'BETA', 'ARETE', 'SLAB', 'ROOF', 'CRUX', 'TOPO', 'CAM', 'LEDGE', 'SMEAR', 'MANTEL', 'BOULDER'];
const FORMAT = /^([A-Z]+)-([A-Z]+)-(\d{2})$/;

export function newCode(): string {
  const r = crypto.getRandomValues(new Uint32Array(3));
  return `${WORDS[r[0] % WORDS.length]}-${WORDS[r[1] % WORDS.length]}-${10 + (r[2] % 90)}`;
}

/** Tidy up whatever a player typed or pasted, and say whether it is a real keyword. */
export function normaliseCode(input: string): string | null {
  const text = input.trim().toUpperCase().replace(/[\s_]+/g, '-');
  const m = FORMAT.exec(text);
  return m && WORDS.includes(m[1]) && WORDS.includes(m[2]) ? text : null;
}

/** Accepts a bare keyword or a link containing ?join=KEYWORD. */
export function codeFromInput(input: string): string | null {
  const m = /[?&]join=([^&#\s]+)/i.exec(input);
  return normaliseCode(decodeURIComponent(m ? m[1] : input));
}

/** The id the host registers with the matchmaking broker. Namespaced so it can't clash with other apps. */
export const peerIdFor = (code: string): string => `beta-blast-${code.toLowerCase()}`;

export function linkFor(code: string, base = `${window.location.origin}${window.location.pathname}`): string {
  return `${base}?join=${encodeURIComponent(code)}`;
}
