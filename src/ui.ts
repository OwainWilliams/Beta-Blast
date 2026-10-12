import Phaser from 'phaser';
import { Hold, VOLUME } from './game/grid';
import { cleanName, MAX_NAME } from './game/leaderboard';
import { colourOf, DEFAULT_LOOK, lighten, Look, lookOrDefault } from './game/looks';
import { getLookCode, getPlayerName, setPlayerName } from './game/storage';

export const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';

export function txt(
  scene: Phaser.Scene,
  x: number,
  y: number,
  text: string,
  size = 20,
  color = '#ffffff',
  bold = true,
): Phaser.GameObjects.Text {
  return scene.add
    .text(x, y, text, { fontFamily: FONT, fontSize: `${size}px`, color, fontStyle: bold ? 'bold' : 'normal', align: 'center' })
    .setOrigin(0.5)
    .setResolution(2);
}

export function makeButton(
  scene: Phaser.Scene,
  x: number,
  y: number,
  w: number,
  h: number,
  label: string,
  onClick: () => void,
  fill = 0x2f6fdd,
  size = 20,
): Phaser.GameObjects.Container {
  const bg = scene.add.rectangle(0, 0, w, h, fill).setStrokeStyle(2, 0xffffff, 0.35);
  const text = txt(scene, 0, 0, label, size);
  const c = scene.add.container(x, y, [bg, text]);
  bg.setInteractive({ useHandCursor: true });
  bg.on('pointerover', () => bg.setAlpha(0.85));
  bg.on('pointerout', () => bg.setAlpha(1));
  bg.on('pointerup', onClick);
  return c;
}

export interface Toggle {
  button: Phaser.GameObjects.Container;
  /** Re-read the label, for when the value was changed from somewhere else. */
  refresh(): void;
}

/** A button whose label shows a setting ("Sound: on"). `flip` changes the setting; the label updates itself. */
export function makeToggle(scene: Phaser.Scene, x: number, y: number, w: number, h: number, label: () => string, flip: () => void, size = 16, fill = 0x59627f): Toggle {
  const text = txt(scene, 0, 0, label(), size);
  const bg = scene.add.rectangle(0, 0, w, h, fill).setStrokeStyle(2, 0xffffff, 0.35);
  const button = scene.add.container(x, y, [bg, text]);
  const refresh = () => void text.setText(label());
  bg.setInteractive({ useHandCursor: true });
  bg.on('pointerover', () => bg.setAlpha(0.85));
  bg.on('pointerout', () => bg.setAlpha(1));
  bg.on('pointerup', () => {
    flip();
    refresh();
  });
  return { button, refresh };
}

/**
 * Copy text to the clipboard. Where the browser won't allow that (an insecure page, a locked-down
 * webview), show the text in a prompt the player can copy from instead. True if it was copied.
 */
export async function copyToClipboard(text: string, fallbackMessage: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    window.prompt(fallbackMessage, text);
    return false;
  }
}

/** Ask for the leaderboard name and remember it. Null if the player cancelled or typed nothing usable. */
export function askName(): string | null {
  const input = window.prompt(`Your name for the leaderboard (letters and numbers, up to ${MAX_NAME})`, getPlayerName());
  const name = input === null ? null : cleanName(input);
  if (name) setPlayerName(name);
  else if (input !== null) window.alert('Use letters or numbers, up to 12 characters.');
  return name;
}

const INK = 0x1d2233; // the cartoon outline
const SKIN = 0xf2c9a0;
const PANTS = 0x2b3a67;
const LOOP_MS = 650; // one climbing stride, left and right

/** A thick rounded limb with an outline: a line with round ends. */
function limb(g: Phaser.GameObjects.Graphics, x1: number, y1: number, x2: number, y2: number, width: number, colour: number): void {
  for (const [w, c] of [[width + 3, INK], [width, colour]] as const) {
    g.lineStyle(w, c, 1).lineBetween(x1, y1, x2, y2);
    g.fillStyle(c, 1).fillCircle(x1, y1, w / 2).fillCircle(x2, y2, w / 2);
  }
}

