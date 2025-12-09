import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToMany,
  ManyToOne,
  JoinTable,
  JoinColumn,
  AfterLoad,
} from 'typeorm';

import { TagEntity } from '@ci/domains/search';
import { UserEntity } from '@ci/domains/user';

@Entity({ name: 'entities' })
export class PersonEntity {
  @PrimaryColumn('uuid', { name: 'entity_id' })
  id!: string;

  @Column({ type: 'text', name: 'entity_type', default: 'Person' })
  entity_type!: string;

  @Column({ type: 'text', nullable: true })
  name!: string | null;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ type: 'jsonb', default: '{}' })
  properties!: Record<string, unknown>;

  @Column({ type: 'text', nullable: true })
  search_content!: string | null;

  @Column({ type: 'text', nullable: false })
  linked_id!: string;

  @Column({ type: 'text', nullable: false })
  linked_table!: string;

  @ManyToOne(() => UserEntity, { nullable: true })
  @JoinColumn({ name: 'owner_user_id' })
  user?: UserEntity;

  // Backward compatibility fields - populated from properties JSONB after load
  type!: string | null;

  first_name!: string | null;

  last_name!: string | null;

  gender!: string | null;

  address!: string | null;

  street_address!: string | null;

  street_address_2!: string | null;

  city!: string | null;

  region!: string | null;

  country!: string | null;

  postal_code!: string | null;

  avatar_url!: string | null;

  external_id!: string | null;

  source_url!: string | null;

  source_data!: Record<string, unknown> | null;

  @AfterLoad()
  loadPropertiesFromJsonb() {
    this.type = (this.properties?.type as string) || null;
    this.first_name = (this.properties?.first_name as string) || null;
    this.last_name = (this.properties?.last_name as string) || null;
    this.gender = (this.properties?.gender as string) || null;
    this.address = (this.properties?.address as string) || null;
    this.street_address = (this.properties?.street_address as string) || null;
    this.street_address_2 = (this.properties?.street_address_2 as string) || null;
    this.city = (this.properties?.city as string) || null;
    this.region = (this.properties?.region as string) || null;
    this.country = (this.properties?.country as string) || null;
    this.postal_code = (this.properties?.postal_code as string) || null;
    this.avatar_url = (this.properties?.avatar_url as string) || null;
    this.external_id = (this.properties?.external_id as string) || null;
    this.source_url = (this.properties?.source_url as string) || null;
    this.source_data = (this.properties?.source_data as Record<string, unknown>) || null;
  }

  @ManyToMany(() => TagEntity, { nullable: true })
  @JoinTable({
    name: 'person_tag',
    joinColumn: { name: 'person_id', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'tag_id', referencedColumnName: 'id' },
  })
  tags?: TagEntity[];

  @CreateDateColumn({ type: 'timestamptz' })
  created_at!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at!: Date;

  @Column({ type: 'timestamptz', default: () => 'NOW()' })
  last_accessed!: Date;

  static toEgressType(entity: PersonEntity): Person {
    return {
      id: entity.id,
      entity_type: entity.entity_type,
      name: entity.name,
      description: entity.description,
      properties: entity.properties,
      first_name: entity.first_name,
      last_name: entity.last_name,
      type: entity.type,
      gender: entity.gender,
      address: entity.address,
      street_address: entity.street_address,
      street_address_2: entity.street_address_2,
      city: entity.city,
      region: entity.region,
      country: entity.country,
      postal_code: entity.postal_code,
      avatar_url: entity.avatar_url,
      external_id: entity.external_id,
      source_url: entity.source_url,
      source_data: entity.source_data,
      search_content: entity.search_content,
      linked_id: entity.linked_id,
      linked_table: entity.linked_table,
      created_at: entity.created_at,
      updated_at: entity.updated_at,
      last_accessed: entity.last_accessed,
    };
  }
}

export type Person = Readonly<Omit<PersonEntity, 'user' | 'tags' | 'loadPropertiesFromJsonb'>>;
