import { Entity, Column, CreateDateColumn, PrimaryColumn } from 'typeorm';

@Entity({ schema: 'ci_search', name: 'entity_tag' })
export class EntityTagEntity {
  @PrimaryColumn({ type: 'bigint' })
  id!: string;

  @Column({ name: 'entity_type', type: 'text' })
  entityType!: string;

  @Column({ name: 'entity_id', type: 'uuid' })
  entityId!: string;

  @Column({ name: 'tag_id', type: 'uuid' })
  tagId!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  static toEgressType(entity: EntityTagEntity): EntityTag {
    return {
      entityType: entity.entityType,
      entityId: entity.entityId,
      createdAt: entity.createdAt,
    };
  }
}

export type EntityTag = Readonly<Omit<EntityTagEntity, 'id' | 'tagId'>>;
