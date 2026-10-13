// Regenerates the README screenshots in docs/screenshots from the running game.
//
//   npm i --no-save playwright && npx playwright install chromium
//   node scripts/screenshots.mjs
//
// It starts the dev server itself (the shots set up game states through the dev-only window.__game handle).
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const PORT = 5197;
const URL = `http://localhost:${PORT}/`;
const OUT = 'docs/screenshots';
mkdirSync(OUT, { recursive: true });

// A save that looks lived-in: some grades sent, some scores, and every tip already seen so none cover the screen.
const HINTS = Object.fromEntries(['aim', 'match', 'pump', 'cut', 'combo', 'volume', 'slick', 'wild', 'bomb', 'timer', 'survival', 'versus'].map((k) => [k, true]));
const SAVE = {
  best: { v0: 1240, v1: 2010, v2: 2860, v3: 3320, survival: 5210 },
  bestTime: { survival: 273 },
  sent: { v0: true, v1: true, v2: true, v3: true },
  hints: HINTS,
  name: 'Owain',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
for (let i = 0; i < 60; i++) {
  try {
    if ((await fetch(URL)).ok) break;
  } catch {
    await sleep(500);
  }
}

const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });

async function newPage(context) {
  const p = await context.newPage();
  p.on('pageerror', (e) => console.error('page error:', e.message));
  await p.goto(URL);
  await p.waitForFunction(() => window.__game?.scene.isActive('Menu'));
  return p;
}
const context = await browser.newContext({ viewport: { width: 540, height: 720 } });
await context.addInitScript((save) => localStorage.setItem('beta-blast.v1', JSON.stringify(save)), SAVE);

/** Run code inside the page with the game's modules available as `m` and the game object as `game`. */
const inPage = (p, fn, arg) =>
  p.evaluate(
    async ([src, a]) => {
      const m = {
        levels: await import('/src/game/levels.ts'),
        engine: await import('/src/game/engine.ts'),
        routes: await import('/src/game/routes.ts'),
        grid: await import('/src/game/grid.ts'),
        arcade: await import('/src/game/arcade.ts'),
      };
      return new Function('m', 'game', 'arg', `return (async () => { ${src} })()`)(m, window.__game, a);
    },
    [fn, arg],
  );
const shot = async (p, name) => {
  await p.bringToFront();
  await p.screenshot({ path: `${OUT}/${name}.png` });
  console.log('saved', name);
};
/** Aim at the best popping shot (or the worst, for a miss). Returns false if the current hold has none. */
const aimAt = (p, pop = true) =>
  inPage(
    p,
    `const s = game.scene.getScene('Game'), e = s.engine; let best = null;
     for (let a = -1.3; a <= 1.3; a += 0.02) {
       const { end } = e.trace(a, 12, false); const cell = e.preview(end.x, end.y); if (!cell || e.cur === 5) continue;
       const type = e.cur >= 8 ? e.resolveWild(cell) : e.cur;
       e.grid.set(cell[0], cell[1], { type }); const n = e.grid.findMatches(cell[0], cell[1]).length; e.grid.set(cell[0], cell[1], null);
       const score = arg ? (n >= 3 ? n : -1) : (n < 3 ? 10 - n : -1);
       if (score > 0 && (!best || score > best.score)) best = { a, score };
     }
     if (best) s.aim = best.a; return !!best;`,
    pop,
  );
const fire = async (p, wait = 1700) => {
  await p.keyboard.press('Space');
  await sleep(wait);
};
const startGame = (p, levelSrc) =>
  inPage(p, `const level = ${levelSrc}; game.scene.getScene('Menu').scene.start('Game', { level });`).then(() => sleep(1200));

