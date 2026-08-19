import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { LoggerService } from '@ci/common/logging';

/** One mislabelled row, enough to identify and fix it by hand. */
export interface ExternalIdKindViolation {
  /** ci.content.id */
  id: string;
  /** The value that claims to be a ci.files.id but is not one. */
  externalId: string;
  sourceType: string | null;
  sourceSystem: string | null;
}

/**
 * Integrity snapshot for `ci.content.external_id_kind`.
 *
 * `orphanFileRows` is the assertion that matters: every row claiming
 * `external_id_kind = 'file'` must resolve against `ci.files`. Everything else
 * is context for reading that number.
 */
export interface ExternalIdKindIntegrityReport {
  /** Content rows with a non-null `external_id`, by kind. */
  counts: {
    file: number;
    externalUri: number;
    /** Non-null external_id, no kind — the shape test could not classify it. */
    unclassified: number;
  };
  /**
   * THE CHECK: rows stamped 'file' whose `external_id` does not resolve to a
   * `ci.files.id`. Non-zero means a read path that trusts the stamp (e.g.
   * ContentService.findMediaFilesByEventIds) will mis-resolve or drop a link.
   */
  orphanFileRows: number;
  /**
   * The subset of `orphanFileRows` that is not even UUID-shaped — i.e. the
   * mislabel migration 20260818215331 produced (a source-native URI stamped
   * 'file'), as opposed to a well-shaped uuid whose file row was deleted.
   * Non-zero means migration 20260818235804 has not run, or a writer regressed.
   */
  malformedFileRows: number;
  /** Up to {@link VIOLATION_SAMPLE_LIMIT} example violations. */
  sample: ExternalIdKindViolation[];
  /** ISO timestamp the snapshot was computed at. */
  computedAt: string;
}

/** How many example violations the report carries. */
export const VIOLATION_SAMPLE_LIMIT = 20;

/**
 * Reusable SQL fragment: is this `external_id` shaped like a `ci.files.id`?
 *
 * Mirrors `EXTERNAL_ID_UUID_SHAPE` in domains/memory/externalIdKind.ts and the
 * predicate in migration 20260818235804_fix_content_external_id_kind_by_shape.
 */
const UUID_SHAPED = `c.external_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'`;

/**
 * The join key: `external_id` cast to uuid, or NULL when it is not uuid-shaped.
 *
 * `ci.content.external_id` is TEXT and legitimately holds `spotify:track:<id>`,
 * so an unguarded `external_id::uuid` raises `22P02 invalid input syntax for
 * type uuid` — turning the report into a 500 on exactly the corpus it exists to
 * measure. A LEFT JOIN's ON clause is evaluated over every left row, INCLUDING
 * the external_uri ones the WHERE later discards, so the guard has to live in
 * the join key itself. It is a CASE rather than `<shape test> AND <cast>`
 * because Postgres may reorder AND operands by estimated cost and evaluate the
 * (cheaper) cast first, while CASE guarantees the branch is only taken when the
 * test passes.
 */
const UUID_JOIN_KEY = `(CASE WHEN ${UUID_SHAPED} THEN c.external_id::uuid END)`;

/**
 * Cheap integrity check for the `external_id_kind` discriminator (defect F22).
 *
 * `ci.content.external_id` holds either a `ci.files.id` or an opaque
 * source-native reference, and no FK can enforce the difference while both
 * share the column — so `external_id_kind` is the only contract, and nothing
 * was verifying it. A stamp of 'file' is an assertion about `ci.files`, and an
 * assertion nobody checks is how migration 20260818215331 shipped a rule that
 * labelled every Amazon Music / Audible / Kindle / Prime Video URI as a file
 * id.
 *
 * Pure observability: no writes, GLOBAL (not user-scoped) like the other
 * maintenance telemetry. Both queries are anti-joins over `ci.content` filtered
 * to `external_id_kind = 'file'`; at appliance scale (~55k content rows,
 * ~11k of them files) that is a sub-second sequential scan, cheap enough for an
 * ops endpoint hit by hand or a poller.
 */
@Injectable()
export class ExternalIdKindIntegrityService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(ExternalIdKindIntegrityService.name);
  }

  async check(): Promise<ExternalIdKindIntegrityReport> {
    const [countRows, violationRows, sampleRows] = await Promise.all([
      this.dataSource.query<Array<{ kind: string | null; count: string }>>(
        `SELECT external_id_kind AS kind, COUNT(*)::bigint AS count
           FROM ci.content
          WHERE external_id IS NOT NULL
          GROUP BY external_id_kind`,
      ),
      // Rows asserting 'file' that no ci.files row answers for, split by whether
      // the value could ever have been a file id in the first place.
      this.dataSource.query<Array<{ orphans: string; malformed: string }>>(
        `SELECT COUNT(*)::bigint AS orphans,
                COUNT(*) FILTER (WHERE NOT ${UUID_SHAPED})::bigint AS malformed
           FROM ci.content c
           LEFT JOIN ci.files f
             ON f.id = ${UUID_JOIN_KEY}
          WHERE c.external_id_kind = 'file'
            AND f.id IS NULL`,
      ),
      this.dataSource.query<
        Array<{ id: string; external_id: string; source_type: string | null; source_system: string | null }>
      >(
        `SELECT c.id, c.external_id, c.source_type, c.source_system
           FROM ci.content c
           LEFT JOIN ci.files f
             ON f.id = ${UUID_JOIN_KEY}
          WHERE c.external_id_kind = 'file'
            AND f.id IS NULL
          ORDER BY c.created_at DESC
          LIMIT ${VIOLATION_SAMPLE_LIMIT}`,
      ),
    ]);

    const byKind = new Map(countRows.map((row) => [row.kind, Number(row.count)]));
    const orphanFileRows = Number(violationRows[0]?.orphans ?? 0);
    const malformedFileRows = Number(violationRows[0]?.malformed ?? 0);

    if (orphanFileRows > 0) {
      this.logger.warn("ci.content rows stamped external_id_kind='file' do not resolve against ci.files", {
        orphanFileRows,
        malformedFileRows,
      });
    }

    return {
      counts: {
        file: byKind.get('file') ?? 0,
        externalUri: byKind.get('external_uri') ?? 0,
        unclassified: byKind.get(null) ?? 0,
      },
      orphanFileRows,
      malformedFileRows,
      sample: sampleRows.map((row) => ({
        id: row.id,
        externalId: row.external_id,
        sourceType: row.source_type,
        sourceSystem: row.source_system,
      })),
      computedAt: new Date().toISOString(),
    };
  }
}
