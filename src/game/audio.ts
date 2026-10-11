// Tiny synthesised sound effects, so the game needs no audio files.
import { isMuted, setMuted } from './storage';

let ctx: AudioContext | null = null;
let muted = isMuted();

const unlockHandlers: (() => void)[] = [];
const muteHandlers: (() => void)[] = [];

/** Run `cb` once the browser lets us make sound (after the first tap or key press), and on every later unlock call. */
export function onUnlock(cb: () => void): void {
  unlockHandlers.push(cb);
}
export function onMuteChange(cb: () => void): void {
  muteHandlers.push(cb);
}
export const getContext = (): AudioContext | null => ctx;

export function unlockAudio(): void {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
  } catch {
    /* audio unsupported */
  }
  unlockHandlers.forEach((cb) => cb());
}

export function toggleMute(): boolean {
  muted = !muted;
  setMuted(muted);
  muteHandlers.forEach((cb) => cb());
  return muted;
}
export const isMutedNow = (): boolean => muted;

function tone(freq: number, dur: number, type: OscillatorType = 'sine', vol = 0.12, slideTo?: number, delay = 0): void {
  if (!ctx || muted) return;
  const t0 = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
  gain.gain.setValueAtTime(vol, t0);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + dur);
}

function noise(dur: number, vol: number, cutoff: number): void {
  if (!ctx || muted) return;
  const len = Math.floor(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = cutoff;
  const gain = ctx.createGain();
  gain.gain.value = vol;
  src.connect(filter).connect(gain).connect(ctx.destination);
  src.start();
}

export const sfx = {
  shoot: () => {
    noise(0.22, 0.25, 1600); // the poof of chalk
    tone(170, 0.1, 'sine', 0.1, 90);
  },
  bounce: () => tone(500, 0.05, 'square', 0.04),
  land: () => {
    tone(160, 0.08, 'sine', 0.12, 100);
    noise(0.07, 0.08, 900);
  },
  pop: (n: number, combo = 1) => {
    const base = 420 * 2 ** (Math.min(combo - 1, 6) / 12);
    for (let i = 0; i < Math.min(n, 6); i++) tone(base + i * 90, 0.12, 'triangle', 0.1, undefined, i * 0.04);
  },
  wild: () => [660, 880, 1100, 1320].forEach((f, i) => tone(f, 0.12, 'sine', 0.07, undefined, i * 0.04)),
  stage: () => [392, 523, 659].forEach((f, i) => tone(f, 0.18, 'triangle', 0.1, undefined, i * 0.09)),
  tick: () => tone(1200, 0.04, 'square', 0.04),
  crack: () => tone(220, 0.1, 'square', 0.08, 120),
  slide: () => tone(700, 0.25, 'sine', 0.06, 200),
  fall: () => tone(500, 0.4, 'sawtooth', 0.05, 90),
  drop: () => tone(110, 0.3, 'square', 0.1, 60),
  win: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.25, 'triangle', 0.12, undefined, i * 0.12)),
  lose: () => tone(400, 0.8, 'sawtooth', 0.1, 60),
};
