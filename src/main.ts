import Phaser from 'phaser';
import { HEIGHT, WIDTH } from './config';
import { BootScene } from './scenes/BootScene';
import { MenuScene } from './scenes/MenuScene';
import { GameScene } from './scenes/GameScene';
import { EditorScene } from './scenes/EditorScene';
import { LobbyScene } from './scenes/LobbyScene';
import { LeaderboardScene } from './scenes/LeaderboardScene';
import { CustomiseScene } from './scenes/CustomiseScene';
import { GradesScene } from './scenes/GradesScene';
import { HowToScene } from './scenes/HowToScene';
import { InitialsScene } from './scenes/InitialsScene';
import { AccountScene } from './scenes/AccountScene';
import { startAccount } from './game/account';

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: WIDTH,
  height: HEIGHT,
  backgroundColor: '#14171f',
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  scene: [BootScene, MenuScene, GameScene, EditorScene, LobbyScene, LeaderboardScene, CustomiseScene, AccountScene, InitialsScene, GradesScene, HowToScene],
});

// Dev-only handle so browser tests can inspect the running game.
if (import.meta.env.DEV) (window as unknown as { __game: Phaser.Game }).__game = game;

// Finish a sign-in the page was opened for, or refresh the saved account.
void startAccount();
