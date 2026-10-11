import { R, H } from './game/grid';

export const WIDTH = 540;
export const HEIGHT = 720;
export const GRID_X = 30;
export const LOSE_ROW = 12;
export const LAUNCH_X = GRID_X + 240;
export const LAUNCH_Y = 640;
export const LOSE_Y = R + LOSE_ROW * H;

// Tape colours, like a gym's colour-coded routes.
export const HOLD_COLOURS = [0xe5484d, 0x3e8ef7, 0x30c46b, 0xf5c518, 0xa05cf0];
export const HOLD_NAMES = ['Jug', 'Crimp', 'Sloper', 'Pinch', 'Pocket'];
