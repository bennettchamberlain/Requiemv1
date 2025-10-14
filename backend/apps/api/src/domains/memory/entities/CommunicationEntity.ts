import { Entity, PrimaryColumn, Column } from 'typeorm';

@Entity({ name: 'communications' })
export class CommunicationEntity {
  @PrimaryColumn({ type: 'timestamptz' })
  time!: Date;

  @PrimaryColumn({ type: 'uuid' })
  user_id!: string;

  @PrimaryColumn({ type: 'text' })
  communication_type!: string;

  @Column({ type: 'uuid', nullable: true })
  device_id!: string | null;

  @Column({ type: 'text' })
  direction!: string;

  @Column({ type: 'text', nullable: true })
  thread_id!: string | null;

  @Column({ type: 'uuid', nullable: true })
  from_entity_id!: string | null;

  @Column('uuid', { array: true, nullable: true })
  to_entity_ids!: string[] | null;

  @Column({ type: 'jsonb', default: '{}' })
  participants_metadata!: Record<string, unknown>;

  @Column({ type: 'text', nullable: true })
  subject!: string | null;

  @Column({ type: 'text' })
  content!: string;

  @Column({ type: 'jsonb', default: '[]' })
  attachments!: unknown[];

  @Column({ type: 'integer', nullable: true })
  duration_seconds!: number | null;

  @Column({ type: 'double precision', nullable: true })
  sentiment_score!: number | null;

  @Column({ type: 'double precision', nullable: true })
  importance_score!: number | null;

  @Column({ type: 'double precision', nullable: true })
  urgency_score!: number | null;

  @Column({
    type: 'text',
    nullable: true,
    transformer: {
      to: (v: number[] | null) => (v ? `[${v.join(',')}]` : null),
      from: (v: string | null) => (v ? v.slice(1, -1).split(',').map(Number) : null),
    },
  })
  content_embedding!: number[] | null;

  @Column({ type: 'text', nullable: true })
  category!: string | null;

  @Column({ type: 'text', nullable: true })
  summary!: string | null;

  @Column('text', { array: true, nullable: true })
  tags!: string[] | null;

  @Column({ type: 'text', nullable: true })
  connection_id!: string | null;

  @Column({ type: 'boolean', default: false })
  is_encrypted!: boolean;

  @Column({ type: 'boolean', default: false })
  is_archived!: boolean;
}
