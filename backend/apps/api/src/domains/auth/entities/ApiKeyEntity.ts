import {
  Entity,
  Column,
  PrimaryColumn,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

import { UserEntity } from '@ci/domains/user';

@Entity({ schema: 'ci', name: 'api_keys' })
export class ApiKeyEntity {
  @PrimaryColumn('uuid')
  id!: string;

  @Column({ type: 'text' })
  name!: string;

  @Column({ type: 'text' })
  prefix!: string;

  @Column({ type: 'text' })
  hashed_key!: string;

  @Column({ type: 'text', array: true, default: '{}' })
  scopes!: string[];

  @Column({ type: 'timestamptz', nullable: true })
  expires_at!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  last_used_at!: Date | null;

  @ManyToOne(() => UserEntity)
  @JoinColumn({ name: 'user_id' })
  user?: UserEntity;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at!: Date;

  static toEgressType(entity: ApiKeyEntity): ApiKey {
    return {
      id: entity.id,
      name: entity.name,
      prefix: entity.prefix,
      scopes: entity.scopes,
      expires_at: entity.expires_at,
      last_used_at: entity.last_used_at,
      created_at: entity.created_at,
      updated_at: entity.updated_at,
    };
  }
}

export type ApiKey = Readonly<Omit<ApiKeyEntity, 'user' | 'hashed_key'>>;
