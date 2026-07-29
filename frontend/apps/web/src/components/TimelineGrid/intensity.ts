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
 * level 0. With too few active days to characterise a distribution, or when
 * nothing exceeds the fence, this is just the plain maximum — so a history
 * without a bulk import scales exactly as it did before.
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
