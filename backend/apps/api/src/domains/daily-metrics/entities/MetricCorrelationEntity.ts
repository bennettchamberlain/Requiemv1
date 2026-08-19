import { Column, Entity, PrimaryColumn } from 'typeorm';

import type { MetricKey } from '../types';

export interface MetricCorrelation {
  id: string;
  userId: string;
  metricA: MetricKey;
  metricB: MetricKey;
  lagDays: number;
  windowDays: number;
  n: number;
  pearson: number | null;
  spearman: number | null;
  mutualInfo: number | null;
  pValue: number | null;
  qValue: number | null;
  effect: number | null;
  robust: boolean;
  novelty: number;
  coverageMean: number | null;
  computedAt: Date;
}

@Entity({ schema: 'ci_derived', name: 'metric_correlations' })
export class MetricCorrelationEntity {
  @PrimaryColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'user_id' })
  userId!: string;

  @Column({ type: 'text', name: 'metric_a' })
  metricA!: string;

  @Column({ type: 'text', name: 'metric_b' })
  metricB!: string;

  @Column({ type: 'int', name: 'lag_days' })
  lagDays!: number;

  @Column({ type: 'int', name: 'window_days' })
  windowDays!: number;

  @Column({ type: 'int' })
  n!: number;

  @Column({ type: 'double precision', nullable: true })
  pearson!: number | null;

  @Column({ type: 'double precision', nullable: true })
  spearman!: number | null;

  @Column({ type: 'double precision', name: 'mutual_info', nullable: true })
  mutualInfo!: number | null;

  @Column({ type: 'double precision', name: 'p_value', nullable: true })
  pValue!: number | null;

  @Column({ type: 'double precision', name: 'q_value', nullable: true })
  qValue!: number | null;

  @Column({ type: 'double precision', nullable: true })
  effect!: number | null;

  @Column({ type: 'boolean', default: false })
  robust!: boolean;

  @Column({ type: 'double precision', default: 1 })
  novelty!: number;

  @Column({ type: 'double precision', name: 'coverage_mean', nullable: true })
  coverageMean!: number | null;

  @Column({ type: 'timestamptz', name: 'computed_at' })
  computedAt!: Date;

  static toEgressType(entity: MetricCorrelationEntity): MetricCorrelation {
    return {
      id: entity.id,
      userId: entity.userId,
      metricA: entity.metricA as MetricKey,
      metricB: entity.metricB as MetricKey,
      lagDays: entity.lagDays,
      windowDays: entity.windowDays,
      n: entity.n,
      pearson: entity.pearson,
      spearman: entity.spearman,
      mutualInfo: entity.mutualInfo,
      pValue: entity.pValue,
      qValue: entity.qValue,
      effect: entity.effect,
      robust: entity.robust,
      novelty: entity.novelty,
      coverageMean: entity.coverageMean,
      computedAt: entity.computedAt,
    };
  }
}
