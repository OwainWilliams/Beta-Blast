// What each way to play does, in words, for the "How to play" screens. Plain data, so the text is easy to change.
export type ModeId = 'grades' | 'daily' | 'survival' | 'arcade' | 'versus';

export interface ModeInfo {
  id: ModeId;
  title: string;
  tagline: string;
  colour: number; // the menu button's colour
  lines: string[];
  /** What the screen's main button says. */
  go: string;
}

export const CONTROLS = 'Aim: mouse or finger   ·   Shoot: release or Space   ·   Swap: NEXT or S';

export const MODES: ModeInfo[] = [
  {
    id: 'grades',
    title: 'GRADES',
    tagline: 'Clear the whole wall to send the route.',
    colour: 0x2f6fdd,
    go: 'Pick a grade',
    lines: [
      'Shoot holds at the wall. Match 3 or more of the same colour to pop them. Anything left hanging falls too.',
      'A shot that pops nothing fills a PUMP pip. When they are full the wall drops a row. Reach the red line and you fall.',
      'A gauge down the right fills with time and drops a row as well, so keep moving.',
      'Send it quickly for a speed bonus, and with no pumps for a FLASH (+500).',
      'Grades never run out. Each is harder, with new holds: chalk bombs, mega jugs, volumes and slicks.',
    ],
  },
  {
    id: 'daily',
    title: 'DAILY BOULDER',
    tagline: 'One route a day, the same for everyone.',
    colour: 0xd9622b,
    go: 'Play today',
    lines: [
      'A new wall every day, and everyone gets the same one. It is a grade between V3 and V7.',
      'The rules are the Grades rules: clear the wall, send it fast, and try for a FLASH.',
      'Play as often as you like. Your best score today goes on the Daily leaderboard.',
      'Come back tomorrow for a new route.',
    ],
  },
  {
    id: 'survival',
    title: 'SURVIVAL',
    tagline: 'No finish line. Last as long as you can.',
    colour: 0xc23b5a,
    go: 'Play Survival',
    lines: [
      'The wall keeps coming on a timer, and it speeds up every stage (a stage lasts 40 seconds).',
      'New colours and obstacles join as the stages go by. Each new stage pays +250.',
      'Clear every colour for a clean sweep: +500, and fresh rows arrive at once.',
      'The run ends when the wall reaches the red line. Your best score and longest run are saved, and can go on the Survival leaderboard.',
    ],
  },
  {
    id: 'arcade',
    title: 'ARCADE',
    tagline: 'Survival, with your initials on a weekly table.',
    colour: 0xb8860b,
    go: 'Play Arcade',
    lines: [
      'It plays exactly like Survival.',
      "If your score makes this week's top 10, you enter three initials: ▲ ▼ change the letter and Return moves on.",
      'The table clears every Monday at 00:00 UTC, so everyone gets a fresh start each week.',
      'Initials belong to nobody, and Arcade scores do not count towards the Overall ranking.',
    ],
  },
  {
    id: 'versus',
    title: '2 PLAYER',
    tagline: 'Race a friend over the internet.',
    colour: 0x2e8b57,
    go: 'Host or join',
    lines: [
      'One player hosts and shares a keyword (or a link). The other joins with it.',
      'You both get the same wall and the same holds, so the better player wins.',
      'Every pop sends your opponent a row. Rows sent to you wait, and land together when you miss. Popping first cancels them.',
      'Clear every colour to send 4 rows and get a fresh wall. Reach the red line and you lose.',
    ],
  },
];

export const modeInfo = (id: ModeId): ModeInfo => MODES.find((m) => m.id === id) ?? MODES[0];
