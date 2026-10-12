# I asked Claude for a Puzzle Bobble clone. It built a climbing game with a global leaderboard.

**Beta Blast**: shoot coloured climbing holds at a wall, pop three or more, send the route. Playable in your browser right now, free, no install.

![Beta Blast gameplay](https://raw.githubusercontent.com/OwainWilliams/Beta-Blast/main/docs/screenshots/gameplay.png)

It started with one question: *"What's a good tech stack to make a replica of Puzzle Bobble?"*

A few hours of chatting later I had a finished, deployed game. I wrote none of the code.

## What's in it

- 🧗 **Endless grades.** V0, V1, V2 and on, getting harder with no ceiling
- 📅 **Daily Boulder.** One route a day, the same for everyone
- ⏱️ **Survival.** The wall keeps dropping, the music speeds up, and the stages ramp up
- 🛠️ **Route Setter.** Build your own wall and share it as a link
- 👥 **2-player over the internet.** Pop holds to send rows to your opponent
- 🏆 **A global leaderboard**, with a climber icon next to every score
- 🧢 **Customisable climber.** Beanie, shirt and chalk bag colours unlock as you play
- 🔌 **A public API and a one-line embed**, so any website can show the leaderboard

![The leaderboard](https://raw.githubusercontent.com/OwainWilliams/Beta-Blast/main/docs/screenshots/leaderboard.png)

## The stack

| | |
|---|---|
| Game | TypeScript, [Phaser 3](https://phaser.io), Vite |
| Art and sound | Drawn and synthesised in code. **There are no image or audio files.** |
| 2-player | PeerJS (WebRTC), so no game server |
| Leaderboard | Cloudflare Workers + D1 (SQLite), on the free plan |
| Hosting | GitHub Pages and a custom domain, deployed by GitHub Actions |
| Quality | 236 tests, a bot that plays every grade to check the difficulty, and CI on every pull request |

## Why it was fun

**I made the creative calls, Claude did the typing.** I picked the theme (climbers shooting holds), the name, and which feature came next. Claude proposed options, built them, and opened the pull requests. I mostly said "yes, do that."

**It checked its own work.** It ran the game in a headless browser, looked at its own screenshots and fixed what looked wrong. When I asked for a full review it found real bugs, such as a network blip that ended live matches, and fixed them.

**It handled the boring, essential parts.** Tests, CI, deploys, the Cloudflare setup, the README and the screenshots in it.

**Anti-cheat was a good problem.** Scores come from the browser, so anyone can fake one. The game now records every shot and can replay a run on the server through the same engine to check the score. It's off on the free plan, because a replay costs more CPU than the free tier allows. Claude measured that, told me, and let me pick. That kind of trade-off is what I'd want from a human colleague too.

## The honest bits

- It wasn't one prompt. It was a long conversation, with me playing the game and steering.
- Things broke along the way: a deploy that needed Pages switched on, a leaderboard that looked empty because it opened on the wrong board. We fixed each one.
- Claude can't tap a real phone screen or feel whether a shot is satisfying. That part is still me.

## Try it

🎮 **Play:** https://thesecretstage.vip/Beta-Blast/
💻 **Code:** https://github.com/OwainWilliams/Beta-Blast

Add the leaderboard to your own site with one line:

```html
<script src="https://thesecretstage.vip/Beta-Blast/embed.js" data-board="daily" async></script>
```

If you've been sitting on a "wouldn't it be cool if" project, this is your sign. Open a conversation, describe it, and see how far an afternoon goes.
