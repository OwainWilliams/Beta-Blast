import Phaser from 'phaser';
import { GRID_X, WIDTH } from '../config';
import { D, Grid, Hold, isColour, makeHold, R, H, SLICK, VOLUME } from '../game/grid';
import { codeFromInput, decodeRoute, emptyLayout, encodeRoute, MAX_EDIT_ROWS, MAX_PUMP, MIN_PUMP, Route, routeLevel, TIMER_NAMES } from '../game/routes';
import { unlockAudio } from '../game/audio';
import { makeButton, textureFor, txt } from '../ui';

const ERASER = -1;
const TOOLS = [0, 1, 2, 3, 4, VOLUME, SLICK, ERASER];
const TOOL_NAMES: Record<number, string> = { 0: 'Jug', 1: 'Crimp', 2: 'Sloper', 3: 'Pinch', 4: 'Pocket', [VOLUME]: 'Volume', [SLICK]: 'Slick', [ERASER]: 'Eraser' };

export class EditorScene extends Phaser.Scene {
  private grid = new Grid();
  private sprites = new Map<Hold, Phaser.GameObjects.Image>();
  private tool = 0;
  private pump = 6;
  private bombs = true;
  private wilds = true;
  private timer = 0;
  private timerBtn!: Phaser.GameObjects.Container;
  private selection!: Phaser.GameObjects.Rectangle;
  private info!: Phaser.GameObjects.Text;
  private status!: Phaser.GameObjects.Text;
  private pumpText!: Phaser.GameObjects.Text;
  private bombBtn!: Phaser.GameObjects.Container;
  private wildBtn!: Phaser.GameObjects.Container;
  private pendingCode?: string;

  constructor() {
    super('Editor');
  }

  init(data: { code?: string }): void {
    this.pendingCode = data?.code;
  }

