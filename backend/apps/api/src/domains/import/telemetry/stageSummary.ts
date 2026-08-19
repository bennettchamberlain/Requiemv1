import { classifyDrops, gapsIn, totalDrops, type DropReason } from './dropReasons';

/**
 * The per-stage structured summary written to `ci_import.import_stages.detail`.
 *
 * ## What this is for
 *
 * A finished import must be answerable without reading the code that produced
 * it. Four questions, for a person and for an agent with no context:
 *
 *   1. what did this stage CONSUME?
 *   2. what did it PRODUCE?
 *   3. what did it DROP, and under which reason?
 *   4. per data source, when the stage handled several?
 *
 * Before this, none of the four were answerable on a real run. Measured on the
 * 13-run QA corpus of one person's actual exports:
 *
 *  - the Google Takeout parse wrote 56 entries under `detail.sources` for 13
 *    distinct data sources, unaggregated and in recognition order, so "how many
 *    Google Photos records did this import produce?" meant summing eight rows
 *    by hand;
 *  - 9 of those 56 produced zero rows and zero drops — `google_photos`,
 *    `google_chrome`, `fitbit`, `kmlgx`, `contact_list`, four `vcard` paths —
 *    which is indistinguishable from a parser that was never tried;
 *  - `facebook` appeared with 0/0/{} in TWO unrelated runs (an Instagram export
 *    and a vCard/calendar export), i.e. recognition false-positived and nothing
 *    recorded it;
 *  - the push stage reported one `deduped` number that silently merged three
 *    different outcomes (see {@link StageSummary.drops} and the `no_destination`
 *    reason);
 *  - the Lyft parse produced 0 items with `{cancelled_trip: 2,
 *    trip_without_start_time: 79}` — the ONE case where the existing detail did
 *    explain itself, and only because someone had added drop calls to that
 *    parser.
 *
 * ## The contract
 *
 * `consumed = produced + dropped`, per unit and in the roll-up. That is the
 * whole discipline: a stage cannot report a number it has not accounted for.
 * {@link buildStageSummary} computes `consumed` FROM the two rather than taking
 * it on trust, and sets {@link StageSummary.reconciled} — a stage that wants to
 * report a consumed figure it measured independently passes
 * `consumedOverride`, and a mismatch is recorded rather than hidden. There is a
 * test on this invariant; see `__tests__/stageSummary.test.ts`.
 *
 * ## Stability, for agents
 *
 * This shape is PARSED, not just rendered. It is versioned by
 * {@link STAGE_SUMMARY_VERSION} and lives under a single reserved key
 * ({@link SUMMARY_KEY}) on the stage's `detail` JSONB, alongside — never in
 * place of — the keys that were already there. `detail.recognized`,
 * `detail.pushed`, `detail.deduped`, `detail.partial` and `detail.sources` are
 * read by `ImportRunsController`, `ImportRunService.recordsFor` and the web
 * `RunPipeline` component, and continue to mean exactly what they meant.
 *
 * Breaking changes bump the version and keep the old key readable. Additive
 * fields do not.
 */
export const STAGE_SUMMARY_VERSION = 1 as const;

/** The reserved key this summary occupies on a stage's `detail` JSONB. */
export const SUMMARY_KEY = 'summary' as const;

/**
 * What a unit IS, so a reader knows what it is looking at without a lookup.
 *
 * A parse's units are data sources; an unpack's are archives; a push's are the
 * `ci.*` tables it wrote into; a media stage has one unit because the object
 * store is one destination.
 */
export type StageUnitKind = 'data_source' | 'archive' | 'destination' | 'store';

/**
 * Why a unit produced nothing.
 *
 * A closed vocabulary for the same reason the drop reasons are: this is the
 * field that turns "0" into an answer. Every zero-yield unit gets one, so
 * `produced === 0 && emptyReason == null` is itself a bug worth catching.
 */
