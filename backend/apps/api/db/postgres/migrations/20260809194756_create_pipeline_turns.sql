-- migrate:up
-- =====================================================================
-- ci.pipeline_turns — WHOSE TURN IT IS, and WHAT TONIGHT HAS COST
-- =====================================================================
-- The control tick had no notion of fairness and no notion of a budget. It
-- read every user in `u.id` order behind a LIMIT, so on an appliance with more
-- users than that limit the tail was never examined at all, and the users it
-- did examine were serviced in a fixed order — user 2 waiting behind the whole
-- of user 1's archive, which on a real import (66,579 Google Fit records plus
-- GPX and location history) is weeks.
--
-- Two facts fix that, and they are the only two rows-worth of state the
-- scheduler has:
--
--   1. WHEN did this user last hold the enrichment window? — the rotation
--      pointer. Ordering candidates by it ascending, NULLS FIRST, is the whole
--      of the rotation: the least-recently-served user goes next, and a user
--      who joined this afternoon has no row at all, sorts first, and is served
--      tonight rather than after everybody ahead of them has drained.
--   2. HOW MUCH of tonight's budget has been spent? — summed over this table
--      for one night. The nightly budget is appliance-wide, but it is spent
--      SERVING USERS, so the per-user split is also the answer to "where did
--      last night go?", which is the only fairness evidence anybody can check.
--
-- ── Why a table, and not one of the four that already exist ────────────────
--
-- `ci.pipeline_runs` is the obvious candidate and it is wrong twice. Its
-- `started_at` looks like a rotation pointer, but a run is long-lived by
-- design — a first import keeps one active across many nights so that
-- `ci.pipeline_shards.cursor` survives — so `started_at` is stamped once and
-- then never moves again, which would pin the same user at the front of the
-- rotation forever. And a user who has never had a run has no row there, so
-- the late-joiner case (the one that must not starve) has nowhere to be
-- recorded.
--
-- `ci.pipeline_shards` is per-run and CASCADEs with it; scheduler state that
-- disappears when a run is finalized is not scheduler state.
--
-- ── Why the two facts share one table ──────────────────────────────────────
--
-- They are the same fact from two directions: a turn is what the budget is
-- spent on. Keeping `spent_ms` beside `last_served_at` means "how much did
-- this user get?" and "when did they last get it?" cannot disagree, and it
-- keeps the whole scheduler in one row per user — on this appliance, one row.
--
-- Deliberately NO foreign key to ci.users, for the reason the rest of the
-- control plane gives: a scheduler must degrade to "re-derive next tick"
-- rather than fail on a dangling reference. A deleted user leaves one small
-- row that nothing reads, because the tick only ever looks up users it has
-- already selected from ci.users.
CREATE TABLE IF NOT EXISTS ci.pipeline_turns (
    -- One row per user. No surrogate id: the identity of a turn record IS the
    -- user, so the upsert has an ON CONFLICT target for free.
    user_id         UUID PRIMARY KEY,

    -- THE ROTATION POINTER. Stamped by every tick that serves this user, so it
    -- is "when did we last spend on them", not "when did their run start".
    -- NULL means never served — which sorts FIRST, so a late-joining user is
    -- served before anybody gets a second turn.
    last_served_at  TIMESTAMPTZ,

    -- When the user's CURRENT turn began, or NULL when they do not hold the
    -- window. A turn outlives a tick (the tick is 5 minutes, a turn is tens of
    -- minutes) and must outlive a restart, or a deploy at 02:00 would hand the
    -- window to a different user mid-turn and neither would finish anything.
    turn_started_at TIMESTAMPTZ,

    -- The night `spent_ms` is accounted against: the LOCAL DATE of the moment
    -- the window opened, so a window crossing midnight is still one night.
    -- DATE, not a timestamp: it is a label, and comparing labels is how
    -- "tonight's spend" is summed without needing to know the window's bounds
    -- in SQL.
    night           DATE,

    -- Wall-clock milliseconds of `night`'s budget spent serving this user.
    -- Reset (not accumulated) when `night` changes, so the sum over a night is
    -- exactly that night's spend and no history has to be reaped.
    spent_ms        BIGINT NOT NULL DEFAULT 0 CHECK (spent_ms >= 0),

    -- Lifetime turns held. Nothing schedules on it; it is the number that
    -- answers "is the rotation actually rotating?" without reading logs.
    turns           BIGINT NOT NULL DEFAULT 0 CHECK (turns >= 0),

    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE ci.pipeline_turns IS
  'Whose turn it is in the nightly enrichment window, and what tonight has cost per user. One row per user; the rotation pointer is last_served_at ascending, NULLS FIRST.';
COMMENT ON COLUMN ci.pipeline_turns.last_served_at IS
  'The rotation pointer: when a tick last dispatched enrichment for this user. NULL = never served, which sorts first so a late-joining user is not starved.';
COMMENT ON COLUMN ci.pipeline_turns.turn_started_at IS
  'When the current turn began, or NULL when this user does not hold the window. Durable so a restart mid-turn resumes the same turn instead of reshuffling the rotation.';
COMMENT ON COLUMN ci.pipeline_turns.night IS
  'Local date of the moment tonight''s window opened. The label spent_ms is accounted against, so a window crossing midnight is still one night.';
COMMENT ON COLUMN ci.pipeline_turns.spent_ms IS
  'Wall-clock ms of this night''s enrichment budget spent serving this user. Reset when night changes; the appliance-wide spend is the sum over one night.';

-- The rotation order itself. One row per user makes this index cosmetic on this
-- appliance and load-bearing on a shared one: the tick's user query orders by
-- this column and takes the first N, so the index is what keeps "who is next?"
-- from being a sort of the whole user table every five minutes.
CREATE INDEX IF NOT EXISTS pipeline_turns_rotation_idx
    ON ci.pipeline_turns (last_served_at NULLS FIRST);

-- "What has tonight cost?" — one aggregate, one night.
CREATE INDEX IF NOT EXISTS pipeline_turns_night_idx
    ON ci.pipeline_turns (night);

-- migrate:down
DROP INDEX IF EXISTS ci.pipeline_turns_night_idx;
DROP INDEX IF EXISTS ci.pipeline_turns_rotation_idx;
DROP TABLE IF EXISTS ci.pipeline_turns;