  create(): void {
    this.grid = new Grid();
    this.sprites.clear();
    this.tool = 0;
    this.pump = 6;
    this.bombs = true;
    this.wilds = true;
    this.timer = 0;
    for (let r = 0; r < MAX_EDIT_ROWS; r++) this.grid.ensureRow(r);

    this.add.image(0, 0, 'wall').setOrigin(0);
    this.drawSlots();
    txt(this, WIDTH / 2, 462, 'Route Setter: tap or drag to place holds', 16, '#c9d1ee', false);

    // tool palette
    TOOLS.forEach((t, i) => {
      const x = 60 + i * 60;
      const y = 500;
      if (t === ERASER) {
        this.add.rectangle(x, y, 40, 40, 0x59627f).setStrokeStyle(2, 0xffffff, 0.4);
        txt(this, x, y, '⌫', 22);
      } else {
        this.add.image(x, y, `hold-${t}`).setScale(0.85);
      }
      this.add.rectangle(x, y, 52, 52, 0x000000, 0.001).setInteractive({ useHandCursor: true }).on('pointerup', () => this.pick(i));
    });
    this.selection = this.add.rectangle(60, 500, 54, 54).setStrokeStyle(3, 0xffd166);

    this.info = txt(this, WIDTH / 2, 538, '', 14, '#9aa6cf', false);
    this.status = txt(this, WIDTH / 2, 700, '', 14, '#ffd166', false);

    // pump limit, bombs and mega jugs
    txt(this, 58, 574, 'Pump', 16);
    makeButton(this, 122, 574, 34, 34, '–', () => this.setPump(this.pump - 1), 0x59627f);
    this.pumpText = txt(this, 158, 574, String(this.pump), 20);
    makeButton(this, 194, 574, 34, 34, '+', () => this.setPump(this.pump + 1), 0x59627f);
    this.bombBtn = makeButton(this, 313, 574, 118, 34, '', () => this.toggleBombs(), 0x59627f, 13);
    this.wildBtn = makeButton(this, 445, 574, 118, 34, '', () => this.toggleWilds(), 0x59627f, 13);
    this.toggleBombs(true);
    this.toggleWilds(true);

    makeButton(this, 105, 624, 150, 46, 'Test it', () => this.test(), 0x2e8b57);
    makeButton(this, 270, 624, 150, 46, 'Copy link', () => void this.copyLink(), 0x2f6fdd);
    makeButton(this, 435, 624, 150, 46, 'Load code', () => this.loadPrompt(), 0x2f6fdd);
    makeButton(this, 105, 674, 150, 38, 'Clear', () => this.clear(), 0x8a3b3b, 16);
    this.timerBtn = makeButton(this, 270, 674, 150, 38, '', () => this.cycleTimer(), 0x59627f, 15);
    this.cycleTimer(true);
    makeButton(this, 435, 674, 150, 38, 'Back', () => this.scene.start('Menu'), 0x59627f, 16);

    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      unlockAudio();
      this.paint(p);
    });
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => p.isDown && this.paint(p));

    if (this.pendingCode) this.loadRoute(this.pendingCode, 'Route restored');
    else this.refreshInfo();
  }

  private drawSlots(): void {
    const g = this.add.graphics();
    g.lineStyle(1.5, 0x55608a, 0.5);
    for (let r = 0; r < MAX_EDIT_ROWS; r++) {
      for (let c = 0; c < this.grid.rowLength(r); c++) {
        g.strokeCircle(GRID_X + this.grid.cellX(r, c), this.grid.cellY(r), R - 4);
      }
    }
  }

  private pick(i: number): void {
    this.tool = TOOLS[i];
    this.selection.setPosition(60 + i * 60, 500);
    this.say(TOOL_NAMES[this.tool]);
  }

  private say(text: string): void {
    this.status.setText(text);
  }

  private setPump(v: number): void {
    this.pump = Phaser.Math.Clamp(v, MIN_PUMP, MAX_PUMP);
    this.pumpText.setText(String(this.pump));
  }

  private toggleBombs(init = false): void {
    if (!init) this.bombs = !this.bombs;
    (this.bombBtn.list[1] as Phaser.GameObjects.Text).setText(`Bombs: ${this.bombs ? 'on' : 'off'}`);
  }

  /** Row timer setting: off, slow, normal, fast. */
  private cycleTimer(init = false): void {
    if (!init) this.timer = (this.timer + 1) % TIMER_NAMES.length;
    (this.timerBtn.list[1] as Phaser.GameObjects.Text).setText(`Row timer: ${TIMER_NAMES[this.timer]}`);
  }

  private toggleWilds(init = false): void {
    if (!init) this.wilds = !this.wilds;
    (this.wildBtn.list[1] as Phaser.GameObjects.Text).setText(`Mega jugs: ${this.wilds ? 'on' : 'off'}`);
  }

  // ---------- editing ----------

  private cellAt(x: number, y: number): [number, number] | null {
    const r = Math.round((y - R) / H);
    if (r < 0 || r >= MAX_EDIT_ROWS) return null;
    const origin = this.grid.isShifted(r) ? D : R;
    const c = Math.round((x - GRID_X - origin) / D);
    if (c < 0 || c >= this.grid.rowLength(r)) return null;
    return [r, c];
  }

  private paint(p: Phaser.Input.Pointer): void {
    if (p.y > 450) return;
    const cell = this.cellAt(p.x, p.y);
    if (!cell) return;
    const [r, c] = cell;
    const old = this.grid.get(r, c);
    if (this.tool === ERASER ? !old : old?.type === this.tool) return;
    if (old) {
      this.sprites.get(old)?.destroy();
      this.sprites.delete(old);
    }
    if (this.tool === ERASER) this.grid.set(r, c, null);
    else {
      const hold = makeHold(this.tool);
      this.grid.set(r, c, hold);
      const img = this.add.image(GRID_X + this.grid.cellX(r, c), this.grid.cellY(r), textureFor(hold));
      this.sprites.set(hold, img);
    }
    this.refreshInfo();
  }

  private refreshInfo(): void {
    const cells = this.grid.cells();
    const coloured = cells.filter(([r, c]) => isColour(this.grid.get(r, c)!.type)).length;
    const hanging = this.grid.findFloating().length;
    this.info.setText(`${coloured} holds · ${cells.length - coloured} obstacles${hanging ? ` · ${hanging} not attached to the top row (they fall away)` : ''}`);
  }

  private clear(): void {
    for (const s of this.sprites.values()) s.destroy();
    this.sprites.clear();
    for (const [r, c] of this.grid.cells()) this.grid.set(r, c, null);
    this.refreshInfo();
    this.say('Cleared');
  }

  private toRoute(): Route {
    const layout = emptyLayout();
    for (const [r, c] of this.grid.cells()) layout[r][c] = this.grid.get(r, c)!.type;
    return { layout, shotsPerDrop: this.pump, bombs: this.bombs, wilds: this.wilds, timer: this.timer };
  }

  /** The route as a code, or null (with a message) if it can't be played. */
  private code(): string | null {
    const code = encodeRoute(this.toRoute());
    if (!decodeRoute(code)) {
      this.say('Add at least one coloured hold first');
      return null;
    }
    return code;
  }

  // ---------- actions ----------

  private test(): void {
    const code = this.code();
    const route = code && decodeRoute(code);
    if (!code || !route) return;
    this.scene.start('Game', { level: routeLevel(route, code), from: 'editor', code });
  }

  private async copyLink(): Promise<void> {
    const code = this.code();
    if (!code) return;
    const url = `${window.location.origin}${window.location.pathname}?route=${encodeURIComponent(code)}`;
    try {
      await navigator.clipboard.writeText(url);
      this.say('Link copied. Send it to a friend!');
    } catch {
      window.prompt('Copy this link to share your route', url);
    }
  }

  private loadPrompt(): void {
    const input = window.prompt('Paste a route code or link');
    if (input === null) return;
    const code = codeFromInput(input);
    if (code) this.loadRoute(code, 'Route loaded');
    else this.say("That code doesn't look right");
  }

  private loadRoute(code: string, message: string): void {
    const route = decodeRoute(code);
    if (!route) {
      this.say("That code doesn't look right");
      return;
    }
    this.clear();
    route.layout.forEach((row, r) =>
      row.forEach((type, c) => {
        if (type < 0) return;
        const hold = makeHold(type);
        this.grid.set(r, c, hold);
        this.sprites.set(hold, this.add.image(GRID_X + this.grid.cellX(r, c), this.grid.cellY(r), textureFor(hold)));
      }),
    );
    this.setPump(route.shotsPerDrop);
    this.bombs = route.bombs;
    this.wilds = route.wilds;
    this.timer = route.timer;
    this.cycleTimer(true);
    this.toggleBombs(true);
    this.toggleWilds(true);
    this.refreshInfo();
    this.say(message);
  }
}

