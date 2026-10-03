/**
 * The seek half of the search browse's composite keyset `(time, id)`, in either
 * direction.
 *
 * ── What it replaces ───────────────────────────────────────────────────────
 * Every `getEntitiesFor*` method behind the timed browse used to carry its own
 * copy of
 *
 *     (t < :afterTime OR (t = :afterTime AND id < :afterId))   ORDER BY t DESC, id DESC
 *
 * with the direction written into the operator and the tiebreak. The primary
 * column could be flipped through an `order` option, but the seek and the id
 * tiebreak could not, so nothing could page UPWARDS: "Oldest first" asked for
 * `ORDER BY t ASC, id DESC` past a `<` cursor, and the resolver sorted whatever
 * came back. This is the one place the direction now lives.
 *
 * ── Why the seek is a millisecond BUCKET, not a point ──────────────────────
 * The columns the browse pages on are `timestamptz(6)`: microseconds. The cursor
 * that comes back is built from a JavaScript `Date`, and the driver TRUNCATES
 * to milliseconds on the way in (`10:00:00.123456` is read as `.123`). So the
 * cursor does not name the row's instant; it names the millisecond that
 * contains it, and the order the merged page is built in is `(that
 * millisecond, id)`. A seek written against a point is wrong in both
 * directions:
 *
 *   - `t = :afterTime` matches nothing at all for a microsecond value, so the
 *     descending seek lost every row of the cursor's millisecond that sorted
 *     after it. A bulk import stamps a whole batch with one `now()`, so "the
 *     cursor's millisecond" is routinely the rest of a page-sized batch;
 *   - `t > :afterTime` matches the cursor row's own millisecond, so the
 *     ascending mirror re-served the row it started from, and a batch larger
 *     than a page re-served the same page for ever.
 *
 * So the cursor's millisecond is `[:afterTime, :afterTimeEnd)`, a half-open
 * range, and the seek is: strictly later buckets, or this bucket and past the
 * id. Both bounds are plain comparisons on the bare column, so the btree
 * behind `(user_id, <time> DESC)` keeps serving the order and the range.
 *
 *   DESC   t < :afterTime            OR  (t in bucket AND id < :afterId)
 *   ASC    t >= :afterTimeEnd        OR  (t in bucket AND id > :afterId)
 *
 * Each also carries its far bound as a top-level conjunct (`t < :afterTimeEnd`
 * for DESC, `t >= :afterTime` for ASC). It excludes nothing the disjunction
 * lets through; it exists so the planner sees one index range rather than an
 * OR it has to plan arm by arm.
 *
 * ── What it assumes ────────────────────────────────────────────────────────
 * The page is ordered `(t, id)` in SQL and `(millisecond, id)` in the merge. Those
 * are the same order whenever the rows that share a millisecond share their
 * microseconds too, which is true of everything the browse holds: a source-dated
 * row has no sub-millisecond part, and a `now()`-stamped batch has an identical
 * one. They could differ only for rows of ONE type, in ONE millisecond, with
 * different microseconds that sort against their ids, and only matter if more
 * than `first * 4` of them straddle a page: the per-type over-fetch absorbs
 * anything smaller.
 */

export type KeysetOrder = 'ASC' | 'DESC';

/**
 * The direction an `order` option asks for: `'ASC'` / `'asc'`, or an order object
 * like `{ startTime: 'ASC' }` (the first key decides, as it does for the SQL's
 * primary sort). Anything else, including no order at all, is `'DESC'`: newest
 * first, which is what every caller that passes nothing has always got.
 */
export function keysetOrderOf(order: unknown): KeysetOrder {
  const first = typeof order === 'object' && order !== null ? Object.values(order)[0] : order;

  return typeof first === 'string' && first.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
}

/** What {@link keysetSeek} binds. `afterTimeEnd` is the first instant of the millisecond after the cursor's. */
export interface KeysetSeekParams {
  afterTime: Date;
  afterTimeEnd: Date;
  afterId: string;
}

/**
 * The `andWhere` arguments that page strictly past `(afterTime, afterId)` in `order`.
 *
 * Spread it: `query.andWhere(...keysetSeek('file.updated_at', 'file.id', order, afterTime, afterId))`.
 * `timeExpr` and `idExpr` are the column expressions the query orders by, exactly as the ORDER BY
 * writes them (a receipt's is `COALESCE(purchased_at, updated_at)`).
 */
export function keysetSeek(
  timeExpr: string,
  idExpr: string,
  order: KeysetOrder,
  afterTime: Date,
  afterId: string,
): [sql: string, params: KeysetSeekParams] {
  const inBucket = `${timeExpr} >= :afterTime AND ${timeExpr} < :afterTimeEnd`;
  const params: KeysetSeekParams = {
    afterTime,
    afterTimeEnd: new Date(afterTime.getTime() + 1),
    afterId,
  };

  if (order === 'ASC') {
    return [
      `(${timeExpr} >= :afterTime AND (${timeExpr} >= :afterTimeEnd OR (${inBucket} AND ${idExpr} > :afterId)))`,
      params,
    ];
  }

  return [
    `(${timeExpr} < :afterTimeEnd AND (${timeExpr} < :afterTime OR (${inBucket} AND ${idExpr} < :afterId)))`,
    params,
  ];
}
