import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';

import { GraphNodeEntity } from './GraphNodeEntity';

@Entity({ name: 'relationships' })
@Index(['from_entity_id'])
@Index(['to_entity_id'])
@Index(['relationship_type'])
@Index(['from_entity_id', 'to_entity_id', 'is_bidirectional'])
export class RelationshipEntity {
  @PrimaryColumn('uuid')
  relationship_id!: string;

  @Column({ type: 'uuid' })
  from_entity_id!: string;

  @Column({ type: 'uuid' })
  to_entity_id!: string;

  @Column({ type: 'text' })
  relationship_type!: string;

  @Column({ type: 'double precision', default: 1.0 })
  strength!: number;

  @Column({ type: 'jsonb', default: '{}' })
  properties!: Record<string, unknown>;

  @Column({ type: 'boolean', default: false })
  is_bidirectional!: boolean;

  @Column({ type: 'boolean', default: true })
  is_active!: boolean;

  @Column({ type: 'date', nullable: true })
  start_date!: Date | null;

  @Column({ type: 'date', nullable: true })
  end_date!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at!: Date;

  @ManyToOne(() => GraphNodeEntity)
  @JoinColumn({ name: 'from_entity_id' })
  from_entity?: GraphNodeEntity;

  @ManyToOne(() => GraphNodeEntity)
  @JoinColumn({ name: 'to_entity_id' })
  to_entity?: GraphNodeEntity;
}
