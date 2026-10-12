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
