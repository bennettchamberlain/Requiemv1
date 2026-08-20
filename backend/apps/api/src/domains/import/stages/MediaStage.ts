import { stat } from 'node:fs/promises';
import path from 'node:path';

import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import plimit from 'p-limit';
import { DataSource } from 'typeorm';

import { LoggerService } from '@ci/common/logging';
import { FileService } from '@ci/domains/files';
import { ContentService, type CreateContentDto } from '@ci/domains/memory';

import type { MediaAttachment } from '../datasources/timeline';
import {
  communicationAttachmentsFrom,
  FILE_CLASSIFICATIONS,
  SOURCE_TYPE,
  wantsAttachmentContentFrom,
} from '../push/canonical';
import { dropReasonFor } from '../telemetry/dropReasons';
import { buildStageSummary, SUMMARY_KEY, type StageSummary } from '../telemetry/stageSummary';
import type { ImportStageRunner, StageOutcome, StageRunContext } from '../types';

/** Staged media rows read per batch. Files are uploaded one at a time within it. */
const MEDIA_BATCH = 200;

/**
 * Staged rows read per attachment batch.
 *
 * Smaller than {@link MEDIA_BATCH} because the unit is a ROW, not a file, and a
 * row can carry a dozen of them — a batch of 200 twitter DMs is closer to 400
 * uploads than 200.
 */
const ATTACHMENT_BATCH = 100;

/** The zero-work attachment tally, so both exit paths report the same shape. */
const EMPTY_ATTACHMENT_COUNTS = { rows: 0, files: 0, contents: 0, declined: 0 } as const;

/** One staged row that has bytes somewhere on disk. */
interface MediaRow {
  id: string;
  filename: string | null;
  mediaType: string | null;
  sizeBytes: string | number | null;
  localPath: string;
}

/** One staged row whose metadata carries attachments for the message it becomes. */
interface AttachmentRow {
  id: string;
  dataSource: string;
  contentHash: string;
  metadata: Record<string, unknown> | null;
}

/** What one row's attachment pass settled, before it is stamped back onto the row. */
interface AttachmentOutcome {
  /** `ci.files` ids, in descriptor order. Becomes `metadata.AttachmentFileIds`. */
  fileIds: string[];
  /** `ci.content` ids for the SAME attachments, index-aligned with `fileIds`. */
  contentIds: string[];
  /** Closed-vocabulary slug → count, for the descriptors this leg declined. */
  drops: Record<string, number>;
  /** The first decline's prose, so the stage summary has something to show. */
  firstError: string | null;
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

@Injectable()
export class MediaStage implements ImportStageRunner {
  readonly kind = 'media' as const;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly files: FileService,
    private readonly contents: ContentService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(MediaStage.name);
  }

