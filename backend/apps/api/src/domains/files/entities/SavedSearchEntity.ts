import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';

import { UserEntity, type User } from '@ci/domains/user';

@Entity({ schema: 'ci', name: 'files' })
export class SavedSearchEntity {
  @PrimaryColumn({ type: 'uuid', name: 'id' })
  id!: string;

  @Column({ type: 'text', name: 'name', nullable: true })
  name!: string;

  @Column({ type: 'text', name: 'description', nullable: true })
  description!: string;

  @Column({ type: 'text', name: 'query', nullable: true })
  query!: string;

  @Column({ array: true, type: 'text', name: 'entity_types' })
  entityTypes!: string[];

  @Column({ array: true, type: 'uuid', name: 'tags', nullable: true })
  tags!: string[];

  @ManyToOne(() => UserEntity, {nullable: true})
  @JoinColumn({name: 'user_id' })
  user?: UserEntity;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;

  static toEgressType(entity: SavedSearchEntity): SavedSearch {
    return {
      id: entity.id,
      name: entity.name,
      description: entity.description,
      query: entity.query,
      entityTypes: entity.entityTypes,
      tags: entity.tags,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    };
  }
}

export type SavedSearch = Readonly<Omit<SavedSearchEntity, 'user'>> & {
  user?: User;
};
