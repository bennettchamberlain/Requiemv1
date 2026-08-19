import { Entity, Column, CreateDateColumn, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';

import { TagEntity } from './TagEntity';

@Entity({ schema: 'ci_search', name: 'entity_tag' })
export class EntityTagEntity {
  @PrimaryColumn({ type: 'bigint' })
  id!: string;

  @Column({ name: 'entity_type', type: 'text' })
  entityType!: string;

  @Column({ name: 'entity_id', type: 'uuid' })
  entityId!: string;

  // Indexed on its own (entity_tag_tag_id_idx): the unique constraint leads
  // with (entity_type, entity_id), so it cannot serve the tag-keyed reads and
  // the rename/delete rewrites. See migration 20260819013739.
  @Index('entity_tag_tag_id_idx')
  @Column({ name: 'tag_id', type: 'uuid' })
  tagId!: string;

  @ManyToOne(() => TagEntity, (tag) => tag.entities)
  @JoinColumn({ name: 'tag_id' })
  tag?: TagEntity;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  static toEgressType(entity: EntityTagEntity): EntityTag {
    return {
      entityType: entity.entityType,
      entityId: entity.entityId,
      taggedAt: entity.createdAt,
    };
  }
}

export type EntityTag = Readonly<
  Omit<EntityTagEntity, 'id' | 'tagId' | 'createdAt'> & {
    taggedAt: Date;
  }
>;
