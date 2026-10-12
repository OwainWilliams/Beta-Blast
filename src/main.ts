import Phaser from 'phaser';
import { HEIGHT, WIDTH } from './config';
import { BootScene } from './scenes/BootScene';
import { MenuScene } from './scenes/MenuScene';
import { GameScene } from './scenes/GameScene';
import { EditorScene } from './scenes/EditorScene';
import { LobbyScene } from './scenes/LobbyScene';
import { LeaderboardScene } from './scenes/LeaderboardScene';

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: WIDTH,
  height: HEIGHT,
  backgroundColor: '#14171f',
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  scene: [BootScene, MenuScene, GameScene, EditorScene, LobbyScene, LeaderboardScene],
});

// Dev-only handle so browser tests can inspect the running game.
if (import.meta.env.DEV) (window as unknown as { __game: Phaser.Game }).__game = game;
