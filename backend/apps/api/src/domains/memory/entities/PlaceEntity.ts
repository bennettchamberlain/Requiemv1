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
import { UserEntity, type User } from '@ci/domains/user';

@Entity({ schema: 'ci', name: 'entities' })
export class PlaceEntity {
  @PrimaryColumn('uuid', { name: 'entity_id' })
  id!: string;

  @Column({ type: 'text', name: 'entity_type', default: 'Location' })
  entityType!: string;

  @Column({ type: 'text', nullable: true })
  name!: string | null;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ type: 'jsonb', default: '{}' })
  properties!: Record<string, unknown>;

  // Backward compatibility fields - populated from properties JSONB after load
  type!: string | null;

  geoFormat!: string | null;

  geolocation!: Record<string, unknown> | null;

  locationBoundary!: Record<string, unknown> | null;

  estimated!: boolean | null;

  tracked!: boolean | null;

  uploaded!: boolean | null;

  @AfterLoad()
  loadPropertiesFromJsonb() {
    this.type = (this.properties?.type as string) || null;
    this.geoFormat = (this.properties?.geo_format as string) || null;
    this.geolocation = (this.properties?.geolocation as Record<string, unknown>) || null;
    this.locationBoundary = (this.properties?.location_boundary as Record<string, unknown>) || null;
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

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'created_at' })
  updatedAt!: Date;

  static toEgressType(entity: PlaceEntity) {
    return {
      id: entity.id,
      name: entity.name || null,
      entityType: entity.entityType,
      description: entity.description || null,
      type: entity.type || null,
      geoFormat: entity.geoFormat || null,
      geolocation: entity.geolocation || null,
      locationBoundary: entity.locationBoundary || null,
      estimated: entity.estimated || null,
      tracked: entity.tracked || null,
      properties: entity.properties || {},
      uploaded: entity.uploaded || null,
      userId: entity.user?.id || null,
      parentId: entity.parent?.id || null,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    };
  }
}

export type Place = Readonly<Omit<PlaceEntity, 'user' | 'loadPropertiesFromJsonb'>> & {
  user?: User;
};
