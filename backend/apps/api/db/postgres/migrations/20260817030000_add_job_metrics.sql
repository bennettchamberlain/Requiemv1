-- migrate:up

-- ═══════════════════════════════════════════════════════════════════════════
-- Job history.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- pg-boss keeps no history. Its own tables are a working set: `pgboss.job` is
-- drained into `pgboss.archive` twelve hours after a job reaches a terminal
-- state, and the archive is deleted twenty-four hours after that. So the total
-- observable past is roughly thirty-six hours, and even inside that window a
-- count is a point-in-time gauge with nothing to compare it against.
--
-- That makes the only questions an operator actually asks unanswerable. Is the
-- backlog growing or draining? Did the failure rate change when the model
-- changed? Has this queue moved at all since last night? Every one of those is
-- a question about a SHAPE over time, and the shape was being thrown away.
--
-- One narrow table, sampled on a cron, fixes it. Deliberately not a new
-- service: the same reasoning that put the queue in Postgres in the first place
-- applies to the queue's own telemetry.
CREATE TABLE IF NOT EXISTS ci.job_metrics (
    sampled_at      timestamptz NOT NULL,
    queue           text        NOT NULL,

    -- GAUGES: how deep the queue is at this instant. These are what the depth
    -- line chart plots, and the only thing that answers "is it draining?".
    pending         integer     NOT NULL DEFAULT 0,
    active          integer     NOT NULL DEFAULT 0,
    retry           integer     NOT NULL DEFAULT 0,
    dead_lettered   integer     NOT NULL DEFAULT 0,

    -- DELTAS over the sampling interval, not lifetime totals. A cumulative
    -- counter cannot be reconstructed from pg-boss, because the rows it would
    -- count are deleted out from under it -- so the collector counts what
    -- reached a terminal state since the previous sample instead. These are the
    -- throughput bars.
    completed       integer     NOT NULL DEFAULT 0,
    failed          integer     NOT NULL DEFAULT 0,

    -- Wall-clock time from `started_on` to `completed_on`, over the same
    -- interval. Averages hide the tail that actually hurts, so p95 travels
    -- alongside the mean.
    avg_duration_ms integer,
    p95_duration_ms integer,

    PRIMARY KEY (sampled_at, queue)
);

COMMENT ON TABLE ci.job_metrics IS
  'Per-queue job telemetry sampled on a cron. Exists because pg-boss keeps roughly 36 hours of working set and no history at all; this is the only record of how a queue behaved yesterday.';

COMMENT ON COLUMN ci.job_metrics.pending IS
  'Gauge: jobs in state `created` at sample time, EXCLUDING the dead-letter queue (whose rows are also `created`).';

COMMENT ON COLUMN ci.job_metrics.completed IS
  'Delta: jobs that reached `completed` during the interval ending at sampled_at. Not cumulative -- pg-boss deletes the rows a running total would need.';

-- The charts always ask for a trailing window ordered by time, and the purge
-- deletes by age. Both are this index.
CREATE INDEX IF NOT EXISTS job_metrics_sampled_at_idx
    ON ci.job_metrics (sampled_at DESC);

-- Per-queue drill-down: "show me image-description for the last week".
CREATE INDEX IF NOT EXISTS job_metrics_queue_sampled_at_idx
    ON ci.job_metrics (queue, sampled_at DESC);

-- migrate:down

DROP TABLE IF EXISTS ci.job_metrics;
