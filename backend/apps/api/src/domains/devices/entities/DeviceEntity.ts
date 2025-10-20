import {
  Entity,
  PrimaryColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

import { UserEntity } from '@ci/domains/user';

@Entity('devices')
export class DeviceEntity {
  @PrimaryColumn({ type: 'uuid' })
  device_id!: string;

  @Column({ type: 'uuid' })
  user_id!: string;

  @Column({ type: 'uuid', nullable: true })
  device_entity_id?: string;

  // Device identification
  @Column({ type: 'text' })
  device_name!: string;

  @Column({ type: 'text' })
  device_type!: string;

  // Device details
  @Column({ type: 'text', nullable: true })
  platform?: string;

  @Column({ type: 'text', nullable: true })
  model?: string;

  @Column({ type: 'text', nullable: true })
  manufacturer?: string;

  @Column({ type: 'text', nullable: true })
  os_version?: string;

  @Column({ type: 'text', nullable: true })
  app_version?: string;

  // Connection and status
  @Column({ type: 'timestamptz', default: () => 'NOW()' })
  last_seen!: Date;

  @Column({ type: 'boolean', default: true })
  is_active!: boolean;

  @Column({ type: 'boolean', default: false })
  is_primary!: boolean;

  @Column({ type: 'text', nullable: true })
  push_token?: string;

  // Capabilities and permissions
  @Column({ type: 'jsonb', default: '{}' })
  capabilities!: Record<string, unknown>;

  @Column({ type: 'jsonb', default: '{}' })
  privacy_settings!: Record<string, unknown>;

  // Timestamps
  @CreateDateColumn({ type: 'timestamptz' })
  created_at!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at!: Date;

  @ManyToOne(() => UserEntity)
  @JoinColumn({ name: 'user_id' })
  user?: UserEntity | null;

  toDevice(): Device {
    return {
      device_id: this.device_id,
      user_id: this.user_id,
      device_entity_id: this.device_entity_id,
      device_name: this.device_name,
      device_type: this.device_type,
      platform: this.platform,
      model: this.model,
      manufacturer: this.manufacturer,
      os_version: this.os_version,
      app_version: this.app_version,
      last_seen: this.last_seen,
      is_active: this.is_active,
      is_primary: this.is_primary,
      push_token: this.push_token,
      capabilities: this.capabilities,
      privacy_settings: this.privacy_settings,
      created_at: this.created_at,
      updated_at: this.updated_at,
      user: this.user?.toUser(),
    };
  }
}

export interface Device {
  readonly device_id: string;
  readonly user_id: string;
  readonly device_entity_id?: string;
  readonly device_name: string;
  readonly device_type: string;
  readonly platform?: string;
  readonly model?: string;
  readonly manufacturer?: string;
  readonly os_version?: string;
  readonly app_version?: string;
  readonly last_seen: Date;
  readonly is_active: boolean;
  readonly is_primary: boolean;
  readonly push_token?: string;
  readonly capabilities: Record<string, unknown>;
  readonly privacy_settings: Record<string, unknown>;
  readonly created_at: Date;
  readonly updated_at: Date;
  readonly user?: import('@ci/domains/user').User;
}
