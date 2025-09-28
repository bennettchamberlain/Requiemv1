import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToMany,
  ManyToOne,
  JoinColumn,
  JoinTable,
  AfterLoad,
  Repository,
  SelectQueryBuilder,
} from 'typeorm';

import { TagEntity } from '@ci/domains/search';
import { UserEntity } from '@ci/domains/user';

@Entity({ name: 'entities' })
export class PlaceEntity {
  @PrimaryColumn('uuid', { name: 'entity_id' })
  id!: string;

  @Column({ type: 'text', name: 'entity_type', default: 'Location' })
  entity_type!: string;

  @Column({ type: 'text', nullable: true })
  name!: string | null;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ type: 'jsonb', default: '{}' })
  properties!: Record<string, unknown>;

  // Backward compatibility fields - populated from properties JSONB after load
  type!: string | null;

  geo_format!: string | null;

  geolocation!: Record<string, unknown> | null;

  location_boundary!: Record<string, unknown> | null;

  estimated!: boolean | null;

  tracked!: boolean | null;

  uploaded!: boolean | null;

  @AfterLoad()
  loadPropertiesFromJsonb() {
    this.type = (this.properties?.type as string) || null;
    this.geo_format = (this.properties?.geo_format as string) || null;
    this.geolocation = (this.properties?.geolocation as Record<string, unknown>) || null;
    this.location_boundary = (this.properties?.location_boundary as Record<string, unknown>) || null;
    this.estimated = (this.properties?.estimated as boolean) || null;
    this.tracked = (this.properties?.tracked as boolean) || null;
    this.uploaded = (this.properties?.uploaded as boolean) || null;
  }

  // Helper method for creating filtered queries
  static createPlaceQuery(
    repository: Repository<PlaceEntity>,
    alias: string = 'place',
  ): SelectQueryBuilder<PlaceEntity> {
    return repository
      .createQueryBuilder(alias)
      .where(`${alias}.entity_type = :entityType`, { entityType: 'Location' });
  }

  @ManyToOne(() => UserEntity, { nullable: true })
  @JoinColumn({ name: 'user_id' })
  user?: UserEntity;

  @ManyToOne(() => PlaceEntity, { nullable: true })
  @JoinColumn({ name: 'parent_id' })
  parent?: PlaceEntity;

  @ManyToMany(() => TagEntity, { nullable: true })
  @JoinTable({
    name: 'place_tag',
    joinColumn: { name: 'place_id', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'tag_id', referencedColumnName: 'id' },
  })
  tags?: TagEntity[];

  @CreateDateColumn({ type: 'timestamptz' })
  created_at!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at!: Date;
}
