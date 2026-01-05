import { Entity, PrimaryColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

export interface ProviderEndpoint {
  name: string;
  description: string;
}

export interface ProviderTheme {
  backgroundColor: string | null;
  borderColor: string | null;
}

@Entity({ schema: 'ci', name: 'providers' })
export class ProviderEntity {
  @PrimaryColumn({ type: 'uuid' })
  id!: string;

  @Column({ type: 'text', nullable: true })
  name!: string | null;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ type: 'jsonb', default: [] })
  endpoints!: ProviderEndpoint[];

  @Column({ type: 'text', name: 'logo_url', nullable: true })
  logoUrl!: string | null;

  @Column({ type: 'jsonb', default: '{}' })
  theme!: ProviderTheme;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;

  static toEgressType(entity: ProviderEntity): Provider {
    return {
      id: entity.id,
      name: entity.name ?? null,
      description: entity.description ?? null,
      endpoints: entity.endpoints,
      logoUrl: entity.logoUrl ?? null,
      theme: {
        backgroundColor: entity.theme.backgroundColor ?? null,
        borderColor: entity.theme.borderColor ?? null,
      },
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    };
  }
}

export type Provider = Readonly<ProviderEntity>;
