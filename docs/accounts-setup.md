# Setting up sign-in (GitHub and Google)

Sign-in is off until you do this. Until then the game shows "Sign-in isn't available right now" and everyone plays as a guest. Nothing else changes. You can set up one provider or both.

You need the address of your Worker. These steps use `https://beta-blast-api.owaingdwilliams.workers.dev`. Replace it if yours differs.

## 1. GitHub

1. Go to **GitHub → Settings → Developer settings → OAuth Apps → New OAuth App**.
2. Fill in:
   - **Application name:** Beta Blast
   - **Homepage URL:** `https://thesecretstage.vip/Beta-Blast/`
   - **Authorization callback URL:** `https://beta-blast-api.owaingdwilliams.workers.dev/auth/github/callback`
3. Click **Register application**, then **Generate a new client secret**.
4. Keep the **Client ID** and the **Client secret** for step 3.

## 2. Google

1. Go to the [Google Cloud Console](https://console.cloud.google.com/) and create a project (or pick one).
2. **APIs & Services → OAuth consent screen:** choose **External**, set the app name (Beta Blast) and your support email, and save. The only permission the game asks for is basic sign-in (`openid`), which needs no Google review. Under **Publishing status**, choose **In production** so anyone can sign in, not only test users.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID:**
   - **Application type:** Web application
   - **Authorized redirect URIs:** `https://beta-blast-api.owaingdwilliams.workers.dev/auth/google/callback`
4. Keep the **Client ID** and the **Client secret** for step 3.

## 3. Give the Worker the secrets

**The easy way (recommended): add them to GitHub.** Go to your repository on GitHub: **Settings → Secrets and variables → Actions → New repository secret** (on the **Secrets** tab, next to your Cloudflare ones). Add the ones for the providers you set up:

| Secret name | Value |
|---|---|
| `OAUTH_GITHUB_CLIENT_ID` | GitHub's Client ID |
| `OAUTH_GITHUB_CLIENT_SECRET` | GitHub's Client secret |
| `OAUTH_GOOGLE_CLIENT_ID` | Google's Client ID |
| `OAUTH_GOOGLE_CLIENT_SECRET` | Google's Client secret |

(GitHub doesn't allow names that start with `GITHUB_`, which is why they begin `OAUTH_`.) Then go to **Actions → Deploy leaderboard API → Run workflow**. The deploy gives the Worker the secrets it finds, and a provider is only switched on when both its id and its secret are present. The deploy log's "Work out which sign-in secrets to send" step says exactly what was sent (names only, never values). Use **Run workflow** again after changing a secret.

**The other way: the Cloudflare dashboard.** Under **Workers & Pages → beta-blast-api → Settings → Variables and Secrets**, add `GH_CLIENT_ID`, `GH_CLIENT_SECRET`, `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, each with the type **Secret**, and click **Deploy**. Don't use both ways for the same provider.

Never paste any of these into a chat, an issue or the repo.

## 4. Check it

- Open `https://beta-blast-api.owaingdwilliams.workers.dev/auth/providers` (in a private window, as it's cached for a minute). It should list `["github","google"]` (or whichever you set up).
- Open the game, tap **Sign in**, and sign in. You should come back to the game with the button showing your name or "Account".

## If something goes wrong

| What you see | Likely cause |
|---|---|
| "Sign-in isn't available right now" | The secrets are missing, named wrongly, or were added but not deployed. Open `/auth/providers` (step 4): an empty `[]` means the Worker can't see a complete pair. If you used GitHub secrets: check the four names are exactly as in step 3, that you ran **Deploy leaderboard API** afterwards, and read the deploy log's "Work out which sign-in secrets to send" step. If you used the dashboard: check the names are exactly `GH_CLIENT_ID` and `GH_CLIENT_SECRET`, that you clicked **Deploy**, and that you added them to the **beta-blast-api Worker** and not to a Pages project. Then reload the game. |
| Back in the game with "Couldn't sign in" | The Client secret is wrong or has been regenerated. Paste the current one again. |
| GitHub shows an error page instead of asking you to authorise | The callback address on GitHub's side doesn't match the Worker's address exactly. |
| The provider says "redirect_uri mismatch" | The callback address in the provider's settings doesn't exactly match the Worker's address. |
| Google says the app isn't verified or you're not a test user | The consent screen is still in **Testing**. Switch it to **In production**. |
| "This sign-in has expired" | The sign-in took over ten minutes, or the page was reloaded part-way. Try again. |

## What is stored

Only the provider's own id for the person, the leaderboard name they chose, and a cloud copy of their save (best scores, grades sent, outfit). Never an email address or the name on their GitHub or Google account. Players can delete their account from the Account screen. That removes their scores and cloud save and frees their name.

## How sign-in is kept safe

- The game and the API are on different sites, so there are no cookies. The Worker sends the browser back to the game with a **one-time code** (valid for two minutes) in the address after the `#`, and the game swaps it for a session token. Codes and tokens are stored only as hashes.
- Each sign-in is tied to the browser that started it. The game keeps a secret on the device and sends only its hash when it starts. Someone who starts a sign-in on their own account and sends the link to another person can't have it completed in that person's browser.
- The place a sign-in returns to must be one of your game's own sites (the list is `ALLOWED_ORIGINS` in `worker/src/index.ts`).
- Sessions last 30 days, can be ended by signing out, and stop working if the account is deleted.
- A leaderboard name is first come, first served. If someone has been posting as a name as a guest, the first account to claim it gets it. Claim yours early. A name can be changed later from the Account screen: the account's scores and outfit move to the new name, and if the new name already has a score on a board, the higher one is kept.

## Where the accounts code is

- `worker/src/auth.ts` and `worker/src/account-routes.ts`: the sign-in flow, sessions, names and cloud save.
- `src/game/account.ts` and `src/scenes/AccountScene.ts`: the game's side.
- `src/game/saveMerge.ts`: how two saves are combined (shared by the game and the Worker).
