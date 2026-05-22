-- Phase 1 social-feed schema diff. Apply once with:
--   psql "$DATABASE_URL" -f scripts/social-feed-schema.sql
--
-- Idempotent: safe to re-run. After applying, `drizzle-kit push` should
-- report "no changes detected" once the corepack/pnpm wrapper issue is
-- sorted out.

-- pg_trgm for fuzzy user search
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Task 1: users — privacy flags
ALTER TABLE users ADD COLUMN IF NOT EXISTS discoverable_by_phone boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_visibility text NOT NULL DEFAULT 'public';

-- Task 2: trips — kind discriminator + per-user uniqueness for personal trips
ALTER TABLE trips ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'event';
CREATE UNIQUE INDEX IF NOT EXISTS trips_personal_per_user
  ON trips(created_by_user_id) WHERE kind = 'personal';

-- Task 3: rounds — visibility + completion marker
ALTER TABLE rounds ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'public';
ALTER TABLE rounds ADD COLUMN IF NOT EXISTS completed_at timestamptz;

-- Task 4: user_follows
CREATE TABLE IF NOT EXISTS user_follows (
  follower_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  followed_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (follower_id, followed_id)
);
CREATE INDEX IF NOT EXISTS user_follows_followed_idx ON user_follows(followed_id);

-- Task 5: round_kudos
CREATE TABLE IF NOT EXISTS round_kudos (
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  round_id integer NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, round_id)
);
CREATE INDEX IF NOT EXISTS round_kudos_round_idx ON round_kudos(round_id);

-- Task 6: round_comments (self-referential, one-level reply threading)
CREATE TABLE IF NOT EXISTS round_comments (
  id serial PRIMARY KEY,
  round_id integer NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  parent_comment_id integer REFERENCES round_comments(id) ON DELETE CASCADE,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS round_comments_round_created_idx ON round_comments(round_id, created_at);
CREATE INDEX IF NOT EXISTS round_comments_parent_idx ON round_comments(parent_comment_id);

-- Task 7: trigram GIN index for fuzzy user search.
-- Drop and recreate to ensure the gin_trgm_ops operator class is set
-- (drizzle-kit may have created an index without it during a prior push).
DROP INDEX IF EXISTS users_full_name_trgm_idx;
CREATE INDEX users_full_name_trgm_idx ON users USING gin (full_name gin_trgm_ops);