/**
 * The climber: a cartoon in a knitted beanie with a harness, a chalk bag on the back and orange climbing shoes.
 * Origin at the feet; about 66 units tall. Beanie, shirt and chalk bag colours come from the look (the player's
 * saved one unless another is given). Call climb(ms) to make the arms and legs scramble upwards for a while; at
 * rest both hands are up on holds. `bust` draws just the torso and head, for small icons.
 */
export class Climber extends Phaser.GameObjects.Container {
  private readonly back: Phaser.GameObjects.Graphics;
  private readonly limbs: Phaser.GameObjects.Graphics;
  private readonly front: Phaser.GameObjects.Graphics;
  private look: Look;
  private phase = 0;
  private remaining = 0; // ms of climbing still to do

  constructor(scene: Phaser.Scene, x: number, y: number, scale = 1, look?: Look, private readonly bust = false) {
    super(scene, x, y);
    this.look = look ?? lookOrDefault(getLookCode());
    this.back = scene.add.graphics();
    this.limbs = scene.add.graphics();
    this.front = scene.add.graphics();
    this.add([this.back, this.limbs, this.front]);
    this.paint();
    this.setScale(scale);
    scene.add.existing(this);
  }

  /** Change what the climber is wearing. */
  setLook(look: Look): this {
    this.look = look;
    this.paint();
    return this;
  }

  private paint(): void {
    this.back.clear();
    this.limbs.clear();
    this.front.clear();
    if (!this.bust) {
      this.drawBag(this.back);
      this.drawLimbs(null);
    }
    this.drawBody(this.front);
  }

  /** Climb for at least `ms` more milliseconds. */
  climb(ms: number): void {
    this.remaining = Math.max(this.remaining, ms);
  }

  preUpdate(_time: number, delta: number): void {
    if (this.remaining <= 0) return;
    this.remaining -= delta;
    this.phase = (this.phase + delta / LOOP_MS) % 1;
    this.drawLimbs(this.remaining > 0 ? this.phase : null);
  }

  private drawBag(g: Phaser.GameObjects.Graphics): void {
    g.fillStyle(colourOf('bag', this.look), 1).fillRoundedRect(5, -27, 12, 14, 4);
    g.lineStyle(1.5, INK, 1).strokeRoundedRect(5, -27, 12, 14, 4);
    g.fillStyle(0xffffff, 1).fillEllipse(11, -27, 12, 5);
    g.lineStyle(1.5, INK, 1).strokeEllipse(11, -27, 12, 5);
    g.fillStyle(0xffffff, 0.9).fillCircle(11, -19, 2.6);
  }

  /** Arms and legs. `phase` is 0 to 1 through a stride, or null for the resting pose. */
  private drawLimbs(phase: number | null): void {
    const g = this.limbs.clear();
    const shirt = colourOf('shirt', this.look);
    // how far through the stride each side is: +1 is the left hand high and left foot down
    const s = phase === null ? 0 : Math.sin(phase * Math.PI * 2);
    for (const side of [-1, 1] as const) {
      const lead = side === -1 ? s : -s;
      // legs: the foot on the lifting side comes up with the knee bent outwards
      const lift = phase === null ? 0 : 3 * (1 - lead);
      const hipX = side * 4;
      const footX = side * (8 + 0.4 * lift);
      const footY = -3 - lift;
      limb(g, hipX, -18, side * (6 + 0.9 * lift), (-18 + footY) / 2, 7, PANTS);
      limb(g, side * (6 + 0.9 * lift), (-18 + footY) / 2, footX, footY, 7, PANTS);
      g.fillStyle(0xd9622b, 1).fillEllipse(footX + side * 2, footY + 0.5, 13, 6.5);
      g.lineStyle(1.5, INK, 1).strokeEllipse(footX + side * 2, footY + 0.5, 13, 6.5);
      g.fillStyle(0xffffff, 0.9).fillEllipse(footX + side * 4, footY + 1.5, 5, 2);
      // arms: the reaching hand is high and straight, the other pulls down with the elbow out
      const handY = phase === null ? -52 : -48 - 6 * lead;
      const handX = side * 14.5;
      const elbowX = side * (11.5 + 0.35 * (handY + 54));
      const elbowY = (-36 + handY) / 2;
      limb(g, side * 8, -36, elbowX, elbowY, 5, SKIN);
      limb(g, elbowX, elbowY, handX, handY, 5, SKIN);
      limb(g, side * 8, -36, side * 8 + (elbowX - side * 8) * 0.6, -36 + (elbowY + 36) * 0.6, 6.5, shirt);
      g.fillStyle(SKIN, 1).fillCircle(handX, handY - 1.5, 3.6);
      g.lineStyle(1.2, INK, 1).strokeCircle(handX, handY - 1.5, 3.6);
    }
  }

