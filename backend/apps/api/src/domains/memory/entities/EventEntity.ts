import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Point,
} from 'typeorm';

import { UserEntity } from '@ci/domains/user';

@Entity({ name: 'events' })
export class EventEntity {
  @PrimaryColumn('uuid', { name: 'event_id' })
  id!: string;

  @Column({ type: 'text' })
  title!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ type: 'text', nullable: true })
  event_type!: string | null;

  @Column({ type: 'text', nullable: true })
  category!: string | null;

  @Column({ type: 'timestamptz' })
  start_time!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  end_time!: Date | null;

  @Column({ type: 'integer', nullable: true, insert: false, update: false })
  duration_minutes!: number | null;

  @Column({ type: 'text', nullable: true })
  location_name!: string | null;

  @Column({ type: 'uuid', nullable: true })
  event_entity_id!: string | null;

  @Column({
    type: 'geography',
    nullable: true,
    srid: 4326,
    spatialFeatureType: 'Point',
  })
  location_coordinates!: Point | null;

  @Column({ type: 'uuid', nullable: true })
  location_entity_id!: string | null;

  @Column('uuid', { array: true, nullable: true })
  participant_entity_ids!: string[] | null;

  @Column({ type: 'uuid', nullable: true })
  organizer_entity_id!: string | null;

  @Column({ type: 'text', nullable: true })
  source_type!: string | null;

  @Column({ type: 'text', nullable: true })
  source_system!: string | null;

  @Column({ type: 'text', nullable: true })
  source_id!: string | null;

  @Column({ type: 'double precision', default: 1.0 })
  confidence_score!: number;

  @Column({ type: 'boolean', default: false })
  is_recurring!: boolean;

  @Column({ type: 'jsonb', nullable: true })
  recurrence_pattern!: Record<string, unknown> | null;

  @Column({ type: 'boolean', default: false })
  is_all_day!: boolean;

  @Column({ type: 'boolean', default: false })
  is_private!: boolean;

  @Column({ type: 'integer', default: 0 })
  priority!: number;

  @Column({ type: 'jsonb', default: '{}' })
  metadata!: Record<string, unknown>;

  @Column({ type: 'boolean', default: false })
  is_predicted!: boolean;

  @Column({ type: 'boolean', default: false })
  is_inferred!: boolean;

  @Column({ type: 'text', nullable: true })
  prediction_model!: string | null;

  @Column({ type: 'jsonb', default: '{}' })
  inference_sources!: Record<string, unknown>;

  @Column('text', { array: true, nullable: true })
  tags!: string[] | null;

  @Column({ type: 'double precision', nullable: true })
  sentiment_score!: number | null;

  @Column({ type: 'integer', nullable: true })
  energy_level!: number | null;

  @Column({ type: 'double precision', nullable: true })
  productivity_impact!: number | null;

  @Column({ type: 'text', default: 'confirmed' })
  status!: string;

  @Column({ type: 'boolean', default: false })
  is_deleted!: boolean;

  @Column({ type: 'text', nullable: true })
  external_sync_status!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  last_synced_at!: Date | null;

  @Column({ type: 'uuid', nullable: true })
  parent_event_id!: string | null;

  @Column('uuid', { array: true, nullable: true })
  related_event_ids!: string[] | null;

  @Column({ type: 'uuid', nullable: true })
  supersedes_event_id!: string | null;

  @Column({ type: 'text', nullable: true })
  created_by!: string | null;

  @ManyToOne(() => UserEntity)
  @JoinColumn({ name: 'user_id' })
  user?: UserEntity;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at!: Date;

  toEvent() {
    return {
      id: this.id,
      title: this.title,
      description: this.description,
      event_type: this.event_type,
      category: this.category,
      start_time: this.start_time,
      end_time: this.end_time,
      duration_minutes: this.duration_minutes,
      location_name: this.location_name,
      event_entity_id: this.event_entity_id,
      location_coordinates: this.location_coordinates,
      location_entity_id: this.location_entity_id,
      participant_entity_ids: this.participant_entity_ids,
      organizer_entity_id: this.organizer_entity_id,
      source_type: this.source_type,
      source_system: this.source_system,
      source_id: this.source_id,
      confidence_score: this.confidence_score,
      is_recurring: this.is_recurring,
      recurrence_pattern: this.recurrence_pattern,
      is_all_day: this.is_all_day,
      is_private: this.is_private,
      priority: this.priority,
      metadata: this.metadata,
      is_predicted: this.is_predicted,
      is_inferred: this.is_inferred,
      prediction_model: this.prediction_model,
      inference_sources: this.inference_sources,
      tags: this.tags,
      sentiment_score: this.sentiment_score,
      energy_level: this.energy_level,
      productivity_impact: this.productivity_impact,
      status: this.status,
      is_deleted: this.is_deleted,
      external_sync_status: this.external_sync_status,
      last_synced_at: this.last_synced_at,
      parent_event_id: this.parent_event_id,
      related_event_ids: this.related_event_ids,
      supersedes_event_id: this.supersedes_event_id,
      created_by: this.created_by,
      user_id: this.user?.id,
      created_at: this.created_at,
      updated_at: this.updated_at,
    };
  }
}
