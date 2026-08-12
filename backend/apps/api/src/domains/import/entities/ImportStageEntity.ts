import { Column, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * The importer's three-step pipeline. A closed vocabulary by construction — the
 * stage bar in the UI draws one box per value.
 *
 * Everything downstream of `push` (graph extraction, search indexing) belongs to
 * ci-server's own pipeline control plane (`ci.pipeline_runs`) and is
 * deliberately NOT re-modelled here.
 */
export type ImportStageKind = 'unpack' | 'parse' | 'push';

export type ImportStageStatus = 'queued' | 'running' | 'completed' | 'failed' | 'skipped' | 'cancelled';

/**
 * One step of an import run. Mirrors migration
 * 20260810164304_create_ci_import_schema.
 *
 * {@link processed} has ONE meaning across every kind: units of this stage's own
 * work finished so far, with {@link total} as the denominator. Upstream this was
 * read off the worker's item counter, which silently changed meaning per stage
 * and made the progress bar jump backwards between them.
 *
 * `(runId, seq)` is unique, which is both the stage's identity and the
 * `ON CONFLICT` target that makes materializing a run's stages idempotent after
 * a restart.
 */
@Entity({ schema: 'ci_import', name: 'import_stages' })
@Index('import_stages_run_seq_uniq', ['runId', 'seq'], { unique: true })
export class ImportStageEntity {
  @PrimaryColumn({ type: 'uuid' })
  id!: string;

  @Column({ type: 'uuid', name: 'run_id' })
  runId!: string;

  /** Deterministic display order within the run. */
  @Column({ type: 'smallint' })
  seq!: number;

  @Column({ type: 'text' })
  kind!: ImportStageKind;

  @Column({ type: 'text', default: 'queued' })
  status!: ImportStageStatus;

  /**
   * Sub-label within a stage ('parsing', 'hashing', 'uploading', …). Free text,
   * unlike {@link kind}: it is a cosmetic detail line that grows with every new
   * datasource, and constraining it would buy nothing but migrations.
   */
  @Column({ type: 'text', nullable: true })
  phase!: string | null;

  @Column({ type: 'bigint', default: 0 })
  processed!: number;

  /**
   * Denominator, or NULL when the work is not yet countable — which the UI must
   * render as an indeterminate bar. Not 0: a 0/0 bar reads as a finished stage.
   */
  @Column({ type: 'bigint', nullable: true })
  total!: number | null;

  /**
   * Relative cost of this stage in the run's weighted percent rollup. Parsing a
   * mailbox and unpacking the zip that held it are not the same size of job.
   */
  @Column({ type: 'smallint', default: 0 })
  weight!: number;

  @Column({ type: 'double precision', name: 'items_per_sec', nullable: true })
  itemsPerSec!: number | null;

  @Column({ type: 'integer', name: 'eta_seconds', nullable: true })
  etaSeconds!: number | null;

  @Column({ type: 'bigint', name: 'duration_ms', nullable: true })
  durationMs!: number | null;

  /**
   * Typed per-kind breakout: counts by datasource, the drop ledger keyed by
   * reason slug (`{"dedup": 12, "unsupported_variant": 4}`), destination tallies
   * for the push.
   */
  @Column({ type: 'jsonb', default: {} })
  detail!: Record<string, unknown>;

  @Column({ type: 'text', nullable: true })
  error!: string | null;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;

  @Column({ type: 'timestamptz', name: 'started_at', nullable: true })
  startedAt!: Date | null;

  @Column({ type: 'timestamptz', name: 'finished_at', nullable: true })
  finishedAt!: Date | null;
}

export type ImportStage = Readonly<ImportStageEntity>;
