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

import type { Connection } from '../types';

import { ProviderEntity } from './ProviderEntity';

@Entity({ schema: 'ci_core', name: 'connections' })
export class ConnectionEntity {
  @PrimaryColumn({ type: 'uuid' })
  id!: string;

  @Column({ type: 'text', nullable: true })
  name!: string | null;

  @Column({ type: 'boolean', default: true })
  active!: boolean;

  @Column({ type: 'text', nullable: true })
  schedule!: string | null;

  @Column({ type: 'text', nullable: true, name: 'access_token' })
  accessToken!: string | null;

  @Column({ type: 'text', nullable: true, name: 'refresh_token' })
  refreshToken!: string | null;

  @Column({ type: 'timestamptz', nullable: true, name: 'token_expiry' })
  tokenExpiry!: Date | null;

  @Column({ type: 'jsonb', nullable: true, name: 'sync_state' })
  syncState!: Record<string, unknown> | null;

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
      schedule: this.schedule ?? null,
      accessToken: this.accessToken ?? null,
      refreshToken: this.refreshToken ?? null,
      tokenExpiry: this.tokenExpiry ?? null,
      syncState: this.syncState ?? null,
      provider: this.provider?.toProvider(),
    } satisfies Connection;
  }
}
