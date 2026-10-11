// Procedural background music, so the game ships with no audio files.
//
// A four-bar loop (chords, bass, drums, arpeggio, lead) is generated from the grade: the grade picks
// the chord progression and seeds the melody, and sets the tempo, which climbs as grades get harder.
// Extra layers fade in as the wall gets low or the row timer runs down.
import { getContext, isMutedNow, onMuteChange, onUnlock } from './audio';
import { mulberry32 } from './levels';
import { getMusic, setMusic } from './storage';

export const STEPS = 64; // four bars of sixteenth notes
const MASTER = 0.5;

// Chord roots as pitch classes (0 = C). The first chord of each progression is the tonic (minor).
const PROGRESSIONS = [
  { pcs: [9, 5, 0, 7], minor: [true, false, false, false] }, // Am F C G
  { pcs: [2, 10, 5, 0], minor: [true, false, false, false] }, // Dm Bb F C
  { pcs: [4, 0, 7, 2], minor: [true, false, false, false] }, // Em C G D
  { pcs: [0, 8, 3, 10], minor: [true, false, false, false] }, // Cm Ab Eb Bb
];

export interface Pattern {
  bpm: number;
  pcs: number[]; // chord root pitch class per bar
  minor: boolean[]; // chord quality per bar
  bass: (number | null)[]; // MIDI note per step
  arp: (number | null)[];
  lead: (number | null)[];
  kick: boolean[];
  snare: boolean[];
  hat: number[]; // 1 = 8th-note hat, 2 = extra 16th hat (only at high intensity)
}

export const tempoFor = (grade: number): number => Math.min(150, 96 + 4 * grade);
const freq = (midi: number): number => 440 * 2 ** ((midi - 69) / 12);
const fold = (pc: number): number => (pc > 6 ? pc - 12 : pc); // keep high roots from flying off

export function buildPattern(grade: number): Pattern {
  const prog = PROGRESSIONS[grade % PROGRESSIONS.length];
  const rng = mulberry32(grade * 7919 + 13);
  const p: Pattern = {
    bpm: tempoFor(grade),
    pcs: prog.pcs,
    minor: prog.minor,
    bass: new Array(STEPS).fill(null),
    arp: new Array(STEPS).fill(null),
    lead: new Array(STEPS).fill(null),
    kick: new Array(STEPS).fill(false),
    snare: new Array(STEPS).fill(false),
    hat: new Array(STEPS).fill(1),
  };
  const leadSlots = [0, 3, 6, 8, 11, 14];
  for (let bar = 0; bar < 4; bar++) {
    const pc = prog.pcs[bar];
    const tones = [0, prog.minor[bar] ? 3 : 4, 7];
    const bassRoot = 36 + pc + (pc < 5 ? 12 : 0);
    for (let s = 0; s < 16; s++) {
      const i = bar * 16 + s;
      if (s === 0 || s === 6) p.bass[i] = bassRoot;
      else if (s === 8) p.bass[i] = bassRoot + 7;
      else if (s === 12) p.bass[i] = bassRoot + 12;
      if (s % 2 === 0) p.arp[i] = 60 + fold(pc) + tones[[0, 1, 2, 1][(s / 2) % 4]];
      p.kick[i] = s === 0 || s === 8 || (s === 10 && rng() < 0.4);
      p.snare[i] = s === 4 || s === 12;
      p.hat[i] = s % 2 === 0 ? 1 : 2;
      if (leadSlots.includes(s) && (s === 0 || rng() < 0.65)) p.lead[i] = 72 + fold(pc) + tones[Math.floor(rng() * 3)];
    }
  }
  return p;
}

// ---------- instruments ----------

const noiseBuffers = new WeakMap<BaseAudioContext, AudioBuffer>();
function noise(ctx: BaseAudioContext): AudioBuffer {
  let buf = noiseBuffers.get(ctx);
  if (!buf) {
    buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    noiseBuffers.set(ctx, buf);
  }
  return buf;
}

