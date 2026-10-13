# Admin area

A small page for removing fake or offensive names. It is a separate Worker (`admin/`) that sits behind **Cloudflare Access**, so only people you allow can open it. The game's public API has no admin routes at all.

## What you can do

- **Players**: search names. Rename (to a neutral "Climber 1234" or a name you type), remove a name's scores, remove and **ban** the name (nobody can post or choose it again), or delete the account that owns a name and **ban that login** (so it can't sign in again).
- **Arcade**: remove a single run (offensive initials).
- **Banned**: see the banned names and allow one again.
- **Log**: everything an admin did, who did it and when. Removing scores or an Arcade run can be **undone** from here (it also lifts the ban that came with it). Deleting an account cannot be undone.

Deleting an account on its own does not stop the person signing in again and picking a new name. Tick the ban if you mean it.

## Set it up (once)

1. **Deploy the Worker.** Run the *Deploy admin area* workflow (Actions tab, *Run workflow*). It works as soon as the repository secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` exist, as for the leaderboard API. Until step 4 it refuses every request.
2. **Turn on Cloudflare Zero Trust** (free for small teams) if you haven't: Cloudflare dashboard, *Zero Trust*. Pick a team name. This gives you a team domain like `myteam.cloudflareaccess.com`.
3. **Put Access in front of the Worker.** Dashboard, *Workers & Pages*, `beta-blast-admin`, *Settings*, *Domains & Routes*. On the `workers.dev` address choose **Enable Cloudflare Access**, then *Manage Cloudflare Access* to set the policy: **Allow** only your own email address (one-time PIN to your email works, or GitHub/Google login). Dashboard wording changes now and then; the idea is "an Access application for the Worker's address, allowing only me".
4. **Copy two values into the repository secrets** (Settings, Secrets and variables, Actions):
   - `ADMIN_ACCESS_TEAM_DOMAIN`: the team domain, such as `myteam.cloudflareaccess.com` (the team name on its own, or with `https://`, is fine too)
   - `ADMIN_ACCESS_AUD`: the application's **Audience (AUD) tag**, shown on the Access application's page in Zero Trust
5. **Run the workflow again** so the Worker gets them. Open `https://beta-blast-admin.<your-subdomain>.workers.dev` and sign in.

## If the page says "Not set up yet"

The message names the setting: `ACCESS_TEAM_DOMAIN` missing or not like `myteam.cloudflareaccess.com`, or `ACCESS_AUD` missing. Fix the repository secret, then run *Deploy admin area* again. Other errors after signing in: "Token is for another application" means the AUD tag belongs to a different Access application.

## Why it is safe

- Access signs a token onto every request. The Worker **checks that token itself** (signature, team, audience, expiry), so if Access were ever turned off or set up wrongly the Worker would refuse everyone rather than open up. It also won't fetch signing keys from any address except `*.cloudflareaccess.com`.
- Changes only work when they come from the admin page itself (same-origin, JSON), so another website can't make your logged-in browser delete things.
- Names are player-supplied text, so the page only ever shows them as plain text, and a strict content policy blocks any injected script.
- The audit log records the email Access saw.

## Good to know

- The Overall ranking is remembered for up to a minute inside the game's API (and the public API may also cache for 30 seconds on a custom domain), so a removal can take a minute or so to disappear from it. Other boards show a removal straight away.
- The game checks banned names when someone posts a score or chooses an account name, and when a banned account tries to sign in.
- Fixing a name by hand (without the page) is possible with `npx wrangler d1 execute DB --remote --command "..."` from `worker/`, but then nothing is logged.
