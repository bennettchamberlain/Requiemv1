import fs from 'node:fs';
import { rm, stat } from 'node:fs/promises';
import path from 'node:path';

import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import plimit from 'p-limit';
import { DataSource } from 'typeorm';

import { LoggerService } from '@ci/common/logging';
import { FileService } from '@ci/domains/files';

import { FILE_CLASSIFICATIONS } from '../push/canonical';
import { dropReasonFor } from '../telemetry/dropReasons';
import { buildStageSummary, SUMMARY_KEY, type StageSummary } from '../telemetry/stageSummary';
import type { ImportStageRunner, StageOutcome, StageRunContext } from '../types';

/** Staged media rows read per batch. Files are uploaded one at a time within it. */
const MEDIA_BATCH = 200;

/** One staged row that has bytes somewhere on disk. */
interface MediaRow {
  id: string;
  filename: string | null;
  mediaType: string | null;
  sizeBytes: string | number | null;
  localPath: string;
}

/**
 * Put an archive's bytes into the object store.
 *
 * The leg the consolidation left out. Upstream uploaded every photo, video,
 * voicemail and MMS part through `ci-server/media.ts` before sending the rows
 * that describe them; the port brought the read side across — `contentFileRef`
 * looks for `metadata.FileId`, `toContentInput` stamps it onto `external_id` —
 * but nothing ever wrote it. So a photo import produced `ci.content` rows
 * pointing at a file that did not exist, `EventMediaLoader` resolved them to
 * null (no gallery thumbnail, no downloadable attachment), and the actual bytes
 * were deleted with the run's scratch tree while the run reported success.
 *
 * ## Why a stage and not a step inside the push
 *
 * It is bounded by something else. Parse reads a tree, push writes Postgres,
 * and this talks to the object store — on a photo archive it is the longest leg
 * of the import by a wide margin, and the one most likely to die halfway. A
 * stage gets its own progress row, its own ETA and stage-granular retry, so an
 * object-store hiccup at photo 40,000 resumes here instead of re-running the
 * push. It runs BEFORE push because the push reads what it writes.
 *
 * ## Resumability
 *
 * Per row, like the push, and for the same reason — but keyed on the work's own
 * output rather than a separate ledger column: a row is done when its metadata
 * carries a `FileId`, so the selection query IS the resume point and shrinks as
 * the stage drains. A row whose bytes could not be read is stamped with
 * `FileMediaError` and skipped by the same query, so one unreadable file cannot
 * spin the stage forever.
 *
 * Dedup is the store's answer, not ours: `uploadWithDedupInfo` hashes the bytes
 * and returns the existing file when they are already held, which is what makes
 * a re-import of the same archive cost nothing and makes a `-edited` duplicate
 * share one object.
 *
 * ## Disk
 *
 * This stage DUPLICATES bytes: every media file exists in the run's scratch
 * tree and, once stored, in the object store — which on the appliance is the
 * same physical volume. Two guards keep that from filling the disk mid-stage
 * the way it did on a real 351GB Takeout (5,318 files refused by the store's
 * free-space floor): a preflight that refuses to start without plausible
 * headroom ({@link assertStoreHeadroom}), and a per-file reclaim that frees
 * each file's scratch copy as soon as its store copy is durable
 * ({@link reclaimScratchCopy}), which is what caps the peak near 1.5× the
 * media bytes instead of 2×.
 */
/**
 * How many media files are uploaded at once.
 *
 * Eight rather than "as many as the batch holds": every one of these is an
 * open file handle plus an in-flight object-store PUT, and a 500-row batch of
 * large videos run flat out would hold 500 of each. Eight is enough to keep the
 * store busy through the latency of the previous request — which is the whole
 * point — while staying a bounded amount of memory and file descriptors.
 */
const MEDIA_CONCURRENCY = Number(process.env.CI_IMPORT_MEDIA_CONCURRENCY ?? 8);

