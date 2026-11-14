-- Times are Unix epoch milliseconds stored as double precision.
-- Resources are double precision so fractional production accrues exactly.

CREATE TABLE users (
  id            bigserial PRIMARY KEY,
  username      text NOT NULL,
  username_key  text NOT NULL UNIQUE,              -- lower-cased username for uniqueness
  pass_hash     text NOT NULL,
  created_at    double precision NOT NULL,
  tech          jsonb NOT NULL DEFAULT '{}'::jsonb,  -- research levels by id
  research      jsonb,                               -- {id, planetId, start, end, cost} or null
  points        double precision NOT NULL DEFAULT 0, -- 1 point per 1,000 resources invested
  dark_matter   double precision NOT NULL DEFAULT 0,
  last_seen     double precision NOT NULL DEFAULT 0
);

CREATE TABLE sessions (
  token_hash  text PRIMARY KEY,
  user_id     bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  double precision NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);

CREATE TABLE planets (
  id           bigserial PRIMARY KEY,
  user_id      bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  galaxy       int NOT NULL,
  system       int NOT NULL,
  position     int NOT NULL,
  is_moon      boolean NOT NULL DEFAULT false,
  is_home      boolean NOT NULL DEFAULT false,
  name         text NOT NULL,
  fields       int NOT NULL,
  temp         int NOT NULL,                        -- maximum temperature, °C
  diameter     int NOT NULL DEFAULT 0,
  metal        double precision NOT NULL DEFAULT 0,
  crystal      double precision NOT NULL DEFAULT 0,
  deut         double precision NOT NULL DEFAULT 0,
  res_at       double precision NOT NULL,           -- time resources were last synced
  buildings    jsonb NOT NULL DEFAULT '{}'::jsonb,
  units        jsonb NOT NULL DEFAULT '{}'::jsonb,  -- ships, defence and missiles stationed here
  prod_pct     jsonb NOT NULL DEFAULT '{}'::jsonb,  -- production setting per producer, 0..100
  build_queue  jsonb,                               -- {id, start, end, cost} or null
  yard_queue   jsonb NOT NULL DEFAULT '[]'::jsonb,  -- [{id, n, each}]
  yard_end     double precision NOT NULL DEFAULT 0, -- time the next shipyard unit completes
  jg_ready     double precision NOT NULL DEFAULT 0,
  created_at   double precision NOT NULL,
  UNIQUE (galaxy, system, position, is_moon)
);
CREATE INDEX planets_user ON planets(user_id);

CREATE TABLE fleets (
  id             bigserial PRIMARY KEY,
  user_id        bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  src_planet_id  bigint REFERENCES planets(id) ON DELETE SET NULL,
  origin         jsonb NOT NULL,   -- {g, s, p, moon}
  target         jsonb NOT NULL,   -- {g, s, p, moon}
  target_user_id bigint REFERENCES users(id) ON DELETE SET NULL,
  mission        text NOT NULL,
  ships          jsonb NOT NULL,
  cargo          jsonb NOT NULL DEFAULT '[0,0,0]'::jsonb,
  phase          text NOT NULL,    -- out | hold | back
  start_at       double precision NOT NULL,
  end_at         double precision NOT NULL,
  dur            double precision NOT NULL   -- one-way flight time
);
CREATE INDEX fleets_user ON fleets(user_id);
CREATE INDEX fleets_target_user ON fleets(target_user_id);

CREATE TABLE debris (
  galaxy   int NOT NULL,
  system   int NOT NULL,
  position int NOT NULL,
  metal    double precision NOT NULL DEFAULT 0,
  crystal  double precision NOT NULL DEFAULT 0,
  PRIMARY KEY (galaxy, system, position)
);

CREATE TABLE messages (
  id       bigserial PRIMARY KEY,
  user_id  bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  at       double precision NOT NULL,
  kind     text NOT NULL,          -- sys | combat | spy
  title    text NOT NULL,
  body     text NOT NULL,          -- plain text, lines separated by \n
  read     boolean NOT NULL DEFAULT false
);
CREATE INDEX messages_user_at ON messages(user_id, at DESC);

-- Everything scheduled: building/research/shipyard completions and fleet arrivals.
CREATE TABLE events (
  id      bigserial PRIMARY KEY,
  due_at  double precision NOT NULL,
  kind    text NOT NULL,           -- build | yard | research | fleet
  ref_id  bigint NOT NULL          -- planet id, user id or fleet id
);
CREATE INDEX events_due ON events(due_at, id);
CREATE UNIQUE INDEX events_unique ON events(kind, ref_id);
