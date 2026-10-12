/** The leaderboard API (a Cloudflare Worker, see worker/). Set VITE_API_URL to point somewhere else; empty turns the leaderboard off. */
export const DEFAULT_API_URL: string = import.meta.env.VITE_API_URL ?? 'https://beta-blast-api.owaingdwilliams.workers.dev';