const limit = plimit(MEDIA_CONCURRENCY);

/**
 * Disk the preflight demands beyond what the pending media already occupies,
 * as a fraction of the pending bytes.
 *
 * The stage copies every media file into the object store, which on the
 * appliance lives on the SAME volume as the scratch tree — so without
 * reclamation its peak footprint is 2× the media bytes (scratch copy + store
 * copy), which is exactly how a 351GB Takeout ran the store into its
 * threshold with 5,318 files still to go. With the per-file reclaim in
 * `uploadOne` the two copies mostly do NOT coexist: each file's scratch bytes
 * are freed as its store copy lands, so the peak is nearer 1.5× than 2× —
 * the scratch copy is already on disk, and the extra headroom only has to
 * cover the store copies that pile up ahead of their reclaims (in-flight
 * uploads, rows sharing one file, failed rows that keep their bytes for a
 * retry) plus thumbnails and store metadata. Half the pending bytes is the
 * honest ceiling for that: generous against uneven reclamation, far below
 * the 2× that would refuse imports the stage can actually finish.
 */
const PREFLIGHT_HEADROOM_FACTOR = 0.5;

/**
 * What the object store keeps in reserve and will not let writes consume.
 *
 * MinIO refuses PUTs while its backing disk is near-full — the observed
 * failure was "Storage backend has reached its minimum free drive threshold"
 * with double-digit gigabytes still free — so a preflight that only demands
 * the bytes themselves passes and then dies at the store's floor anyway. A
 * couple of percent of the volume, capped, approximates that floor without
 * hard-coding one MinIO version's rule.
 */
const STORE_RESERVE_FRACTION = 0.02;
const STORE_RESERVE_CAP_BYTES = 100 * 1024 ** 3; // 100 GiB