try {
  // 1. the menu
  const menu = await newPage(context);
  await sleep(1200);
  await shot(menu, 'menu');

  // 2. a hard wall with obstacles, two pops in a row for a combo
  await startGame(menu, `m.levels.gradeLevel(8)`);
  for (let i = 0; i < 6; i++) {
    if (!(await aimAt(menu))) await menu.keyboard.press('s');
    if (await aimAt(menu)) await fire(menu);
    const combo = await inPage(menu, `return game.scene.getScene('Game').engine.combo;`);
    if (combo >= 2) break;
  }
  if (!(await aimAt(menu))) await menu.keyboard.press('s');
  await aimAt(menu);
  await menu.mouse.move(270, 300);
  await sleep(500);
  await shot(menu, 'gameplay');

  // 3. a mega jug in the bag, with the ghost showing the colour it will turn into
  await inPage(menu, `game.scene.getScene('Game').scene.start('Menu');`);
  await sleep(800);
  const seed = await inPage(menu, `for (let s = 1; s < 5000; s++) { const e = new m.engine.Engine({ ...m.levels.gradeLevel(6), seed: s }); if (e.cur === m.grid.WILD) return s; } return null;`);
  await startGame(menu, `{ ...m.levels.gradeLevel(6), seed: ${seed} }`);
  await aimAt(menu);
  await sleep(500);
  await shot(menu, 'mega-jug');

  // 4. survival, as it moves up a stage
  await inPage(menu, `game.scene.getScene('Game').scene.start('Menu');`);
  await sleep(800);
  await startGame(menu, `m.levels.survivalLevel(2026)`);
  await inPage(menu, `game.scene.getScene('Game').engine.elapsed = 40 * 3 - 0.15;`);
  await sleep(900);
  await shot(menu, 'survival');

  // 5. the route setter, with a route someone has built
  await inPage(menu, `game.scene.getScene('Game').scene.start('Menu');`);
  await sleep(800);
  const code = await inPage(
    menu,
    `const l = m.routes.emptyLayout();
     for (let r = 0; r < 6; r++) for (let c = 0; c < l[r].length; c++) l[r][c] = (r + c * 2) % 5 === 4 ? -1 : (c + r) % 4;
     l[2][2] = 6; l[2][6] = 6; l[3][4] = 7; l[4][1] = 7; l[4][7] = 6;
     return m.routes.encodeRoute({ layout: l, shotsPerDrop: 6, bombs: true, wilds: true, timer: 2 });`,
  );
  await inPage(menu, `game.scene.getScene('Menu').scene.start('Editor', { code: arg });`, code);
  await sleep(1000);
  await shot(menu, 'route-setter');

  // 6. the send: a route cleared, with the celebration
  await inPage(menu, `game.scene.getScene('Editor').scene.start('Menu');`);
  await sleep(800);
  const tiny = await inPage(
    menu,
    `const l = m.routes.emptyLayout(); l[0][0] = 1; l[0][1] = 1; l[0][9] = 6;
     const route = { layout: l, shotsPerDrop: 6, bombs: false, wilds: false, timer: 0 };
     const code = m.routes.encodeRoute(route); return JSON.stringify(m.routes.routeLevel(route, code));`,
  );
  await startGame(menu, tiny);
  await inPage(menu, `const s = game.scene.getScene('Game'); s.aim = Math.atan2(150 - 270, 640 - 30);`);
  await menu.keyboard.press('Space');
  await sleep(1750);
  await shot(menu, 'sent');

  // 7. two players: a real match between two pages of the same browser
  const A = menu;
  await inPage(A, `game.scene.getScene('Game').scene.start('Menu');`);
  const B = await newPage(context);
  await sleep(600);
  await A.mouse.click(140, 332); // 2 Player
  await sleep(600);
  await A.mouse.click(150, 492); // host in this tab
  await sleep(900);
  await shot(A, 'lobby');
  const keyword = await inPage(A, `return game.scene.getScene('Lobby').host.code;`);
  B.on('dialog', (d) => d.accept(keyword));
  await B.mouse.click(140, 332);
  await sleep(600);
  await B.mouse.click(390, 492); // join from another tab
  await sleep(1800);
  await A.mouse.click(270, 430); // start
  for (let i = 0; i < 60; i++) {
    const states = await Promise.all([A, B].map((p) => inPage(p, `return game.scene.getScene('Game')?.state ?? null;`)));
    if (states.every((s) => s === 'aiming')) break;
    await sleep(400);
  }
  // B pops a few times (sending rows to A), A pops once
  for (let i = 0; i < 3; i++) {
    if (!(await aimAt(B))) await B.keyboard.press('s');
    if (await aimAt(B)) await fire(B);
  }
  if (!(await aimAt(A))) await A.keyboard.press('s');
  if (await aimAt(A)) await fire(A);
  await sleep(600);
  await A.mouse.move(300, 260);
  await sleep(500);
  await shot(A, 'two-player');
  await B.close();

  // 8. customising the climber, then the overall leaderboard showing everyone's, then a signed-in account (the API is faked, so this works offline)
  const arcadePosts = [];
  const C = await newPage(context);
  await C.route('**/*workers.dev/**', (r) => {
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type' };
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: cors });
    const reqUrl = new globalThis.URL(r.request().url());
    if (reqUrl.pathname === '/arcade') {
      if (r.request().method() === 'POST') {
        arcadePosts.push(JSON.parse(r.request().postData() ?? '{}'));
        return r.fulfill({ json: { qualified: true, rank: 4 }, headers: cors });
      }
      const rows = [['ACE', 9100, 213], ['OWN', 8200, 190], ['SAM', 7400, 171], ['PIP', 5100, 120], ['BOB', 3000, 92], ['ZZZ', 2500, 80], ['MAX', 2210, 75], ['K8T', 1800, 60]];
      return r.fulfill({ json: { week: '2026-10-12', scores: rows.map(([name, score, seconds]) => ({ name, score, seconds, look: '', verified: false })) }, headers: cors });
    }
    const board = reqUrl.searchParams.get('board') ?? 'v3'; // (URL is the dev server's address in this script)
    const totals = board === 'overall'; // the overall board adds up each player's best scores, so its numbers are bigger
    const scores = [
      { name: 'Ann', score: 9100, look: '742', verified: true },
      { name: 'Owain', score: 8200, look: '151', verified: true },
      { name: 'Sam', score: 7400, look: '270' },
      { name: 'ClimbKing99', score: 6900, look: '507', verified: true },
      { name: 'Pip', score: 5100, look: '365' },
      { name: 'Bob', score: 3000, look: '' },
    ].map((e) => ({ seconds: 0, verified: false, ...e, score: totals ? e.score * 3 + 400 : e.score }));
    return r.fulfill({ json: { board, scores }, headers: cors });
  });
  await inPage(C, `game.scene.getScene('Menu').scene.start('Customise');`);
  await sleep(800);
  for (const [x, y] of [[52 + 62, 335], [52 + 5 * 62, 425], [52 + 62, 515]]) {
    await C.mouse.click(x, y); // red beanie, teal shirt, blue chalk bag
    await sleep(250);
  }
  await C.mouse.click(52 + 7 * 62, 335); // a locked one, to show how it is earned
  await sleep(500);
  await shot(C, 'customise');
  await inPage(C, `game.scene.getScene('Customise').scene.start('Leaderboard', { board: 'overall' });`);
  await sleep(1000);
  await shot(C, 'leaderboard');
  // signed in with GitHub, with a leaderboard name
  await C.evaluate(() => localStorage.setItem('beta-blast.auth', JSON.stringify({ token: 'x'.repeat(43), name: 'Owain', provider: 'github' })));
  await inPage(C, `game.scene.getScene('Leaderboard').scene.start('Account');`);
  await sleep(900);
  await shot(C, 'account');
  await C.evaluate(() => localStorage.removeItem('beta-blast.auth'));

  // 9. the Umbraco theme: pick it on the Customise screen, then look at the menu and a wall
  await inPage(C, `game.scene.getScene('Account').scene.start('Customise');`);
  await sleep(600);
  await C.mouse.click(270, 612); // the Theme button
  await sleep(600);
  await shot(C, 'theme-customise');
  await inPage(C, `game.scene.getScene('Customise').scene.start('Menu');`);
  await sleep(1200);
  await shot(C, 'theme-menu');
  await startGame(C, `m.levels.gradeLevel(5)`);
  await sleep(800);
  await shot(C, 'theme-game');
  await inPage(C, `game.scene.getScene('Game').scene.start('Menu');`);
  await sleep(800);
  const tinyT = await inPage(
    C,
    `const l = m.routes.emptyLayout(); l[0][0] = 1; l[0][1] = 1; l[0][9] = 6;
     const route = { layout: l, shotsPerDrop: 6, bombs: false, wilds: false, timer: 0 };
     const code = m.routes.encodeRoute(route); return JSON.stringify(m.routes.routeLevel(route, code));`,
  );
  await startGame(C, tinyT);
  await inPage(C, `const s = game.scene.getScene('Game'); s.aim = Math.atan2(150 - 270, 640 - 30);`);
  await C.keyboard.press('Space');
  await sleep(3200);
  await shot(C, 'theme-sent');

  // 10. Arcade: a real run that ends, then the initials screen, typed with the keyboard, then the weekly table
  await inPage(C, `game.scene.getScene('Game').scene.start('Menu');`);
  await sleep(800);
  await startGame(C, `m.arcade.arcadeLevel(99)`);
  await inPage(C, `const s = game.scene.getScene('Game'); s.engine.score = 6701; s.endGame(false);`);
  await sleep(2200); // the fall, then the table is fetched and the initials screen opens
  if (!(await C.evaluate(() => window.__game.scene.isActive('Initials')))) throw new Error('Arcade game over did not open the initials screen');
  await shot(C, 'arcade-initials');
  await C.keyboard.press('ArrowUp'); // A -> B
  await C.keyboard.press('Enter');
  await C.keyboard.type('x'); // typing sets and moves on
  await C.keyboard.press('ArrowDown'); // third box starts on A (or last used) -> wraps down to 9
  await sleep(200);
  await shot(C, 'arcade-initials-typed');
  await C.keyboard.press('Enter'); // save
  await sleep(1200);
  if (!(await C.evaluate(() => window.__game.scene.isActive('Leaderboard')))) throw new Error('Saving initials did not open the table');
  console.log('posted', JSON.stringify({ initials: arcadePosts[0]?.initials, score: arcadePosts[0]?.score, seconds: arcadePosts[0]?.seconds, hasSeed: arcadePosts[0]?.replay?.seed === 99 }));
  await shot(C, 'arcade-leaderboard');
} finally {
  await browser.close();
  server.kill();
}
