# Crimp & Pop

A bouldering-themed bubble shooter. Fire holds at the wall, match three or more of the same hold to pop them, and cut off the rest so they fall. Clear the whole wall to **send** the route.

Built with TypeScript, [Phaser 3](https://phaser.io) and Vite. All art and sound is generated in code, so there are no asset files.

## Run it

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # grid logic tests
npm run build    # production build in dist/
```

## How to play

- **Aim**: move the mouse or drag a finger. Arrow keys / A / D also work. The chalk bag leans toward your aim and a ghost hold shows where your shot will land.
- **Shoot**: release the click or tap, or press Space.
- **Swap**: tap NEXT, or press S.
- **Pause**: P or Esc (or the button top right). **Mute**: M. **Restart**: R.

Each colour of hold (jug, crimp, sloper, pinch, pocket) also has its own shape, so the game is playable without relying on colour.

**Pump**: each shot that pops nothing fills a pip. When the pips fill, the wall drops a row. Reach the red line and you fall.

**Combo**: pop on back-to-back shots to build a multiplier (up to x2).

**Special holds**
| Hold | Behaviour |
|---|---|
| Chalk bomb (V2+, a white ball you shoot) | Clears itself and every hold touching it, obstacles included |
| Mega jug (V1+, a rainbow ball you shoot) | A wildcard: it turns into whichever colour pops the most where it lands. The ghost preview shows the colour it will become |
| Volume (grey block, V4+) | Takes two pops next to it to break. Can't be matched |
| Slick (teal, V7+) | A shot that lands beside one slides down and away |

You send a route when every coloured hold is gone. Any obstacles left tumble off.

**Scoring**: pops, drops (cut-off holds), bank shots (bonus per wall bounce), a route bonus per grade, and **FLASH** (+500) for sending without being pumped.

**Modes**: V0 to V10 grades, and a **Daily Boulder** that is the same seeded route for everyone each day. Best scores and sends are saved in local storage.

**Route Setter**: build your own route (10 rows, all hold types, pump limit, bombs and mega jugs on/off), test it, and share it as a link or code. Anyone opening `?route=CODE` plays it straight away, or use *Play a code* in the menu.

## Balance

`npm run balance` has a bot play every grade and prints win rates at two skill levels, so difficulty changes can be checked against numbers. The bot is greedy and never swaps, so it is a guide, not a replacement for playtesting. Tuning lives in `src/game/levels.ts`.

## Project layout

```
src/game/grid.ts     hex grid, matching, floating holds (pure, tested)
src/game/engine.ts   the rules: shots, scoring, combo, pump, special holds (pure, tested)
src/game/levels.ts   grades, seeded RNG, daily route
src/game/routes.ts   share codes for custom routes
src/game/audio.ts    synthesised sound effects
src/scenes/          Boot (draws textures), Menu, Game, Editor
tests/               vitest, plus an opt-in balance bot
```

## Ideas for later

Jug wildcard and crumbling holds, a leaderboard for the daily route (needs a small backend), versus mode, music, installable PWA.
