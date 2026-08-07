export const DEFAULT_QUEUE = 'default';

// Priority every job carries unless a caller asks for something else. pg-boss
// fetches `ORDER BY priority DESC, created_on, id`, so a HIGHER number is worked
// sooner: positive values jump the line, negative values sink below ordinary
// traffic (useful for bulk backfills that should yield to interactive work).
// This mirrors pg-boss's own column default, so stating it explicitly changes no
// behaviour — it just makes the baseline every other priority is relative to
// visible at the call site.
export const DEFAULT_JOB_PRIORITY = 0;
