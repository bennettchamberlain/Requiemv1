import { Column, Entity, PrimaryColumn } from 'typeorm';

export interface SuggestionEvidence {
  metric: string;
  windowDays: number;
  baseline: number;
  current: number;
  gap: number;
  sources: string[];
}

export interface MetricSuggestion {
  id: string;
  userId: string;
  key: string;
  title: string;
  text: string;
  priority: number | null;
  correlationId: string | null;
  anomalyId: string | null;
  evidence: SuggestionEvidence;
  actionId: string | null;
  acceptedAt: Date | null;
  dismissedAt: Date | null;
  computedAt: Date;
}

@Entity({ schema: 'ci_derived', name: 'metric_suggestions' })
export class MetricSuggestionEntity {
  @PrimaryColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'user_id' })
  userId!: string;

  @Column({ type: 'text' })
  key!: string;

  @Column({ type: 'text' })
  title!: string;

  @Column({ type: 'text' })
  text!: string;

  @Column({ type: 'int', nullable: true })
  priority!: number | null;

  @Column({ type: 'uuid', name: 'correlation_id', nullable: true })
  correlationId!: string | null;

  @Column({ type: 'uuid', name: 'anomaly_id', nullable: true })
  anomalyId!: string | null;

  @Column({ type: 'jsonb' })
  evidence!: SuggestionEvidence;

  @Column({ type: 'uuid', name: 'action_id', nullable: true })
  actionId!: string | null;

  @Column({ type: 'timestamptz', name: 'accepted_at', nullable: true })
  acceptedAt!: Date | null;

  @Column({ type: 'timestamptz', name: 'dismissed_at', nullable: true })
  dismissedAt!: Date | null;

  @Column({ type: 'timestamptz', name: 'computed_at' })
  computedAt!: Date;

  static toEgressType(entity: MetricSuggestionEntity): MetricSuggestion {
    return {
      id: entity.id,
      userId: entity.userId,
      key: entity.key,
      title: entity.title,
      text: entity.text,
      priority: entity.priority,
      correlationId: entity.correlationId,
      anomalyId: entity.anomalyId,
      evidence: entity.evidence,
      actionId: entity.actionId,
      acceptedAt: entity.acceptedAt,
      dismissedAt: entity.dismissedAt,
      computedAt: entity.computedAt,
    };
  }
}
