import { getThemeId } from './storage';

/** How the game looks. A theme only changes colours and artwork: it never changes how the game plays. */
export interface Theme {
  id: string;
  name: string;
  /** The five route colours, in hold order (each colour is also its own hold shape). */
  holds: number[];
  wall: { bg: number; panel: number; seam: number; hole: number; pad: number; padEdge: number; padLine: number };
  /** Menu title colour (a CSS colour) and the grade button colours. */
  title: string;
  grade: number;
  gradeSent: number;
  /** A logo file under public/, drawn in white and tinted with `tint`. Optional. */
  logo?: { key: string; file: string; tint: number };
}

export const THEMES: Theme[] = [
  {
    id: 'classic',
    name: 'Classic',
    holds: [0xe5484d, 0x3e8ef7, 0x30c46b, 0xf5c518, 0xa05cf0],
    wall: { bg: 0x1d2230, panel: 0x262c3d, seam: 0x151925, hole: 0x161a26, pad: 0x3a4160, padEdge: 0x4b5480, padLine: 0x2c3250 },
    title: '#ffd166',
    grade: 0x2f6fdd,
    gradeSent: 0x2e8b57,
  },
  {
    id: 'umbraco',
    name: 'Umbraco',
    // Umbraco blue and pink, with warm and cool partners so the five stay easy to tell apart.
    holds: [0x5b6cf0, 0xf5a3b8, 0x2fc4b2, 0xf7c948, 0xff7a59],
    wall: { bg: 0x131a3a, panel: 0x1b2552, seam: 0x0e1430, hole: 0x0e1430, pad: 0x2a3585, padEdge: 0x3544b1, padLine: 0x1f2a6b },
    title: '#f5c1bc',
    grade: 0x3544b1,
    gradeSent: 0x2fa89a,
    logo: { key: 'logo-umbraco', file: 'themes/umbraco-logo.svg', tint: 0xf5c1bc },
  },
];

export const themeById = (id: string): Theme => THEMES.find((t) => t.id === id) ?? THEMES[0];
export const currentTheme = (): Theme => themeById(getThemeId());
export const nextTheme = (id: string): Theme => THEMES[(THEMES.findIndex((t) => t.id === id) + 1) % THEMES.length];
