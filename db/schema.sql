-- Cinder Reach schema. Applied at server start; every statement is idempotent.

CREATE TABLE IF NOT EXISTS users (
  id          serial PRIMARY KEY,
  name        text NOT NULL,
  name_lower  text NOT NULL UNIQUE,
  pass_hash   text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash  text PRIMARY KEY,
  user_id     integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);

-- One universe per player. The whole game state (planets, fleets, research,
-- AI opponents, messages) is one JSONB document, read and written under a row lock.
CREATE TABLE IF NOT EXISTS universes (
  user_id     integer PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  state       jsonb NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