export const EMPTY_REASONS = [
  /** The stage was handed nothing to work on. */
  'no_input',
  /**
   * The unit was ATTEMPTED, read its input, and emitted no records at all — no
   * output and no drops either. Recognition matched something the parser then
   * found nothing in: a false-positive match, an export layout that changed
   * under the parser, or a directory that is empty in this particular archive.
   * This is the case that used to look identical to "never tried".
   */
  'recognized_not_read',
  /** Everything consumed was dropped. `drops` says under what. */
  'all_dropped',
  /** Every record was already in `ci.*`. A legitimate re-import outcome. */
  'all_already_present',
  /** A resumed stage found its work already settled by the attempt before it. */
  'nothing_pending',
  /** The unit threw before it could produce anything. `error` says what it was doing. */
  'failed',
] as const;

export type EmptyReason = (typeof EMPTY_REASONS)[number];

/** One data source, archive or destination's share of a stage's work. */
export interface StageSummaryUnit {
  /** The data source name, archive basename or destination table. */
  unit: string;

  /**
   * Records handed to this unit. `produced + dropped`, unless the unit measured
   * its input independently and passed `consumedOverride` — see
   * {@link StageSummary.reconciled}.
   */
  consumed: number;

  /** Records this unit turned into rows that survive the run. */
  produced: number;

  /** Records that did not become a row. Sums {@link StageSummaryUnit.drops}. */
  dropped: number;

  /**
   * The parsers' own slugs, verbatim: `{cancelled_trip: 2,
   * trip_without_start_time: 79}`. Fine-grained and human-facing.
   */
  drops: Record<string, number>;

  /**
   * The same drops under the closed {@link DropReason} vocabulary. THIS is the
   * key to group and compare by; the slug map above is the detail behind it.
   */
  dropsByReason: Partial<Record<DropReason, number>>;

  /** Set whenever `produced === 0`. Never free prose. */
  emptyReason?: EmptyReason;

  /**
   * How many times this unit ran, when recognition matched it at several paths.
   * The Google Takeout matched `vcard` six times and `google_my_activity`
   * eight; the roll-up is per data source and this is what says the roll-up
   * covers more than one pass.
   */
  passes?: number;

  /**
   * Where this unit's input was, relative to the run's scratch tree.
   *
   * A false-positive recognition is always a path question. `facebook` matched
   * and produced 0/0/{} inside both an Instagram export and a vCard/calendar
   * export on the QA corpus, and the only useful next question is "what did it
   * match?" — which nothing recorded. Kept to one path even when a source
   * matched at several, since the aggregate is per source name.
   */
  path?: string;

  /** Present only when the unit failed. The rendered {@link StageFailureContext} line. */
  error?: string;
}

/** One stage's whole account of itself. */
export interface StageSummary {
  /** Schema version. Bumped only for a BREAKING change; additive fields do not bump it. */
  v: typeof STAGE_SUMMARY_VERSION;

  /** Which stage wrote this. Present so a detached summary is self-describing. */
  stage: 'unpack' | 'parse' | 'media' | 'push';

  /** What the entries in {@link StageSummary.units} are. */
  unitKind: StageUnitKind;

  /** Roll-up of every unit. */
  consumed: number;
  produced: number;
  dropped: number;

  /** Roll-up of the per-unit slug ledgers. */
  drops: Record<string, number>;

  /** Roll-up of the per-unit closed-vocabulary ledgers. */
  dropsByReason: Partial<Record<DropReason, number>>;

  /**
   * The subset of `dropsByReason` that is a GAP rather than an expected
   * outcome, most first. Precomputed because it is the one list a person or an
   * agent reads first, and deriving it needs the severity table that lives in
   * this process.
   */
  gaps: Array<{ reason: DropReason; count: number }>;

  /**
   * `consumed === produced + dropped`.
   *
   * False means a stage reported a consumed figure it could not account for,
   * which is a defect in the stage rather than in the import — recorded, not
   * thrown, because a telemetry disagreement must never fail a 40GB import that
   * otherwise worked.
   */
  reconciled: boolean;

  /** Set whenever the stage as a whole produced nothing. */
  emptyReason?: EmptyReason;

  /** Per data source / archive / destination. Aggregated, sorted by `produced` descending. */
  units: StageSummaryUnit[];

