/**
 * Declared, reviewable constants for the archive importer's run/stage spine.
 *
 * Declared rather than discovered, for the reason `domains/pipeline/constants.ts`
 * gives: the bus derives its queue set from `@OnEvent` decorator side effects at
 * module-import time, so a queue that exists only as a string literal inside a
 * decorator cannot be reviewed in a diff or reasoned about at planning time.
 */

// ---------------------------------------------------------------------------
// Queues
// ---------------------------------------------------------------------------

/**
 * The importer's queue. One, not one per stage kind.
 *
 * Every stage of an import is bound by the same resource class — local disk and
 * CPU, against files the run itself owns. `unpack` spends its time in `unzip`,
 * `parse` in the datasource parsers, and `push` (PR 5) in ingest services that
 * are Postgres-bound but never the bottleneck next to reading a 40GB tree.
 * Splitting them across queues would buy scheduling noise against a global
 * budget of ten in-flight jobs, not isolation.
 *
 * What DOES justify a separate queue from the pipeline's three is duration. A
 * single unpack can hold its slot for tens of minutes on a real Takeout, and a
 * long job sharing `pipeline-enrich` would starve the enrichment legs behind it
 * for the whole extraction.
 *
 * Consumed by `@OnEvent(..., { queue })` in {@link ImportStageListener}, which
 * is what makes `PGBossEventService.onModuleInit` create the queue and start its
 * workers. Renaming it strands whatever is already queued under the old name.
 */
export const IMPORT_QUEUE = 'import-stages';

// ---------------------------------------------------------------------------
// Stage kinds
// ---------------------------------------------------------------------------

/**
 * The stage kinds a run executes, in the order they run.
 *
 * CHECKed in the database (`import_stages.kind`), so this list and the
 * migration's constraint must agree. Kinds are permanent: a stage row records
 * the kind that produced it, and renaming one makes every historical run
 * unreadable.
 *
 * Downstream graph and search work is deliberately NOT modelled here — that
 * belongs to `ci.pipeline_runs`, which already owns it. An import ends when the
 * user's data is in `ci.*`; what the appliance then does with it is a different
 * question with a different progress surface.
 */
export const IMPORT_STAGE_KINDS = ['unpack', 'parse', 'media', 'push'] as const;

export type ImportStageKindName = (typeof IMPORT_STAGE_KINDS)[number];

/**
 * One queue per stage KIND, so the pipeline overlaps across runs: while one
 * run's 350GB unpack holds the unpack slot, every other run's parse, media
 * and push proceed in their own slots. A run's own stages still execute
 * strictly in order — chaining is by re-emission, each stage enqueueing its
 * successor — so per-kind queues change only CROSS-run scheduling.
 *
 * {@link IMPORT_QUEUE} stays registered as a drain: jobs are durable, and a
 * deploy of this split must still consume whatever an older release left
 * queued under the shared name.
 */
export const IMPORT_STAGE_QUEUE_BY_KIND: Record<ImportStageKindName, string> = {
  unpack: 'import-unpack',
  parse: 'import-parse',
  media: 'import-media',
  push: 'import-push',
};

/**
 * Slot counts per kind. `parse` stays at 1 — parsers still run long
 * synchronous stretches, and two abreast is how the event loop starved.
 * `push` stays at 1 — concurrent pushes into the shared `ci.*` tables is an
 * untested dedup path (two runs resolving the same person at once), and push
 * is fast enough that serial costs nothing. `media` is I/O-bound against the
 * object store, so two overlap fine. `unpack` stays at 1 so two archives'
 * disk preflights cannot both pass and then jointly fill the volume.
 *
 * The progress UI reads these and states them — the active-import snapshot
 * reports them as `queue.concurrency`, and the region pinned to the import and
 * jobs pages turns them into a sentence. Thirteen runs against one parse slot
 * is what makes "queued for 51 minutes" the NORMAL state of a batch import
 * rather than a stall, and nobody can tell those two apart unless the surface
 * says how many stages of that kind run at once. A UI holding its own copy
 * would go on claiming the old number after someone changed one here.
 */
export const IMPORT_STAGE_CONCURRENCY: Record<ImportStageKindName, number> = {
  unpack: 1,
  parse: 1,
  media: 2,
  push: 1,
};

/**
 * Relative weight of each kind in the run's percent rollup.
 *
 * Wall-clock proportions from real imports, not equal thirds: unpacking a
 * multi-GB archive and parsing its tree dominate, while the push is bounded by
 * the number of staged rows rather than the size of the export. A progress bar
 * that gave each kind a third would sit at 66% for most of the import and then
 * finish in a blink, which reads as a stall.
 */
export const IMPORT_STAGE_WEIGHTS: Record<ImportStageKindName, number> = {
  unpack: 20,
  parse: 35,
  // Bytes, not rows: an archive's photos and voicemails go to the object store
  // here, and on a photo export this is the longest leg of the whole import —
  // tens of thousands of files against a store, where parse was reading a tree
  // and push is writing Postgres. Weighted accordingly, so the bar does not sit
  // at 55% for an hour and read as a stall. An archive with no media skips it
  // in a beat, which the rollup handles the same way it handles a fast unpack.
  media: 30,
  push: 15,
};

