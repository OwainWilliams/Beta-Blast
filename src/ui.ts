import Phaser from 'phaser';
import { Hold, VOLUME } from './game/grid';
import { cleanName, MAX_NAME } from './game/leaderboard';
import { getPlayerName, setPlayerName } from './game/storage';

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

/** Little stick-figure climber, origin at the feet. */
export function makeClimber(scene: Phaser.Scene, x: number, y: number, scale = 1): Phaser.GameObjects.Container {
  const g = scene.add.graphics();
  g.lineStyle(4, 0xffd166, 1);
  g.beginPath();
  g.moveTo(0, -38).lineTo(0, -16); // body
  g.moveTo(0, -34).lineTo(-10, -48); // left arm up
  g.moveTo(0, -34).lineTo(10, -42); // right arm
  g.moveTo(0, -16).lineTo(-8, 0); // left leg
  g.moveTo(0, -16).lineTo(9, -2); // right leg
  g.strokePath();
  g.fillStyle(0xffd166, 1).fillCircle(0, -46, 7);
  g.fillStyle(0xffffff, 1).fillRoundedRect(4, -22, 8, 9, 2); // chalk bag
  return scene.add.container(x, y, [g]).setScale(scale);
}

/** Texture for a hold on the wall; a damaged volume shows its cracks. */
export function textureFor(hold: Hold): string {
  if (hold.type === VOLUME && (hold.hp ?? 2) < 2) return 'hold-6c';
  return `hold-${hold.type}`;
}
