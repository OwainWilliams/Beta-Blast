import { LAUNCH_LX, LAUNCH_LY } from './game/engine';
import { currentTheme } from './game/themes';
import { H, LOSE_ROW, R } from './game/grid';

export const WIDTH = 540;
export const HEIGHT = 720;
export const GRID_X = 30;
export { LOSE_ROW };
export const LAUNCH_X = GRID_X + LAUNCH_LX; // the engine works in grid coordinates; the screen adds the margin
export const LAUNCH_Y = LAUNCH_LY;
export const LOSE_Y = R + LOSE_ROW * H;

// Tape colours, like a gym's colour-coded routes. They come from the current theme.
export const holdColours = (): number[] => currentTheme().holds;

export { DEFAULT_API_URL as API_URL } from './apiUrl';

/** Where players report problems. */
export const ISSUES_URL = 'https://github.com/OwainWilliams/Beta-Blast/issues/new';
