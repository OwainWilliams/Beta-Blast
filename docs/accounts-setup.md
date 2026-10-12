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

In the Cloudflare dashboard: **Workers & Pages → beta-blast-api → Settings → Variables and Secrets → Add.** Add these four, each with the type **Secret** (not "Text"), because a plain variable is overwritten the next time the Worker is deployed:

| Name | Value |
|---|---|
| `GH_CLIENT_ID` | GitHub's Client ID |
| `GH_CLIENT_SECRET` | GitHub's Client secret |
| `GOOGLE_CLIENT_ID` | Google's Client ID |
| `GOOGLE_CLIENT_SECRET` | Google's Client secret |

Save and deploy. Nothing needs redeploying from GitHub. Never paste these into a chat, an issue or the repo.

## 4. Check it

- Open `https://beta-blast-api.owaingdwilliams.workers.dev/auth/providers`. It should list `["github","google"]` (or whichever you set up).
- Open the game, tap **Sign in**, and sign in. You should come back to the game with the button showing your name or "Account".

## If something goes wrong

| What you see | Likely cause |
|---|---|
| "Sign-in isn't available right now" | The secrets are missing or named wrongly, or the Worker can't be reached. Check `/auth/providers`. |
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
- A leaderboard name is first come, first served. If someone has been posting as a name as a guest, the first account to claim it gets it. Claim yours early.

## Where the accounts code is

- `worker/src/auth.ts` and `worker/src/account-routes.ts`: the sign-in flow, sessions, names and cloud save.
- `src/game/account.ts` and `src/scenes/AccountScene.ts`: the game's side.
- `src/game/saveMerge.ts`: how two saves are combined (shared by the game and the Worker).