  private drawBody(g: Phaser.GameObjects.Graphics): void {
    const outline = (w = 1.5) => g.lineStyle(w, INK, 1);
    // torso: shirt, then the harness belt and buckle
    g.fillStyle(colourOf('shirt', this.look), 1).fillRoundedRect(-9, -41, 18, 25, 6);
    outline().strokeRoundedRect(-9, -41, 18, 25, 6);
    g.fillStyle(0xffd166, 1).fillRect(-9, -22, 18, 4.5);
    outline(1).strokeRect(-9, -22, 18, 4.5);
    g.fillStyle(0xffffff, 1).fillRect(-2, -22.5, 4, 5.5);
    outline(1).strokeRect(-2, -22.5, 4, 5.5);

    // head
    g.fillStyle(SKIN, 1).fillCircle(0, -47, 10.5);
    outline(1.8).strokeCircle(0, -47, 10.5);
    g.fillStyle(0xf2a0a0, 0.7).fillCircle(-6.6, -42.5, 2.3).fillCircle(6.6, -42.5, 2.3); // cheeks
    for (const sx of [-1, 1]) {
      g.fillStyle(0xffffff, 1).fillEllipse(sx * 3.9, -45, 5, 6);
      outline(1).strokeEllipse(sx * 3.9, -45, 5, 6);
      g.fillStyle(INK, 1).fillCircle(sx * 3.9 + 0.4, -44.6, 1.7);
      g.fillStyle(0xffffff, 1).fillCircle(sx * 3.9 + 1, -45.5, 0.6);
    }
    outline(1.6).beginPath().arc(0, -42.5, 4, 0.25, Math.PI - 0.25).strokePath(); // grin

    // beanie: a knitted dome, a folded ribbed cuff and a pom-pom
    const wool = colourOf('beanie', this.look);
    g.fillStyle(wool, 1).beginPath().arc(0, -51.5, 11.5, Math.PI, 0).closePath().fillPath();
    outline(1.8).beginPath().arc(0, -51.5, 11.5, Math.PI, 0).closePath().strokePath();
    g.fillStyle(lighten(wool, 0.28), 1).fillRoundedRect(-12.5, -54, 25, 6.2, 2.6);
    outline(1.3).strokeRoundedRect(-12.5, -54, 25, 6.2, 2.6);
    g.lineStyle(1, wool, 0.9);
    for (let x = -9; x <= 9; x += 3) g.lineBetween(x, -53.2, x, -48.9); // ribbing
    g.fillStyle(0xffffff, 1).fillCircle(0, -64, 4);
    outline(1.5).strokeCircle(0, -64, 4);
  }
}

export const makeClimber = (scene: Phaser.Scene, x: number, y: number, scale = 1): Climber => new Climber(scene, x, y, scale);

/** A small head-and-shoulders picture of someone's climber, centred on (x, y). */
export const makeIcon = (scene: Phaser.Scene, x: number, y: number, size: number, look: Look = DEFAULT_LOOK): Climber => new Climber(scene, x, y + 42 * (size / 66), size / 66, look, true);

/** Texture for a hold on the wall; a damaged volume shows its cracks. */
export function textureFor(hold: Hold): string {
  if (hold.type === VOLUME && (hold.hp ?? 2) < 2) return 'hold-6c';
  return `hold-${hold.type}`;
}
