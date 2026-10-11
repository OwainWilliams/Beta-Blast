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

- **Aim**: move the mouse or drag a finger. Arrow keys / A / D also work.
- **Shoot**: release the click or tap, or press Space.
- **Swap**: tap NEXT, or press S.
- **Mute**: M. Restart: R. Menu: Esc.

Each colour of hold (jug, crimp, sloper, pinch, pocket) also has its own shape, so the game is playable without relying on colour. From V2 a white **chalk bomb** appears: it clears itself and every hold touching it.

**Pump**: each shot that pops nothing fills a pip. When the pips fill, the wall drops a row. Reach the red line and you fall.

**Scoring**: pops, drops (cut-off holds), bank shots (bonus per wall bounce), a route bonus per grade, and **FLASH** (+500) for sending without being pumped.

**Modes**: V0 to V10 grades with increasing difficulty, and a **Daily Boulder** that is the same seeded route for everyone each day. Best scores and sends are saved in local storage.

## Project layout

```
src/game/grid.ts     hex grid, matching, floating holds (pure, tested)
src/game/levels.ts   grades, seeded RNG, daily route
src/game/audio.ts    synthesised sound effects
src/scenes/          Boot (draws textures), Menu, Game
tests/grid.test.ts   vitest
```

## Ideas for later

Hold-type special effects (slippery slopers, two-hit volumes), a route-setter level editor with share codes, a leaderboard for the daily route, versus mode, music.
