import Phaser from 'phaser';

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