  /**
   * A handful of real examples behind the drop counts — never one per row.
   *
   * The corpus this was built against has a single parse stage that consumed
   * 703,956 items; a per-row log of anything is unusable at that size and
   * expensive to write. Ten samples name the thing concretely enough to go
   * look at it, and the counts above say how common it is.
   */
  samples?: Array<{ reason: DropReason; slug?: string; detail: string }>;

  /**
   * What the stage was doing when it threw, if it did. Structured so an agent
   * does not have to parse the message.
   */
  failure?: StageFailureContext;
}

/**
 * What a stage was working on at the moment it failed.
 *
 * An import error that names nothing is unactionable: "ENOENT: no such file or
 * directory" over a 703,956-item parse of a 13-source Takeout tells a person
 * which of the four stages died and nothing else. Every field is optional
 * because different stages know different things, and a partly-filled context
 * is still worth more than a bare message.
 */
export interface StageFailureContext {
  /** The stage kind, so the context stands alone once it is out of the row. */
  stage?: string;
  /** The phase the runner had last reported — `extracting`, `parsing gmail (3/13)`. */
  phase?: string;
  /** Which data source's parser was running. */
  dataSource?: string;
  /** The file or directory being read, relative to the run scratch where possible. */
  file?: string;
  /** Which `ci.*` destination was being written. */
  destination?: string;
  /** Batch identity: how many rows, and the first staged id in it. */
  batchSize?: number;
  firstRowId?: string;
  /** The staged row being handled, when the failure is attributable to one. */
  stagedItemId?: string;
  /** The exception's own message, unmodified. */
  message: string;
  /** Error class name — `DatabaseVolumeFullError` reads very differently from `Error`. */
  name?: string;
}

/** What a stage hands {@link buildStageSummary} for one unit. */
export interface StageUnitInput {
  unit: string;
  produced: number;
  /** Slug-keyed, exactly as the parsers emit it. Classified here. */
  drops?: Record<string, number>;
  /**
   * A consumed figure the unit measured for itself — files walked, rows read.
   * Supply it when the stage genuinely knows; leave it out and `consumed`
   * becomes `produced + dropped`, which is the honest floor.
   */
  consumedOverride?: number;
  /** Used when the unit produced nothing and the stage knows better than the default. */
  emptyReason?: EmptyReason;
  passes?: number;
  /** Where this unit's input was. See {@link StageSummaryUnit.path}. */
  path?: string;
  error?: string;
}

export interface StageSummaryInput {
  stage: StageSummary['stage'];
  unitKind: StageUnitKind;
  units: StageUnitInput[];
  /**
   * The empty reason to use for a unit (or the stage) that consumed nothing.
   *
   * Per stage, because "consumed nothing" means different things: a parse unit
   * in this list WAS attempted, so its zero is `recognized_not_read`; a media
   * stage with no media rows genuinely had `no_input`.
   */
  zeroInputReason?: EmptyReason;
  samples?: StageSummary['samples'];
  failure?: StageFailureContext;
}

/**
 * Fold a stage's per-unit numbers into the persisted summary.
 *
 * Aggregates by unit NAME first — the Takeout parse hands this 56 entries over
 * 13 data sources and gets 13 units back, each with a `passes` count — then
 * derives every roll-up from the aggregate rather than from a second set of
 * counters, so the two cannot drift.
 */