@Injectable()
export class MediaStage implements ImportStageRunner {
  readonly kind = 'media' as const;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly files: FileService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(MediaStage.name);
  }

  async run(context: StageRunContext): Promise<StageOutcome> {
    const remaining = await this.pendingCount(context.runId);
    const alreadyDone = await this.uploadedCount(context.runId);
    const total = remaining + alreadyDone;

    await context.progress({ processed: alreadyDone, total, phase: 'uploading' });

    if (remaining === 0) {
      // An archive with no media at all — a Takeout of nothing but JSON — is the
      // common case, not an edge one. Say so rather than reporting a bare zero.
      return {
        processed: alreadyDone,
        total,
        detail: {
          uploaded: 0,
          deduped: 0,
          failed: 0,
          carriedOver: alreadyDone,
          [SUMMARY_KEY]: await this.summarize(context.runId, alreadyDone === 0),
        },
      };
    }

    await this.assertStoreHeadroom(context);

    let uploaded = 0;
    let deduped = 0;
    let failed = 0;

    for (;;) {
      const batch = await this.nextBatch(context.runId);

      if (batch.length === 0) {
        break;
      }

      // Concurrent, because this stage is LATENCY-bound, not throughput-bound.
      // Each file is a stat, a read, an object-store PUT, a thumbnail and an
      // UPDATE — a chain of round trips during which this process is doing
      // nothing at all. Run one at a time, a real Apple Photos library moved at
      // 3.8 files/sec: 1,574 photos took 411 seconds, 71% of the whole import,
      // while the push stage beside it was managing 100,000 rows/minute.
      //
      // The work is independent per row — no shared state, no ordering, and the
      // dedupe is resolved by content hash inside the object store rather than
      // by arrival order — so the only thing bounding it is how many uploads the
      // object store should be asked to hold at once.
      const results = await Promise.all(
        batch.map((row) =>
          limit(async () => {
            const outcome = await this.uploadOne(context, row);

            // Counted here, inside the limiter, so progress advances as each
            // file lands rather than jumping a whole batch at a time.
            if (outcome === 'uploaded') {
              uploaded += 1;
            } else if (outcome === 'deduped') {
              deduped += 1;
            } else {
              failed += 1;
            }

            await context.progress({
              processed: alreadyDone + uploaded + deduped + failed,
              total,
              phase: 'uploading',
            });

            return outcome;
          }),
        ),
      );

      // `uploadOne` resolves every row to an outcome and never rejects — it
      // marks a failure on the row and returns 'failed' — so Promise.all here
      // cannot abandon a partly-uploaded batch. Asserting it rather than
      // trusting it: a future refactor that lets it throw would otherwise lose
      // the rest of the batch silently.
      if (results.length !== batch.length) {
        throw new Error(`media batch resolved ${results.length} of ${batch.length} rows`);
      }
    }

    this.logger.log('Uploaded staged media', { runId: context.runId, uploaded, deduped, failed });

    return {
      processed: alreadyDone + uploaded + deduped + failed,
      total,
      // A file the run was handed and could not store is a gap in the import,
      // and the run must say so rather than reporting a clean success over
      // bytes nobody will be able to open.
      partial: failed > 0,
      detail: {
        uploaded,
        deduped,
        failed,
        carriedOver: alreadyDone,
        [SUMMARY_KEY]: await this.summarize(context.runId, false),
      },
    };
  }

  /**
   * Refuse to start when the store cannot plausibly hold what this stage is
   * about to give it — the same fail-loudly-up-front contract the unpack
   * stage's disk preflight makes, for the same reason: without it, the store
   * hits its floor mid-stage and thousands of files fail quietly into the
   * ledger (5,318 on a real Takeout) after the scratch tree's lifetime has
   * already been spent.
   *
   * Measured against the SCRATCH volume, which on the appliance is also the
   * store's volume — the topology this guard exists for. When the store is
   * remote this measures the wrong disk, but then the reclaim keeps local
   * usage flat and the demanded headroom is modest, so the guard errs small.
   * No statfs, or nothing pending, means no preflight: the guard must never
   * be the thing that breaks an import.
   *
   * The demand is deliberately NOT the naive 2× (scratch copy + store copy):
   * see PREFLIGHT_HEADROOM_FACTOR for why reclamation makes half the pending
   * bytes the honest requirement, plus the store's own reserve.
   */
  private async assertStoreHeadroom(context: StageRunContext): Promise<void> {
    // Sum of DECLARED sizes; rows without one count zero, so this is a floor —
    // acceptable for a guard whose alternative is no guard at all.
    const [row] = (await this.dataSource.query(
      `SELECT COALESCE(sum(size_bytes), 0)::bigint AS bytes
         FROM ci_import.staged_items
        WHERE ${this.mediaPredicate()}`,
      [context.runId, this.classifications],
    )) as Array<{ bytes: string | number }>;

    const pendingBytes = Number(row?.bytes ?? 0);

    if (pendingBytes === 0) {
      return;
    }

    let free: number;
    let total: number;
    try {
      const stats = fs.statfsSync(context.scratchDir);

      free = Number(stats.bavail) * Number(stats.bsize);
      total = Number(stats.blocks) * Number(stats.bsize);
    } catch {
      return;
    }

    const reserve = Math.min(total * STORE_RESERVE_FRACTION, STORE_RESERVE_CAP_BYTES);
    const needed = pendingBytes * PREFLIGHT_HEADROOM_FACTOR + reserve;

    if (needed > free) {
      throw new Error(
        `not enough disk space to store this import's media: ${(pendingBytes / 1e9).toFixed(1)}GB of ` +
          `media needs ~${(needed / 1e9).toFixed(1)}GB free (headroom plus the object store's reserve) ` +
          `but only ${(free / 1e9).toFixed(1)}GB is free on that volume — free up space and retry the ` +
          `stage. Nothing was uploaded, so a retry starts where this run stands.`,
      );
    }
  }

  /**
   * The stage's account of itself, read back out of the rows it settled.
   *
   * Counted with two GROUP BYs over `staged_items` rather than from the
   * in-process counters, for three reasons, and every one of them is a
   * correctness reason rather than a stylistic one:
   *
   *  - it covers a RESUME. `uploaded`/`deduped`/`failed` are this attempt's;
   *    the rows carry every attempt's, so a stage that died at photo 40,000
   *    and resumed reports the whole import rather than the tail of it.
   *  - it aggregates the failure reasons that were ALREADY being written per
   *    row and never read. `markFailed` has always stamped
   *    `metadata.FileMediaError` — so on a run where files could not be
   *    stored, the reason for every one of them was sitting in the database
   *    and the stage detail said `failed: N` and nothing else.
   *  - it is O(reasons), not O(files). This corpus has single stages of
   *    700k+ items; the instruction is aggregate by reason, never per row, and
   *    two grouped counts are the cheapest honest way to do it.
   */
  private async summarize(runId: string, noInput: boolean): Promise<StageSummary> {
    const [stored] = (await this.dataSource.query(
      `SELECT count(*)::int AS count
         FROM ci_import.staged_items
        WHERE run_id = $1::uuid AND metadata->>'FileId' IS NOT NULL`,
      [runId],
    )) as Array<{ count: number }>;

    const failures = (await this.dataSource.query(
      // Grouped on the SLUG, not the prose. `FileMediaError` holds an
      // exception message — a path, an errno, an object-store response — which
      // is unique per row and therefore useless as a group key; `markFailed`
      // now writes the closed-vocabulary slug beside it. COALESCE covers rows
      // stamped by a build before that key existed.
      `SELECT COALESCE(metadata->>'FileMediaErrorReason', 'media_upload_failed') AS reason,
              count(*)::int AS count
         FROM ci_import.staged_items
        WHERE run_id = $1::uuid AND metadata->>'FileMediaError' IS NOT NULL
        GROUP BY 1`,
      [runId],
    )) as Array<{ reason: string; count: number }>;

    // Up to five real examples so a person has something to go and look at,
    // one per reason. Never one per row: a photo library that lost 4,000 files
    // to a full object store must not write 4,000 rows of telemetry.
    const samples = (await this.dataSource.query(
      `SELECT DISTINCT ON (metadata->>'FileMediaErrorReason')
              COALESCE(metadata->>'FileMediaErrorReason', 'media_upload_failed') AS reason,
              COALESCE(filename, '(unnamed)') AS filename,
              left(metadata->>'FileMediaError', 200) AS error
         FROM ci_import.staged_items
        WHERE run_id = $1::uuid AND metadata->>'FileMediaError' IS NOT NULL
        ORDER BY metadata->>'FileMediaErrorReason', id
        LIMIT 5`,
      [runId],
    )) as Array<{ reason: string; filename: string; error: string }>;

    const drops: Record<string, number> = {};

    for (const row of failures) {
      drops[row.reason] = (drops[row.reason] ?? 0) + row.count;
    }

    return buildStageSummary({
      stage: 'media',
      // One unit: the object store is a single destination, and splitting by
      // data source here would need a join the selection query does not do.
      unitKind: 'store',
      units: [{ unit: 'object_store', produced: stored?.count ?? 0, drops }],
      zeroInputReason: noInput ? 'no_input' : 'nothing_pending',
      samples: samples.map((row) => ({
        reason: dropReasonFor(row.reason),
        slug: row.reason,
        detail: `${row.filename}: ${row.error}`,
      })),
    });
  }

  /**
   * Store one row's bytes and point the row at the result.
   *
   * The path is re-validated against the run's own scratch directory before it
   * is opened. It arrives from a parser, which read it out of an archive the
   * user supplied, and this stage would otherwise be a primitive for reading
   * any file the API process can see. `realpath` resolution happens inside
   * `stat`/the read, so the containment check compares resolved segments rather
   * than string prefixes.
   */
  private async uploadOne(
    context: StageRunContext,
    row: MediaRow,
  ): Promise<'uploaded' | 'deduped' | 'failed'> {
    const resolved = path.resolve(row.localPath);
    const relative = path.relative(path.resolve(context.scratchDir), resolved);
    const contained = relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));

    if (!contained) {
      await this.markFailed(
        row.id,
        'media_path_escaped_scratch',
        `media path is outside the run scratch directory: ${row.localPath}`,
      );

      return 'failed';
    }

    try {
      const stats = await stat(resolved);

      if (!stats.isFile()) {
        await this.markFailed(row.id, 'media_not_a_file', `media path is not a file: ${resolved}`);

        return 'failed';
      }

      const { file, deduped } = await this.files.uploadWithDedupInfo(
        { userId: context.userId },
        {
          path: resolved,
          filename: row.filename ?? path.basename(resolved),
          contentType: row.mediaType ?? undefined,
          size: stats.size,
          // The description pass is an Ollama round trip per file. An archive
          // import is tens of thousands of files that the enrichment pipeline
          // will reach on its own schedule; doing it inline would make this
          // stage LLM-bound rather than store-bound.
          skipDescription: true,
        },
      );

      await this.markUploaded(row.id, file.id);
      await this.reclaimScratchCopy(context, row, resolved);

      return deduped ? 'deduped' : 'uploaded';
    } catch (err) {
      const reason = (err as Error).message;

      this.logger.warn('Could not store staged media; continuing with the rest', {
        runId: context.runId,
        stagedItemId: row.id,
        error: reason,
      });

      await this.markFailed(row.id, mediaFailureReason(err), reason);

      return 'failed';
    }
  }

  /**
   * Free a file's scratch bytes the moment its store copy is durable.
   *
   * The store copy and the scratch copy are the same bytes twice on what is
   * one volume on the appliance, and end-of-run cleanup is too late to matter:
   * holding both for the whole stage is a 2× peak, and a 351GB Takeout ran the
   * store into its free-space floor exactly that way (5,318 files lost). The
   * row's `FileId` is already committed by the time this runs, so a crash
   * between upload and reclaim costs nothing but bytes the run's cleanup
   * sweeps anyway.
   *
   * Deferred while any UNSETTLED row still points at the same file — a settled
   * row has `FileId`; a failed one does not, and keeps its bytes so a media
   * retry has something to read. Best-effort: a reclaim that cannot delete
   * changes nothing the end-of-run reclaim will not fix.
   */
  private async reclaimScratchCopy(
    context: StageRunContext,
    row: MediaRow,
    resolved: string,
  ): Promise<void> {
    try {
      const others = (await this.dataSource.query(
        `SELECT 1 AS present
           FROM ci_import.staged_items
          WHERE run_id = $1::uuid
            AND id <> $2::uuid
            AND COALESCE(intermediate_location, original_location) = $3
            AND metadata->>'FileId' IS NULL
          LIMIT 1`,
        [context.runId, row.id, row.localPath],
      )) as unknown[];

      if (others.length > 0) {
        return;
      }

      await rm(resolved, { force: true });
    } catch (err) {
      this.logger.debug('Could not reclaim a stored media file; end-of-run cleanup will', {
        runId: context.runId,
        stagedItemId: row.id,
        error: (err as Error).message,
      });
    }
  }

  /**
   * Rows with bytes on disk that this stage has not settled.
   *
   * The predicate mirrors `isMediaItem` — a binary MIME, or one of the
   * file-backed classifications — expressed in SQL so the selection stays a
   * single indexed scan rather than a fetch-and-filter over a whole run.
   */
  private mediaPredicate(): string {
    return `run_id = $1::uuid
        AND (media_type ~ '^(image|video|audio)/' OR classification = ANY($2::text[]))
        AND COALESCE(intermediate_location, original_location) IS NOT NULL
        AND metadata->>'FileId' IS NULL
        AND metadata->>'FileMediaError' IS NULL`;
  }

  private get classifications(): string[] {
    return [...FILE_CLASSIFICATIONS];
  }

  private async nextBatch(runId: string): Promise<MediaRow[]> {
    return this.dataSource.query<MediaRow[]>(
      `SELECT id, filename, media_type AS "mediaType", size_bytes AS "sizeBytes",
              COALESCE(intermediate_location, original_location) AS "localPath"
         FROM ci_import.staged_items
        WHERE ${this.mediaPredicate()}
        ORDER BY id
        LIMIT ${MEDIA_BATCH}`,
      [runId, this.classifications],
    );
  }

  private async pendingCount(runId: string): Promise<number> {
    const [row] = (await this.dataSource.query(
      `SELECT count(*)::int AS count FROM ci_import.staged_items WHERE ${this.mediaPredicate()}`,
      [runId, this.classifications],
    )) as Array<{ count: number }>;

    return row?.count ?? 0;
  }

  /** Rows an earlier attempt already settled — the resume's starting count. */
  private async uploadedCount(runId: string): Promise<number> {
    const [row] = (await this.dataSource.query(
      `SELECT count(*)::int AS count
         FROM ci_import.staged_items
        WHERE run_id = $1::uuid
          AND (metadata->>'FileId' IS NOT NULL OR metadata->>'FileMediaError' IS NOT NULL)`,
      [runId],
    )) as Array<{ count: number }>;

    return row?.count ?? 0;
  }

  /**
   * Stamp the stored file's id onto the row.
   *
   * Written into `metadata` rather than a new column because that is the seam
   * the push already reads: `toCanonical` carries metadata through and
   * `contentFileRef` looks for exactly this key.
   */
  private async markUploaded(id: string, fileId: string): Promise<void> {
    await this.dataSource.query(
      `UPDATE ci_import.staged_items
          SET metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{FileId}', to_jsonb($2::text), true)
        WHERE id = $1::uuid`,
      [id, fileId],
    );
  }

  /**
   * Mark a row this stage could not store, with BOTH halves of the reason.
   *
   * `FileMediaError` keeps the prose it always kept — it is what the resume
   * predicate tests for, and it is the only thing that names the actual file
   * and errno. `FileMediaErrorReason` is the closed-vocabulary slug beside it,
   * and it exists because prose cannot be grouped: every row's message is
   * different, so `SELECT reason, count(*)` over the prose returns one row per
   * failed file, which at this corpus's scale is not a summary of anything.
   */
  private async markFailed(id: string, slug: string, message: string): Promise<void> {
    await this.dataSource.query(
      `UPDATE ci_import.staged_items
          SET metadata = jsonb_set(
                jsonb_set(COALESCE(metadata, '{}'::jsonb), '{FileMediaError}', to_jsonb($2::text), true),
                '{FileMediaErrorReason}', to_jsonb($3::text), true)
        WHERE id = $1::uuid`,
      [id, message.slice(0, 500), slug],
    );
  }
}

/**
 * Which closed-vocabulary slug an upload failure counts under.
 *
 * Only three buckets are worth separating, and they are separated by what a
 * person would DO about them: bytes the archive promised and did not contain
 * (nothing to do — the export is short), bytes that are there and unreadable
 * (a permissions or corruption problem on this appliance), and the object
 * store refusing work (capacity, credentials, a service that is down —
 * re-runnable). Everything else lands in the last of those, because guessing
 * finer from an exception message is how a vocabulary stops being closed.
 */
function mediaFailureReason(err: unknown): string {
  const code = (err as NodeJS.ErrnoException | undefined)?.code;

  if (code === 'ENOENT') {
    return 'media_path_missing';
  }

  if (code === 'EISDIR' || code === 'ENOTDIR') {
    return 'media_not_a_file';
  }

  return 'media_upload_failed';
}