  async run(context: StageRunContext): Promise<StageOutcome> {
    const remaining = await this.pendingCount(context.runId);
    const alreadyDone = await this.uploadedCount(context.runId);
    const attachmentsRemaining = await this.pendingAttachmentCount(context.runId);
    const attachmentsDone = await this.settledAttachmentCount(context.runId);
    // Both passes are units of the same stage, so they share one denominator —
    // otherwise a twitter archive whose media pass has nothing to do reports
    // `0/0 completed` while it is still uploading 566 attachments.
    const total = remaining + alreadyDone + attachmentsRemaining + attachmentsDone;
    const carriedOver = alreadyDone + attachmentsDone;

    await context.progress({ processed: carriedOver, total, phase: 'uploading' });

    if (remaining === 0 && attachmentsRemaining === 0) {
      // An archive with no media at all — a Takeout of nothing but JSON — is the
      // common case, not an edge one. Say so rather than reporting a bare zero.
      return {
        processed: carriedOver,
        total,
        detail: {
          uploaded: 0,
          deduped: 0,
          failed: 0,
          carriedOver,
          attachments: EMPTY_ATTACHMENT_COUNTS,
          [SUMMARY_KEY]: await this.summarize(context.runId, carriedOver === 0),
        },
      };
    }

    let uploaded = 0;
    let deduped = 0;
    let failed = 0;

    while (remaining > 0) {
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
              processed: carriedOver + uploaded + deduped + failed,
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

    const attachments = await this.runAttachments(context, {
      processedBefore: carriedOver + uploaded + deduped + failed,
      total,
    });

    return {
      processed: carriedOver + uploaded + deduped + failed + attachments.rows,
      total,
      // A file the run was handed and could not store is a gap in the import,
      // and the run must say so rather than reporting a clean success over
      // bytes nobody will be able to open. An attachment the leg DECLINED counts
      // the same way: the whole reason this pass exists is that 566 of them were
      // dropped under a `dropped: 0` green tick.
      partial: failed > 0 || attachments.declined > 0,
      detail: {
        uploaded,
        deduped,
        failed,
        carriedOver,
        attachments: {
          rows: attachments.rows,
          files: attachments.files,
          contents: attachments.contents,
          declined: attachments.declined,
        },
        [SUMMARY_KEY]: await this.summarize(context.runId, false),
      },
    };
  }

  /**
   * Store the attachments that ride a MESSAGE, rather than being one.
   *
   * The other half of the port, and the half that was never wired up. A photo
   * someone sent reaches staging in one of two shapes — a rich descriptor under
   * `metadata.MediaAttachments` (twitter, gmail, iMessage, the LLM chat
   * exports) or a bare path under `metadata.MediaFilePaths` (facebook,
   * sms_backup_restore) — and NOTHING read either one. `attachmentsFor` in the
   * push builds `communications.attachments` from `AttachmentFileIds` /
   * `AttachmentContentIds`; no stage ever wrote those keys, so the column was
   * `[]` on all 325,198 communications in the QA corpus while 566 retained
   * twitter files sat in the run scratch and were deleted with it.
   *
   * ## Why here and not in the push
   *
   * Because the push READS what this writes. `toCommunicationInput` needs the
   * ids in metadata by the time it builds its input, and this stage already
   * runs before it for exactly that reason. It is also the only stage that
   * talks to the object store, so an attachment upload gets the same bounded
   * concurrency, progress and stage-granular retry every other upload gets.
   *
   * ## The unit is a ROW, not a descriptor
   *
   * A row settles atomically: every descriptor on it is attempted, then the
   * whole result is stamped in one UPDATE. That makes the selection query the
   * resume point, exactly like the media pass — a row is done when it carries
   * `AttachmentFileIds`, even if that array is empty because every attachment
   * was declined. An empty array is a settled row, not an unattempted one, so
   * one unreadable file cannot spin the stage forever.
   *
   * Re-running is safe rather than merely tolerable: the object store dedups on
   * the bytes' hash and the content rows dedup on their provenance triple, so a
   * row re-settled after a crash resolves onto the same ids.
   */
  private async runAttachments(
    context: StageRunContext,
    progress: { processedBefore: number; total: number },
  ): Promise<{ rows: number; files: number; contents: number; declined: number }> {
    let rows = 0;
    let files = 0;
    let contents = 0;
    let declined = 0;

    for (;;) {
      const batch = await this.nextAttachmentBatch(context.runId);

      if (batch.length === 0) {
        break;
      }

      // Concurrency is bounded at the ROW here, and a row's own descriptors are
      // uploaded one after another inside it. Nesting `limit()` again per
      // descriptor would deadlock: the outer task holds a slot while awaiting an
      // inner one that can never be scheduled once all slots are held by outer
      // tasks doing the same.
      const results = await Promise.all(
        batch.map((row) =>
          limit(async () => {
            const outcome = await this.settleAttachments(context, row);

            rows += 1;
            files += outcome.fileIds.length;
            contents += outcome.contentIds.length;
            declined += totalDrops(outcome.drops);

            await context.progress({
              processed: progress.processedBefore + rows,
              total: progress.total,
              phase: 'uploading',
            });

            return outcome;
          }),
        ),
      );

      if (results.length !== batch.length) {
        throw new Error(`attachment batch resolved ${results.length} of ${batch.length} rows`);
      }
    }

    if (rows > 0) {
      this.logger.log('Stored communication attachments', {
        runId: context.runId,
        rows,
        files,
        contents,
        declined,
      });
    }

    return { rows, files, contents, declined };
  }

  /**
   * Attempt every attachment on one row, then stamp the result onto it.
   *
   * Never throws. A descriptor this leg cannot store is COUNTED — under the same
   * closed vocabulary the media pass uses, since the causes are the same ones —
   * rather than skipped, because a silent skip here is the bug: the twitter run
   * reported `dropped: 0, dropsByReason: {}` over 566 files it never opened.
   */
  private async settleAttachments(context: StageRunContext, row: AttachmentRow): Promise<AttachmentOutcome> {
    const metadata = row.metadata ?? {};
    const outcome: AttachmentOutcome = { fileIds: [], contentIds: [], drops: {}, firstError: null };
    const decline = (slug: string, detail: string) => {
      outcome.drops[slug] = (outcome.drops[slug] ?? 0) + 1;
      outcome.firstError ??= `${slug}: ${detail}`;
    };

    // Declared but unusable — an iMessage attachment whose row survived the
    // export with a guid and no bytes, say. `communicationAttachmentsFrom` drops
    // these because there is nothing to upload; they are still a gap in the
    // import and have to be said out loud.
    for (let i = 0; i < pathlessAttachmentCount(metadata); i += 1) {
      decline('attachment_no_path', 'attachment was declared with no local path');
    }

    const descriptors = communicationAttachmentsFrom(metadata);
    // Index into the DESCRIPTOR list, not into the successful subset: it is half
    // of each content row's provenance triple, so it has to name the same
    // attachment on a re-run where a previously unreadable sibling now works.
    const stored: Array<{ index: number; fileId: string; descriptor: MediaAttachment }> = [];

    for (const [index, descriptor] of descriptors.entries()) {
      const fileId = await this.storeAttachment(context, descriptor, decline);

      if (fileId == null) {
        continue;
      }

      outcome.fileIds.push(fileId);
      stored.push({ index, fileId, descriptor });
    }

    // The lane split: Messenger opts in because a shared photo is a thing you
    // want to find by itself, not only by reading the thread it arrived in; an
    // MMS part is bare bytes and lands as a file alone. WhatsApp opts out for a
    // third reason — its attachments ALSO reach staging as standalone media
    // items, which already catalogue themselves.
    if (wantsAttachmentContentFrom(metadata) && stored.length > 0) {
      try {
        const created = await this.contents.createManyDetailed(
          { userId: context.userId },
          stored.map((plan) => attachmentContentInput(row, plan)),
        );

        // All-or-nothing, so the two arrays stay index-aligned: `attachmentsFor`
        // documents attachment i as `{ file: fileIds[i], content: contentIds[i] }`,
        // and a partial list would silently re-pair every entry after the gap.
        outcome.contentIds = created.length === stored.length ? created.map((r) => r.entity.id) : [];
      } catch (err) {
        decline('attachment_content_failed', (err as Error).message);
      }
    }

    await this.markAttachments(row.id, outcome);

    return outcome;
  }

  /**
   * Put ONE attachment's bytes in the object store, or say why not.
   *
   * Same containment rule as {@link uploadOne}, and for the same reason: the
   * path comes from a parser that read it out of an archive the user supplied,
   * and this stage must not become a primitive for reading any file the API
   * process can see.
   */
  private async storeAttachment(
    context: StageRunContext,
    descriptor: MediaAttachment,
    decline: (slug: string, detail: string) => void,
  ): Promise<string | null> {
    const resolved = path.resolve(descriptor.path);

    if (!withinScratch(context.scratchDir, resolved)) {
      decline(
        'media_path_escaped_scratch',
        `attachment path is outside the run scratch directory: ${descriptor.path}`,
      );

      return null;
    }

    try {
      const stats = await stat(resolved);

      if (!stats.isFile()) {
        decline('media_not_a_file', `attachment path is not a file: ${resolved}`);

        return null;
      }

      const { file } = await this.files.uploadWithDedupInfo(
        { userId: context.userId },
        {
          path: resolved,
          // The name the user had, not the retained basename: twitter's
          // `retainAttachment` prefixes its copies `twitter-<id>-<hash>.jpg`.
          filename: descriptor.filename ?? path.basename(resolved),
          contentType: descriptor.mimetype,
          size: stats.size,
          // Same reason as the media pass: a description is an Ollama round trip
          // per file, and the enrichment pipeline reaches these on its own.
          skipDescription: true,
        },
      );

      return file.id;
    } catch (err) {
      const message = (err as Error).message;

      this.logger.warn('Could not store a communication attachment; continuing with the rest', {
        runId: context.runId,
        error: message,
      });
      decline(mediaFailureReason(err), message);

      return null;
    }
  }

  /** Rows carrying attachments that this pass has not settled yet. */
  private attachmentPredicate(): string {
    return `run_id = $1::uuid
        AND (metadata->'MediaAttachments' IS NOT NULL OR metadata->'MediaFilePaths' IS NOT NULL)
        AND metadata->'AttachmentFileIds' IS NULL`;
  }

  private async nextAttachmentBatch(runId: string): Promise<AttachmentRow[]> {
    return this.dataSource.query<AttachmentRow[]>(
      `SELECT id, data_source AS "dataSource", content_hash AS "contentHash", metadata
         FROM ci_import.staged_items
        WHERE ${this.attachmentPredicate()}
        ORDER BY id
        LIMIT ${ATTACHMENT_BATCH}`,
      [runId],
    );
  }

  private async pendingAttachmentCount(runId: string): Promise<number> {
    const [row] = (await this.dataSource.query(
      `SELECT count(*)::int AS count FROM ci_import.staged_items WHERE ${this.attachmentPredicate()}`,
      [runId],
    )) as Array<{ count: number }>;

    return row?.count ?? 0;
  }

  /** Rows an earlier attempt already settled — the attachment pass's resume point. */
  private async settledAttachmentCount(runId: string): Promise<number> {
    const [row] = (await this.dataSource.query(
      `SELECT count(*)::int AS count
         FROM ci_import.staged_items
        WHERE run_id = $1::uuid AND metadata->'AttachmentFileIds' IS NOT NULL`,
      [runId],
    )) as Array<{ count: number }>;

    return row?.count ?? 0;
  }

  /**
   * Stamp one row's settled attachments.
   *
   * A shallow `||` merge rather than nested `jsonb_set` calls: four keys are
   * being written at once and every one of them is top-level, so the merge says
   * what is happening in one operator instead of four nested rewrites.
   *
   * `AttachmentFileIds` is ALWAYS written, empty array included — it is what the
   * resume predicate tests, so a row that settled with nothing stored must still
   * carry it or the stage would re-attempt it on every run forever.
   */
  private async markAttachments(id: string, outcome: AttachmentOutcome): Promise<void> {
    const patch: Record<string, unknown> = { AttachmentFileIds: outcome.fileIds };

    if (outcome.contentIds.length > 0) {
      patch.AttachmentContentIds = outcome.contentIds;
    }

    if (Object.keys(outcome.drops).length > 0) {
      patch.AttachmentDrops = outcome.drops;
    }

    if (outcome.firstError != null) {
      patch.AttachmentError = outcome.firstError.slice(0, 500);
    }

    await this.dataSource.query(
      `UPDATE ci_import.staged_items
          SET metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb
        WHERE id = $1::uuid`,
      [id, JSON.stringify(patch)],
    );
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

    const attachments = await this.summarizeAttachments(runId);

    return buildStageSummary({
      stage: 'media',
      // Two units, both stores: a media ITEM's own bytes and the attachments
      // that ride a message are uploaded by different passes with different
      // resume keys, and rolling them into one number would hide exactly the
      // failure this stage was extended to stop hiding.
      unitKind: 'store',
      units: [{ unit: 'object_store', produced: stored?.count ?? 0, drops }, ...attachments.units],
      zeroInputReason: noInput ? 'no_input' : 'nothing_pending',
      samples: [
        ...samples.map((row) => ({
          reason: dropReasonFor(row.reason),
          slug: row.reason,
          detail: `${row.filename}: ${row.error}`,
        })),
        ...attachments.samples,
      ],
    });
  }

  /**
   * The attachment pass's account of itself, read back out of the rows.
   *
   * Same three reasons the media summary is a query rather than a counter: it
   * covers a resume, it aggregates reasons already being written per row, and it
   * is O(reasons) rather than O(attachments).
   *
   * The unit is omitted entirely when the run had no attachments at all, so a
   * Takeout of nothing but JSON does not grow a permanently-empty unit whose
   * `emptyReason` an agent then has to explain away.
   */
  private async summarizeAttachments(runId: string): Promise<{
    units: Array<{ unit: string; produced: number; drops: Record<string, number> }>;
    samples: Array<{ reason: ReturnType<typeof dropReasonFor>; slug: string; detail: string }>;
  }> {
    const [stored] = (await this.dataSource.query(
      `SELECT COALESCE(sum(jsonb_array_length(metadata->'AttachmentFileIds')), 0)::int AS count,
              count(*)::int AS rows
         FROM ci_import.staged_items
        WHERE run_id = $1::uuid AND jsonb_typeof(metadata->'AttachmentFileIds') = 'array'`,
      [runId],
    )) as Array<{ count: number; rows: number }>;

    const declines = (await this.dataSource.query(
      // The per-row ledgers, summed. `jsonb_each_text` is strict, so rows
      // without the key contribute no lateral rows rather than erroring.
      `SELECT entry.key AS reason, sum(entry.value::int)::int AS count
         FROM ci_import.staged_items s,
              jsonb_each_text(s.metadata->'AttachmentDrops') AS entry
        WHERE s.run_id = $1::uuid
          AND jsonb_typeof(s.metadata->'AttachmentDrops') = 'object'
        GROUP BY 1`,
      [runId],
    )) as Array<{ reason: string; count: number }>;

    if ((stored?.rows ?? 0) === 0 && declines.length === 0) {
      return { units: [], samples: [] };
    }

    const samples = (await this.dataSource.query(
      `SELECT COALESCE(data_source, '(unknown)') AS unit,
              left(metadata->>'AttachmentError', 200) AS error
         FROM ci_import.staged_items
        WHERE run_id = $1::uuid AND metadata->>'AttachmentError' IS NOT NULL
        ORDER BY id
        LIMIT 3`,
      [runId],
    )) as Array<{ unit: string; error: string }>;

    const drops: Record<string, number> = {};

    for (const row of declines) {
      drops[row.reason] = (drops[row.reason] ?? 0) + row.count;
    }

    return {
      units: [{ unit: 'communication_attachments', produced: stored?.count ?? 0, drops }],
      samples: samples.map((row) => ({
        reason: dropReasonFor(row.error.split(':')[0]),
        slug: row.error.split(':')[0],
        detail: `${row.unit}: ${row.error}`,
      })),
    };
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

    if (!withinScratch(context.scratchDir, resolved)) {
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
 * Is this resolved path inside the run's own scratch tree?
 *
 * Shared by both passes so the rule cannot drift between a media item and an
 * attachment. `realpath` resolution happens inside `stat`/the read, so this
 * compares resolved segments rather than string prefixes.
 */
function withinScratch(scratchDir: string, resolved: string): boolean {
  const relative = path.relative(path.resolve(scratchDir), resolved);

  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

/** Sum a slug-keyed drop ledger. */
function totalDrops(drops: Record<string, number>): number {
  return Object.values(drops).reduce((sum, n) => sum + n, 0);
}

/**
 * Attachments the row DECLARED that carry no path to upload.
 *
 * Counted from the raw metadata rather than by diffing against
 * `communicationAttachmentsFrom`, because that function also collapses the same
 * file declared under both keys — a legitimate de-dup that must not be reported
 * as a lost attachment.
 */
function pathlessAttachmentCount(metadata: Record<string, unknown>): number {
  let count = 0;

  if (Array.isArray(metadata.MediaAttachments)) {
    for (const entry of metadata.MediaAttachments) {
      const filePath = (entry as Record<string, unknown> | null)?.path;

      if (!entry || typeof entry !== 'object' || typeof filePath !== 'string' || filePath.length === 0) {
        count += 1;
      }
    }
  }

  if (Array.isArray(metadata.MediaFilePaths)) {
    for (const entry of metadata.MediaFilePaths) {
      if (typeof entry !== 'string' || entry.length === 0) {
        count += 1;
      }
    }
  }

  return count;
}

/**
 * The `ci.content` row that catalogues one stored attachment.
 *
 * Identity follows the convention `discordAttachmentContentInputs` already set:
 * the message's provenance triple with an `:attachment:<n>` suffix on the
 * sourceId, so the row dedups server-side across re-imports and keeps a stable
 * identity per attachment. `external_id` is the stored file — that is what a
 * consumer of this row actually needs, and it is what `contentFileRef`/
 * `EventMediaLoader` resolve media through everywhere else.
 */
function attachmentContentInput(
  row: AttachmentRow,
  plan: { index: number; fileId: string; descriptor: MediaAttachment },
): CreateContentDto {
  const input: CreateContentDto = {
    // 'file' passes through for a non-media attachment (an email's PDF); every
    // other descriptor type is media. Same rule the descriptor lane applies.
    type: plan.descriptor.type === 'file' ? 'file' : 'media',
    external_id: plan.fileId,
    external_id_kind: 'file',
    source_type: SOURCE_TYPE,
    source_system: row.dataSource,
    source_id: `${row.contentHash}:attachment:${plan.index}`,
  };

  if (plan.descriptor.filename) {
    input.title = plan.descriptor.filename;
  }

  if (plan.descriptor.mimetype) {
    input.mimetype = plan.descriptor.mimetype;
  }

  // The media's URL on the source service, when the export recorded one — the
  // handle that survives after the local copy is purged.
  if (plan.descriptor.url) {
    input.url = plan.descriptor.url;
  }

  return input;
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
