import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from 'typeorm';

import type { StagedPushStatus } from './pushState';

/**
 * What the push turned a staged item into on the ci.* side — the item-side
 * counterpart of `entity_mappings`. An item-to-item edge can only be written
 * downstream once BOTH of its endpoints carry one of these.
 */
export interface StagedItemPushRef {
  /** Which ci.* surface the record landed on, e.g. 'content' | 'communication' | 'position'. */
  kind: string;
  id: string;
}

/**
 * One parsed record awaiting push. Mirrors migration
 * 20260810164304_create_ci_import_schema, and column-for-column the upstream
 * CI-Import-Tools SQLite `items` table.
 *
 * Two renames from upstream: `timestamp` became {@link occurredAt} (the original
 * collides with the type name and needs quoting everywhere), and the TEXT
 * primary key became {@link contentHash} under a surrogate UUID id.
 *
 * SCOPED TO ITS RUN and deleted with it. These rows are a scratchpad between
 * parsing and pushing, not a second copy of the user's data — cross-run and
 * cross-source deduplication is ci.*'s job (content_sha256, identifier claims,
 * entity resolution), and duplicating that logic here is how the two would
 * drift. What IS enforced here is within-run dedup on
 * `(runId, dataSource, contentHash)`, which is a parser contract rather than a
 * storage optimization: see {@link contentHash}.
 */
@Entity({ schema: 'ci_import', name: 'staged_items' })
@Index('staged_items_run_source_hash_uniq', ['runId', 'dataSource', 'contentHash'], { unique: true })
export class StagedItemEntity {
  @PrimaryColumn({ type: 'uuid' })
  id!: string;

  @Column({ type: 'uuid', name: 'run_id' })
  runId!: string;

  /**
   * Denormalized from the run so the push can filter without a join, and so a
   * stray row stays attributable if its run is gone.
   */
  @Column({ type: 'uuid', name: 'user_id' })
  userId!: string;

  @Column({ type: 'text', name: 'data_source' })
  dataSource!: string;

  @Column({ type: 'text', nullable: true })
  classification!: string | null;

  /**
   * The parser's own id for the record when it assigned one (a Gmail message
   * id), otherwise a sha1 over CONTENT-DERIVED fields only — never the file
   * path. Hashing the path is what made one photo replicated across three album
   * folders persist as three items and reach the server as three events.
   */
  @Column({ type: 'text', name: 'content_hash' })
  contentHash!: string;

  /** Upstream's `timestamp`, renamed off the Postgres type name. */
  @Column({ type: 'timestamptz', name: 'occurred_at', nullable: true })
  occurredAt!: Date | null;

  @Column({ type: 'timestamptz', name: 'timespan_end', nullable: true })
  timespanEnd!: Date | null;

  /**
   * Plain doubles rather than a PostGIS geography: staging is dumb, and the push
   * converts on the way into `ci.positions`. Range CHECKs in the database catch
   * a lat/lon swap at the door, where the offending parser is still obvious.
   */
  @Column({ type: 'double precision', nullable: true })
  latitude!: number | null;

  @Column({ type: 'double precision', nullable: true })
  longitude!: number | null;

  @Column({ type: 'text', nullable: true })
  filename!: string | null;

  @Column({ type: 'text', name: 'media_type', nullable: true })
  mediaType!: string | null;

  /** The record's address at the SOURCE (a URL, a mailbox path) — not a local path. */
  @Column({ type: 'text', name: 'original_location', nullable: true })
  originalLocation!: string | null;

  /** Current path of the bytes in the unpacked archive on local disk. */
  @Column({ type: 'text', name: 'intermediate_location', nullable: true })
  intermediateLocation!: string | null;

  @Column({ type: 'jsonb', default: {} })
  metadata!: Record<string, unknown>;

  /**
   * Fingerprint of the item's bytes, computed at parse time while the file is on
   * disk. NULL for records that carry no file at all (a transaction, a calendar
   * entry).
   */
  @Column({ type: 'text', name: 'content_sha256', nullable: true })
  contentSha256!: string | null;

  @Column({ type: 'bigint', name: 'size_bytes', nullable: true })
  sizeBytes!: number | null;

  @Column({ type: 'text', name: 'push_status', default: 'pending' })
  pushStatus!: StagedPushStatus;

  @Column({ type: 'text', name: 'push_error', nullable: true })
  pushError!: string | null;

  @Column({ type: 'timestamptz', name: 'pushed_at', nullable: true })
  pushedAt!: Date | null;

  @Column({ type: 'jsonb', name: 'pushed_ref', nullable: true })
  pushedRef!: StagedItemPushRef | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;
}

export type StagedItem = Readonly<StagedItemEntity>;
