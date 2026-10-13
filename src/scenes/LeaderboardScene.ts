import Phaser from 'phaser';
import { WIDTH } from '../config';
import { formatTime } from '../game/format';
import { OVERALL } from '../game/boards';
import { arcadeLevel, ARCADE, resetsIn } from '../game/arcade';
import { boardTitle, Entry, fetchArcade, fetchTop, lastArcadeRun, lastPlayedBoard, todaysBoard } from '../game/leaderboard';
import { getAuth, getPlayerName } from '../game/storage';
import { lookOrDefault } from '../game/looks';
import { askName, makeButton, makeIcon, txt } from '../ui';

const GRADES = 30; // how far the grade arrows go
const BOARDS = [OVERALL, todaysBoard(), 'survival', ARCADE, ...Array.from({ length: GRADES }, (_, g) => `v${g}`)];
let lastBoard = 0; // remembered while the page is open

export class LeaderboardScene extends Phaser.Scene {
  private rows: Phaser.GameObjects.GameObject[] = [];
  private title!: Phaser.GameObjects.Text;
  private nameText!: Phaser.GameObjects.Text;
  private subtitle!: Phaser.GameObjects.Text;
  private nameButton!: Phaser.GameObjects.Container;
  private playButton!: Phaser.GameObjects.Container;
  private shown = -1; // guards against a slow reply for a board the player has already left

  constructor() {
    super('Leaderboard');
  }

  init(data: { board?: string }): void {
    const i = BOARDS.indexOf(data?.board ?? lastPlayedBoard() ?? OVERALL);
    if (i >= 0) lastBoard = i;
  }

  create(): void {
    this.add.image(0, 0, 'wall').setOrigin(0);
    txt(this, WIDTH / 2, 50, 'LEADERBOARD', 40, '#ffd166');
    this.title = txt(this, WIDTH / 2, 110, '', 24);
    const arrow = (x: number, label: string, delta: number) =>
      makeButton(this, x, 110, 52, 40, label, () => this.show((lastBoard + delta + BOARDS.length) % BOARDS.length), 0x59627f, 22);
    arrow(60, '‹', -1);
    arrow(WIDTH - 60, '›', 1);
    makeButton(this, 75, 160, 114, 34, 'Overall', () => this.show(0), 0x7a4fd0, 15);
    makeButton(this, 205, 160, 114, 34, 'Daily', () => this.show(1), 0xd9622b, 15);
    makeButton(this, 335, 160, 114, 34, 'Survival', () => this.show(2), 0xc23b5a, 15);
    makeButton(this, 465, 160, 114, 34, 'Arcade', () => this.show(3), 0xb8860b, 15);
    this.subtitle = txt(this, WIDTH / 2, 190, '', 12, '#9aa6cf', false);

    this.nameText = txt(this, WIDTH / 2, 580, '', 16, '#c9d1ee', false);
    this.nameButton = makeButton(this, 140, 660, 200, 46, 'Change name', () => {
      if (getAuth()) this.scene.start('Account'); // a signed-in player's name is changed on their account
      else if (askName()) this.show(lastBoard);
    }, 0x7a4fd0, 18);
    this.playButton = makeButton(this, 140, 660, 200, 46, 'Play Arcade', () => this.scene.start('Game', { level: arcadeLevel() }), 0xb8860b, 18);
    makeButton(this, 400, 660, 200, 46, 'Back', () => this.scene.start('Menu'), 0x59627f, 18);
    this.show(lastBoard);
  }

  private show(i: number): void {
    lastBoard = i;
    this.shown = i;
    const board = BOARDS[i];
    this.title.setText(boardTitle(board));
    const arcade = board === ARCADE;
    this.subtitle.setText(arcade ? `Survival with initials · this week's top 10 · clears in ${resetsIn()}` : board === OVERALL ? "Everyone's best score on every grade, added up, plus Survival" : '');
    this.nameButton.setVisible(!arcade);
    this.playButton.setVisible(arcade);
    const me = arcade ? (lastArcadeRun()?.initials ?? '') : getPlayerName();
    this.nameText.setText(arcade ? '' : me ? `You play as ${me}` : 'No name yet. Post a score to pick one.');
    this.rows.forEach((r) => r.destroy());
    this.rows = [];
    this.rows.push(txt(this, WIDTH / 2, 330, 'Loading…', 20, '#c9d1ee', false));
    void (arcade ? fetchArcade() : fetchTop(board)).then((scores) => {
      if (this.shown !== i || !this.sys.isActive()) return;
      this.rows.forEach((r) => r.destroy());
      this.rows = [];
      if (!scores) this.rows.push(txt(this, WIDTH / 2, 330, "Couldn't reach the leaderboard", 18, '#ff8a8a'));
      else if (!scores.length) this.rows.push(txt(this, WIDTH / 2, 330, 'No scores yet. Be the first!', 18, '#c9d1ee', false));
      else this.draw(scores, board, me);
    });
  }

  private draw(scores: Entry[], board: string, me: string): void {
    scores.forEach((e, n) => {
      const y = 215 + n * 38;
      const arcade = board === ARCADE;
      const run = lastArcadeRun();
      const mine = arcade ? !!run && e.name === run.initials && e.score === run.score : e.name.toLowerCase() === me.toLowerCase();
      const colour = mine ? '#ffd166' : n < 3 ? '#ffffff' : '#c9d1ee';
      const left = (x: number, s: string) => this.rows.push(txt(this, x, y, s, 18, colour, mine || n < 3).setOrigin(0, 0.5));
      if (mine) this.rows.push(this.add.rectangle(WIDTH / 2, y, WIDTH - 60, 34, 0xffd166, 0.12));
      left(44, `${n + 1}`);
      if (!arcade) this.rows.push(makeIcon(this, 94, y, 36, lookOrDefault(e.look)));
      const name = txt(this, arcade ? 94 : 120, y, e.name, arcade ? 24 : 18, colour, mine || n < 3).setOrigin(0, 0.5);
      if (arcade) name.setFontFamily('monospace');
      this.rows.push(name);
      if (e.verified) this.rows.push(txt(this, 120 + name.width + 7, y, '✓', 15, '#7ae6dc').setOrigin(0, 0.5)); // signed in: this name is theirs
      const right = txt(this, WIDTH - 48, y, board === 'survival' || arcade ? `${e.score}  ·  ${formatTime(e.seconds)}` : String(e.score), 18, colour, mine || n < 3).setOrigin(1, 0.5);
      this.rows.push(right);
    });
  }
}
