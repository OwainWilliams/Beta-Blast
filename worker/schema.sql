-- Safe to run on every deploy.
CREATE TABLE IF NOT EXISTS scores (
  board TEXT NOT NULL,                  -- "v3", "daily-2026-10-12", "survival"
  name TEXT NOT NULL COLLATE NOCASE,
  score INTEGER NOT NULL,
  seconds INTEGER NOT NULL DEFAULT 0,   -- survival: how long the run lasted
  created_at INTEGER NOT NULL,
  PRIMARY KEY (board, name)
);
CREATE INDEX IF NOT EXISTS scores_by_board ON scores (board, score DESC);

-- Posts per IP per minute, to slow down spam.
CREATE TABLE IF NOT EXISTS hits (
  ip TEXT NOT NULL,
  minute INTEGER NOT NULL,
  n INTEGER NOT NULL,
  PRIMARY KEY (ip, minute)
);

-- What each player's climber looks like (a look code, see src/game/looks.ts). One row per name, updated
-- on every post, so their icon is the same on every board.
CREATE TABLE IF NOT EXISTS players (
  name TEXT NOT NULL COLLATE NOCASE PRIMARY KEY,
  look TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Accounts (sign in with GitHub or Google). We keep only the provider's id for the person, never an email.
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  name TEXT COLLATE NOCASE UNIQUE,      -- the leaderboard name they chose; null until they do
  created_at INTEGER NOT NULL,
  UNIQUE (provider, provider_id)
);
-- Logged-in devices. Only a hash of the token is stored.
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_by_user ON sessions (user_id);
-- A sign-in in progress (one use, ten minutes), and the one-time code that hands the result to the game.
CREATE TABLE IF NOT EXISTS oauth_states (
  state TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  return_to TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS login_codes (
  code_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
-- The cloud copy of a player's save (best scores, grades sent, outfit).
CREATE TABLE IF NOT EXISTS saves (
  user_id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
