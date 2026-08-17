/**
 * Per-row progress of the push phase, carried by both staged items and staged
 * entities.
 *
 * Per-ROW rather than a cursor into the table. A cursor assumes rows push in a
 * fixed order and that a failure is fatal to everything after it; per-row state
 * lets one poisoned record sit at `failed` while the rest of the run completes,
 * and makes a resumed push cost O(remaining) instead of O(processed).
 *
 * `skipped` is a decision, not an absence: the row was considered and
 * deliberately not pushed (a duplicate, an unsupported variant). Keeping it
 * distinct from `pending` is what stops a resumed push from reconsidering the
 * same rejects on every pass.
 */
export type StagedPushStatus = 'pending' | 'pushed' | 'skipped' | 'failed';
