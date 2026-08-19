import { Column, Entity, PrimaryColumn } from 'typeorm';

import type { AnomalyDetector, AnomalyDirection } from '../anomaly/anomalyMath';

export interface MetricAnomaly {
  id: string;
  userId: string;
  metric: string;
  date: string;
  detector: AnomalyDetector;
  value: number | null;
  baseline: number | null;
  score: number;
  direction: AnomalyDirection;
  coverage: number;
  metadata: Record<string, unknown>;
  actionId: string | null;
  computedAt: Date;
}

@Entity({ schema: 'ci_derived', name: 'metric_anomalies' })
export class MetricAnomalyEntity {
  @PrimaryColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'user_id' })
  userId!: string;

  @Column({ type: 'text' })
  metric!: string;

  @Column({ type: 'date' })
  date!: string;

  @Column({ type: 'text' })
  detector!: string;

  @Column({ type: 'double precision', nullable: true })
  value!: number | null;

  @Column({ type: 'double precision', nullable: true })
  baseline!: number | null;

  @Column({ type: 'double precision' })
  score!: number;

  @Column({ type: 'text' })
  direction!: string;

  @Column({ type: 'double precision', default: 0 })
  coverage!: number;

  @Column({ type: 'jsonb', default: '{}' })
  metadata!: Record<string, unknown>;

  @Column({ type: 'uuid', name: 'action_id', nullable: true })
  actionId!: string | null;

  @Column({ type: 'timestamptz', name: 'computed_at' })
  computedAt!: Date;

  static toEgressType(entity: MetricAnomalyEntity): MetricAnomaly {
    return {
      id: entity.id,
      userId: entity.userId,
      metric: entity.metric,
      date: entity.date,
      detector: entity.detector as AnomalyDetector,
      value: entity.value,
      baseline: entity.baseline,
      score: entity.score,
      direction: entity.direction as AnomalyDirection,
      coverage: entity.coverage,
      metadata: entity.metadata ?? {},
      actionId: entity.actionId,
      computedAt: entity.computedAt,
    };
  }
}
