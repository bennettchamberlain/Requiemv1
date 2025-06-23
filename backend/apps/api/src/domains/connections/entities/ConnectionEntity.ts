import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';

import { UserEntity } from '@ci/domains/user';
import { ProviderEntity } from '@ci/domains/providers';

import type { Connection } from '../types';

@Entity({ name: 'connections' })
export class ConnectionEntity {
  @PrimaryColumn({ type: 'uuid' })
  id!: string;

  @Column({ type: 'text', nullable: true })
  name!: string | null;

  @Column({ type: 'boolean', default: true })
  active!: boolean;

  @ManyToOne(() => UserEntity)
  @JoinColumn({ name: 'user_id' })
  user?: UserEntity;

  @ManyToOne(() => ProviderEntity)
  @JoinColumn({ name: 'provider_id' })
  provider?: ProviderEntity;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at!: Date;

  toConnection(): Connection {
    return {
      id: this.id,
      name: this.name ?? null,
      active: this.active,
      provider: this.provider?.toProvider(),
    } satisfies Connection;
  }
}
