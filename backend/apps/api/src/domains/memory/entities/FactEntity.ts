import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

@Entity({ name: 'facts' })
export class FactEntity {
  @PrimaryColumn('uuid', { name: 'fact_id' })
  id!: string;

  @Column({ type: 'uuid', name: 'fact_owner_id' })
  fact_owner_id!: string;

  @Column({ type: 'jsonb', name: 'fact_statement' })
  fact_statement!: Record<string, unknown>;

  @Column({ type: 'text', name: 'fact_type' })
  fact_type!: string;

  @Column({ type: 'uuid', name: 'original_entity_id', nullable: true })
  original_entity_id!: string | null;

  @Column({ type: 'jsonb', name: 'preserved_relationships', default: '{}' })
  preserved_relationships!: Record<string, unknown>;

  @Column({ type: 'text', name: 'source' })
  source!: string;

  @Column({ type: 'double precision', name: 'confidence_score', default: 1 })
  confidence_score!: number;

  @CreateDateColumn({ type: 'timestamptz', name: 'learned_at' })
  learned_at!: Date;

  @Column({ type: 'timestamptz', name: 'archived_at', nullable: true })
  archived_at!: Date | null;

  @Column({ type: 'boolean', name: 'is_current', default: true })
  is_current!: boolean;

  @Column({ type: 'text', name: 'access_level', default: 'private' })
  access_level!: string;

  static toEgressType(entity: FactEntity): Fact {
    return {
      id: entity.id,
      fact_owner_id: entity.fact_owner_id,
      fact_statement: entity.fact_statement,
      fact_type: entity.fact_type,
      original_entity_id: entity.original_entity_id,
      preserved_relationships: entity.preserved_relationships,
      source: entity.source,
      confidence_score: entity.confidence_score,
      learned_at: entity.learned_at,
      archived_at: entity.archived_at,
      is_current: entity.is_current,
      access_level: entity.access_level,
    };
  }
}

export type Fact = Readonly<FactEntity>;