function note(ctx: BaseAudioContext, dest: AudioNode, t: number, hz: number, dur: number, type: OscillatorType, vol: number, cutoff: number): void {
  const osc = ctx.createOscillator();
  const filter = ctx.createBiquadFilter();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.value = hz;
  filter.type = 'lowpass';
  filter.frequency.value = cutoff;
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(vol, t + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(filter).connect(gain).connect(dest);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

function burst(ctx: BaseAudioContext, dest: AudioNode, t: number, dur: number, type: BiquadFilterType, cutoff: number, vol: number): void {
  const src = ctx.createBufferSource();
  src.buffer = noise(ctx);
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = cutoff;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(vol, t);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(filter).connect(gain).connect(dest);
  src.start(t);
  src.stop(t + dur + 0.02);
}

function kick(ctx: BaseAudioContext, dest: AudioNode, t: number, vol: number): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.frequency.setValueAtTime(150, t);
  osc.frequency.exponentialRampToValueAtTime(45, t + 0.12);
  gain.gain.setValueAtTime(vol, t);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
  osc.connect(gain).connect(dest);
  osc.start(t);
  osc.stop(t + 0.3);
}

function pad(ctx: BaseAudioContext, dest: AudioNode, t: number, dur: number, root: number, minor: boolean): void {
  for (const interval of [0, minor ? 3 : 4, 7]) {
    const osc = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.value = freq(48 + fold(root) + interval);
    osc.detune.value = (interval - 3) * 4;
    filter.type = 'lowpass';
    filter.frequency.value = 800;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(0.035, t + 0.5);
    gain.gain.setValueAtTime(0.035, t + dur - 0.4);
    gain.gain.linearRampToValueAtTime(0.0001, t + dur);
    osc.connect(filter).connect(gain).connect(dest);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }
}

/**
 * Schedule everything that happens on one sixteenth-note step.
 * `intensity` (0 to 1) brings in layers: snare, arpeggio, lead, then 16th hats and ghost kicks.
 */
export function scheduleStep(ctx: BaseAudioContext, dest: AudioNode, p: Pattern, step: number, t: number, intensity: number): void {
  const i = step % STEPS;
  const sixteenth = 60 / p.bpm / 4;
  if (i % 16 === 0) {
    const bar = i / 16;
    pad(ctx, dest, t, sixteenth * 16, p.pcs[bar], p.minor[bar]);
  }
  if (p.kick[i]) kick(ctx, dest, t, i % 16 === 10 ? 0.35 : 0.8);
  else if (intensity >= 0.85 && i % 16 === 14) kick(ctx, dest, t, 0.3);
  if (intensity >= 0.2 && p.snare[i]) {
    burst(ctx, dest, t, 0.13, 'bandpass', 1800, 0.3);
    note(ctx, dest, t, 190, 0.1, 'triangle', 0.18, 1500);
  }
  if (p.hat[i] === 1) burst(ctx, dest, t, 0.04, 'highpass', 7000, 0.1);
  else if (intensity >= 0.85) burst(ctx, dest, t, 0.03, 'highpass', 8000, 0.08);
  const bass = p.bass[i];
  if (bass !== null) note(ctx, dest, t, freq(bass), sixteenth * 3, 'triangle', 0.45, 500);
  const arp = p.arp[i];
  if (intensity >= 0.35 && arp !== null) note(ctx, dest, t, freq(arp), sixteenth * 1.6, 'square', 0.07, 2200);
  const lead = p.lead[i];
  if (intensity >= 0.65 && lead !== null) note(ctx, dest, t, freq(lead), sixteenth * 2.5, 'sawtooth', 0.075, 3000);
}

// ---------- playback ----------

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let pattern: Pattern | null = null;
let wantGrade: number | null = null; // set while music should be playing
let timer: ReturnType<typeof setInterval> | null = null;
let step = 0;
let nextTime = 0;
let intensity = 0.3;
let paused = false;

export const isMusicOn = (): boolean => getMusic();

function applyGain(fade = 0.05): void {
  if (!ctx || !master) return;
  const level = isMutedNow() || !getMusic() || paused ? 0 : MASTER;
  master.gain.setTargetAtTime(level, ctx.currentTime, fade);
}

function pump(): void {
  if (!ctx || !master || !pattern || paused) return;
  if (nextTime < ctx.currentTime - 0.25) nextTime = ctx.currentTime + 0.05; // fell behind (tab was in the background)
  const sixteenth = 60 / pattern.bpm / 4;
  while (nextTime < ctx.currentTime + 0.15) {
    scheduleStep(ctx, master, pattern, step, nextTime, intensity);
    nextTime += sixteenth;
    step++;
  }
}

function begin(): void {
  if (wantGrade === null || timer) return;
  ctx = getContext();
  if (!ctx) return; // not unlocked yet; onUnlock will call us again
  master = ctx.createGain();
  master.gain.value = 0;
  master.connect(ctx.destination);
  pattern = buildPattern(wantGrade);
  step = 0;
  nextTime = ctx.currentTime + 0.1;
  paused = false;
  applyGain(0.2);
  timer = setInterval(pump, 25);
}

onUnlock(begin);
onMuteChange(() => applyGain());

/** Start the loop for a grade. Waits for the first tap or key press if sound is not unlocked yet. */
export function startMusic(grade: number): void {
  stopMusic(0);
  wantGrade = grade;
  intensity = 0.3;
  begin();
}

export function stopMusic(fade = 0.6): void {
  wantGrade = null;
  if (timer) clearInterval(timer);
  timer = null;
  if (ctx && master) {
    const m = master;
    m.gain.setTargetAtTime(0, ctx.currentTime, fade / 3 + 0.001);
    setTimeout(() => m.disconnect(), fade * 1000 + 200);
  }
  master = null;
  pattern = null;
}

export function pauseMusic(): void {
  paused = true;
  applyGain(0.03);
}

export function resumeMusic(): void {
  if (!paused) return;
  paused = false;
  if (ctx) nextTime = ctx.currentTime + 0.05;
  applyGain(0.1);
}

/** 0 = calm, 1 = about to lose. Brings in the busier layers. */
export function setIntensity(v: number): void {
  intensity = Math.min(1, Math.max(0, v));
}

export function toggleMusic(): boolean {
  setMusic(!getMusic());
  applyGain();
  return getMusic();
}
