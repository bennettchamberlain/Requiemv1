-- migrate:up

-- Candidate activities: the "possible" layer of the schedule surface.
--
-- Deliberately NOT `ci.events` rows with status='proposed'. HBPE trains on
-- ci.events (the nightly Qwen pass labels it into L1 clusters, and the token
-- serializer reads it); admitting hypotheticals there would teach the model to
-- predict its own suggestions. Candidates live apart until a human accepts one,
-- at which point a real ci.events row is minted and linked via promoted_event_id.
--
-- Nothing here is ever auto-accepted. `status` only leaves 'open' through an
-- explicit user action.
CREATE TABLE ci.event_candidates (
    candidate_id        UUID PRIMARY KEY,
    user_id             UUID NOT NULL REFERENCES ci.users(id) ON DELETE CASCADE,

    title               TEXT NOT NULL,
    description         TEXT,

    -- Provenance. Nothing appears on the schedule without a because: `rationale`
    -- is the sentence shown to the user, `rationale_sources` the machine-readable
    -- refs behind it — [{kind: summary|insight|answer|item|relationship|due,
    -- id: uuid, note: text}] — so the UI can link back to what produced this.
    rationale           TEXT NOT NULL,
    rationale_sources   JSONB NOT NULL DEFAULT '[]',

    -- Fuzzy time. The candidate claims a *window* it could plausibly occupy plus
    -- an estimated duration; the fit solver resolves that against the forecast
    -- into a per-slot curve. time_flex records how loose the claim is, which is
    -- what lets the year view show only the genuinely long-horizon items.
    window_start        TIMESTAMPTZ NOT NULL,
    window_end          TIMESTAMPTZ NOT NULL,
    time_flex           TEXT NOT NULL DEFAULT 'week'
                        CHECK (time_flex IN ('exact', 'day', 'week', 'month', 'season')),
    duration_minutes    INTEGER CHECK (duration_minutes > 0),

    -- Solver inputs: {needs_people: uuid[], needs_place: text, needs_daylight: bool,
    -- l0_band: text, min_energy: int, not_before: '10:00', cadence_days: int, ...}
    constraints         JSONB NOT NULL DEFAULT '{}',

    l0_class            TEXT,
    l1_cluster_id       UUID,
    energy_cost         INTEGER CHECK (energy_cost BETWEEN 1 AND 10),

    -- Ranking. fit_score is the solver's best-slot score; fit_curve caches the
    -- per-slot values that render as the smear, so the grid does not re-solve on
    -- every paint. Both null until the P2 solver runs.
    fit_score           REAL CHECK (fit_score >= 0 AND fit_score <= 1),
    fit_curve           JSONB,

    status              TEXT NOT NULL DEFAULT 'open'
                        CHECK (status IN ('open', 'accepted', 'snoozed', 'declined', 'never')),
    -- Why it was declined, for the proposer to learn from: not_now | never |
    -- not_like_this | wrong_time. Null while open.
    feedback_reason     TEXT,
    feedback_at         TIMESTAMPTZ,
    snoozed_until       TIMESTAMPTZ,

    -- Set when accepted: the real event this became.
    promoted_event_id   UUID REFERENCES ci.events(event_id) ON DELETE SET NULL,

    -- Stable identity across regeneration runs, so a nightly re-proposal updates
    -- the existing row instead of resurrecting something the user declined.
    dedupe_key          TEXT NOT NULL,

    generator           TEXT,
    confidence          REAL CHECK (confidence >= 0 AND confidence <= 1),

    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT candidate_window_ordered CHECK (window_start < window_end),
    -- An accepted candidate must point at the event it became; an open one must not.
    CONSTRAINT candidate_promotion_consistent CHECK (
        (status = 'accepted' AND promoted_event_id IS NOT NULL)
        OR (status <> 'accepted' AND promoted_event_id IS NULL)
    )
);

-- One live candidate per idea per user. Declined/never rows keep their key so a
-- later run collides with them and is suppressed rather than re-proposing.
CREATE UNIQUE INDEX event_candidates_dedupe_uniq
    ON ci.event_candidates (user_id, dedupe_key);

-- The schedule read path: open candidates overlapping the viewed window.
CREATE INDEX event_candidates_window_idx
    ON ci.event_candidates (user_id, window_start, window_end)
    WHERE status IN ('open', 'snoozed');

CREATE INDEX event_candidates_rank_idx
    ON ci.event_candidates (user_id, fit_score DESC NULLS LAST)
    WHERE status = 'open';


-- Standing constraints the fit solver optimises against: "no meetings before
-- 10", "gym 3x/week", "Fridays are deep work". Seeded from ci.answers where
-- inferable, and directly editable by the user.
--
-- This is what keeps suggestions from becoming nagging: a rhythm is the user's
-- own stated shape of a week, not something inferred and imposed.
CREATE TABLE ci.rhythms (
    rhythm_id       UUID PRIMARY KEY,
    user_id         UUID NOT NULL REFERENCES ci.users(id) ON DELETE CASCADE,

    label           TEXT NOT NULL,
    -- window: a recurring time band to prefer or protect
    -- cadence: a target frequency ("3x/week")
    -- avoid:   a hard or soft exclusion
    kind            TEXT NOT NULL CHECK (kind IN ('window', 'cadence', 'avoid')),

    -- Shape depends on kind: window {dow: int[], start: '09:00', end: '17:00'},
    -- cadence {per: week|month, count: int, l1_cluster_id: uuid},
    -- avoid {dow: int[], before: '10:00', l0_class: text}
    spec            JSONB NOT NULL,

    -- Soft rhythms cost fit score when violated; hard ones veto the slot.
    strength        TEXT NOT NULL DEFAULT 'soft' CHECK (strength IN ('soft', 'hard')),

    -- Where it came from: 'declared' (user typed it) or 'answer' (inferred from
    -- ci.answers, and therefore worth confirming before treating as hard).
    source          TEXT NOT NULL DEFAULT 'declared' CHECK (source IN ('declared', 'answer')),
    source_answer_id UUID,

    active          BOOLEAN NOT NULL DEFAULT TRUE,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX rhythms_user_active_idx ON ci.rhythms (user_id) WHERE active;

-- migrate:down

DROP TABLE IF EXISTS ci.rhythms;
DROP TABLE IF EXISTS ci.event_candidates;
