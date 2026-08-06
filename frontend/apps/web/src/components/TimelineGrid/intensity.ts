/**
 * Intensity scaling for the activity heatmap.
 *
 * Scaling cell colour linearly against the raw maximum breaks down as soon as
 * the history contains a bulk import: one day with ~18,000 entries pins the top
 * of the ramp so far away that a 10-entry day and a 500-entry day both round to
 * the first level, and the whole grid reads as uniformly empty.
 *
 * Instead the ramp tops out at an *outlier-robust ceiling*: the largest ordinary
 * day, where "ordinary" is everything at or below Tukey's upper fence
 * (Q3 + 1.5 × IQR) of the non-zero counts. Days above the fence — imports,
 * backfills, migrations — all clamp to full intensity, and the levels below
 * spread across the range real activity actually occupies.
 *
 * This is a trade, not a free win, and the cost is real: daily activity counts
 * are right-skewed, so the fence sits below the raw maximum on ordinary
 * histories too, and the genuinely busiest days saturate together at the top
 * level. It is *not* true that a history without a bulk import scales as it did
 * before. On the ORDINARY fixture in the tests — no import anywhere — the raw
 * maximum is 500 and the ceiling is 180, so 180, 260, 340 and 500 are all
 * rendered identically — 4 of its 18 active days. On a full year of measured
 * log-normal activity it is closer to the top 10%. That is accepted
 * deliberately: distinguishing a 4-entry day from a 90-entry day is what the
 * grid is read for, and distinguishing the busiest day of the year from the
 * third-busiest is not.
 *
 * A high percentile (p95/p98) of the non-zero counts compresses less of that
 * tail, and was measured before settling on the fence, but it fails the case
 * this module exists for. Because CI-Import-Tools imports arrive per source, a
 * user typically gets several import days, not one, and a percentile can only
 * discount a fixed share of the sample: with 18 ordinary days plus 3 import
 * days, p95 puts the ceiling at 22,000 (the flat grid, back verbatim) where the
 * fence puts it at 500; with 120 ordinary days plus 8 import days, p95 gives
 * 18,000 against the fence's 49. The fence adapts to how many outliers there
 * are; a percentile assumes the answer up front.
 *
 * Kept React-free so it can be unit-tested in the fast node vitest project.
 */

/** Below this many active days quartiles are noise, so no clamping is applied. */
const MIN_SAMPLE_FOR_OUTLIERS = 5;

/** Tukey's multiplier — the conventional 1.5 × IQR "outer activity" fence. */
const IQR_MULTIPLIER = 1.5;

/**
 * Linear-interpolated quantile over an ascending-sorted array. Matches the
 * common "type 7" definition (what NumPy and R use by default).
 */
function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) {
    return 0;
  }

  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position);
  const upper = sorted[lower + 1];

  if (upper === undefined) {
    return sorted[lower];
  }

  return sorted[lower] + (position - lower) * (upper - sorted[lower]);
}

/**
 * The count that should render at full intensity.
 *
 * Zero-count days are excluded before the quartiles are taken — the grid is
 * mostly empty cells, and letting them into the distribution would drag Q1/Q3
 * toward zero and flag ordinary days as outliers.
 *
 * Returns 0 when there is no activity at all, in which case every cell is
 * level 0. Below {@link MIN_SAMPLE_FOR_OUTLIERS} active days the quartiles are
 * noise, so the plain maximum is used and nothing is clamped.
 *
 * Otherwise the result is the largest active day at or below the fence, which
 * on real (right-skewed) activity is usually *below* the raw maximum even with
 * no import present — see the module comment for why that compression is
 * accepted. It equals the raw maximum only when no day clears the fence.
 */
export function intensityCeiling(counts: Iterable<number>): number {
  const active: number[] = [];

  for (const count of counts) {
    if (count > 0) {
      active.push(count);
    }
  }

  if (active.length === 0) {
    return 0;
  }

  active.sort((a, b) => a - b);

  const max = active[active.length - 1];

  if (active.length < MIN_SAMPLE_FOR_OUTLIERS) {
    return max;
  }

  const q1 = quantile(active, 0.25);
  const q3 = quantile(active, 0.75);
  const fence = q3 + IQR_MULTIPLIER * (q3 - q1);

  // "The highest ordinary day" rather than the fence itself, so the top of the
  // ramp is always a real observation. `active` is ascending, so the last value
  // that clears the fence is the largest one.
  let ceiling = 0;

  for (const count of active) {
    if (count > fence) {
      break;
    }

    ceiling = count;
  }

  // A degenerate distribution (e.g. every active day identical) can put the
  // fence below the smallest observation; fall back to the plain maximum.
  return ceiling > 0 ? ceiling : max;
}

/**
 * Bucket a count into `0..maxLevel` against a ceiling from
 * {@link intensityCeiling}. Zero stays at level 0 (the "no activity" colour),
 * any non-zero count is at least level 1 so a quiet day is still visible, and
 * anything at or above the ceiling saturates at `maxLevel`.
 */
export function intensityLevel(count: number, ceiling: number, maxLevel: number): number {
  if (count <= 0 || ceiling <= 0 || maxLevel <= 0) {
    return 0;
  }

  if (count >= ceiling) {
    return maxLevel;
  }

  return Math.max(1, Math.ceil((count / ceiling) * maxLevel));
}