export function buildStageSummary(input: StageSummaryInput): StageSummary {
  const byUnit = new Map<string, StageSummaryUnit & { consumedMeasured: boolean }>();

  for (const entry of input.units) {
    const drops = { ...(entry.drops ?? {}) };
    const dropped = totalDrops(drops);
    const consumed = entry.consumedOverride ?? entry.produced + dropped;
    const existing = byUnit.get(entry.unit);

    if (existing == null) {
      byUnit.set(entry.unit, {
        unit: entry.unit,
        consumed,
        produced: entry.produced,
        dropped,
        drops,
        dropsByReason: classifyDrops(drops),
        passes: entry.passes ?? 1,
        consumedMeasured: entry.consumedOverride != null,
        ...(entry.path != null ? { path: entry.path } : {}),
        ...(entry.error != null ? { error: entry.error } : {}),
        ...(entry.emptyReason != null ? { emptyReason: entry.emptyReason } : {}),
      });

      continue;
    }

    existing.consumed += consumed;
    existing.produced += entry.produced;
    existing.dropped += dropped;
    existing.passes = (existing.passes ?? 1) + (entry.passes ?? 1);
    existing.consumedMeasured ||= entry.consumedOverride != null;
    mergeCounts(existing.drops, drops);
    mergeCounts(existing.dropsByReason as Record<string, number>, classifyDrops(drops));
    // First error wins, and only when this pass carried one: a source that
    // matched at six paths and threw at one has a reason worth keeping, and
    // the five that worked must not overwrite it.
    existing.error ??= entry.error;
    existing.path ??= entry.path;
    // The unit-level empty reason is re-derived below over the merged totals,
    // because a source that produced nothing at five paths and 325 rows at the
    // sixth did not, in aggregate, produce nothing.
  }

  const units = [...byUnit.values()]
    .map((unit) => finishUnit(unit, input.zeroInputReason ?? 'no_input'))
    .sort((a, b) => b.produced - a.produced || a.unit.localeCompare(b.unit));

  const consumed = sum(units, (unit) => unit.consumed);
  const produced = sum(units, (unit) => unit.produced);
  const dropped = sum(units, (unit) => unit.dropped);
  const drops: Record<string, number> = {};
  const dropsByReason: Partial<Record<DropReason, number>> = {};

  for (const unit of units) {
    mergeCounts(drops, unit.drops);
    mergeCounts(dropsByReason as Record<string, number>, unit.dropsByReason as Record<string, number>);
  }

  const summary: StageSummary = {
    v: STAGE_SUMMARY_VERSION,
    stage: input.stage,
    unitKind: input.unitKind,
    consumed,
    produced,
    dropped,
    drops,
    dropsByReason,
    gaps: gapsIn(dropsByReason),
    reconciled: consumed === produced + dropped,
    units,
    ...(input.samples != null && input.samples.length > 0 ? { samples: input.samples } : {}),
    ...(input.failure != null ? { failure: input.failure } : {}),
  };

  if (produced === 0) {
    summary.emptyReason = emptyReasonFor(
      { consumed, produced, dropped, dropsByReason },
      input.failure != null ? 'failed' : (input.zeroInputReason ?? 'no_input'),
    );
  }

  return summary;
}

/** Re-derive a merged unit's empty reason and shed the bookkeeping field. */
function finishUnit(
  unit: StageSummaryUnit & { consumedMeasured: boolean },
  zeroInputReason: EmptyReason,
): StageSummaryUnit {
  const { consumedMeasured: _measured, ...rest } = unit;

  if (rest.produced > 0) {
    delete rest.emptyReason;

    return rest;
  }

  return {
    ...rest,
    emptyReason: emptyReasonFor(rest, rest.error != null ? 'failed' : zeroInputReason),
  };
}

/**
 * Why nothing came out.
 *
 * Ordered most-specific first. `all_already_present` before `all_dropped`
 * because a re-import legitimately drops every row under `already_present` and
 * calling that "everything was dropped" reads as a broken import when it is the
 * dedup working — the exact confusion the push stage's single `deduped` counter
 * caused.
 */
function emptyReasonFor(
  totals: {
    consumed: number;
    produced: number;
    dropped: number;
    dropsByReason: Partial<Record<DropReason, number>>;
  },
  fallback: EmptyReason,
): EmptyReason {
  if (fallback === 'failed') {
    return 'failed';
  }

  if (totals.dropped > 0) {
    return totals.dropsByReason.already_present === totals.dropped ? 'all_already_present' : 'all_dropped';
  }

  return totals.consumed === 0 ? fallback : 'all_dropped';
}

function mergeCounts(into: Record<string, number>, from: Readonly<Record<string, number>>): void {
  for (const [key, count] of Object.entries(from)) {
    into[key] = (into[key] ?? 0) + count;
  }
}

function sum<T>(rows: readonly T[], of: (row: T) => number): number {
  return rows.reduce((total, row) => total + of(row), 0);
}
