import { Entity, Column, PrimaryColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';

/** Server-persisted onboarding wizard state; cleared when users.onboarded becomes true. */
export interface OnboardingProgress {
  stepKey: string;
  draft: Record<string, unknown>;
  updatedAt: string;
}

@Entity({ schema: 'ci', name: 'users' })
export class UserEntity {
  @PrimaryColumn()
  id!: string;

  @Column()
  name!: string;

  @Column({ unique: true })
  email!: string;

  @Column()
  password!: string;

  @Column({ type: 'uuid', name: 'entity_id', nullable: true })
  entityId?: string | null;

  @Column()
  onboarded!: boolean;

  /** Set when FTUE completes; drives deferred post-setup jobs (e.g. actions init). */
  @Column({ type: 'timestamptz', name: 'onboarded_at', nullable: true })
  onboardedAt?: Date | null;

  // IANA timezone name (e.g. 'America/New_York'). Drives local-time bucketing in
  // HBPE + the summary service; defaults to 'UTC' at the DB layer.
  @Column({ type: 'text', default: 'UTC' })
  timezone!: string;

  @Column({ type: 'jsonb', name: 'onboarding_progress', nullable: true })
  onboardingProgress?: OnboardingProgress | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  static toEgressType(entity: UserEntity): User {
    return {
      id: entity.id,
      name: entity.name,
      email: entity.email,
      entityId: entity.entityId,
      onboarded: entity.onboarded,
      onboardedAt: entity.onboardedAt ?? null,
      timezone: entity.timezone,
      onboardingProgress: entity.onboardingProgress ?? null,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    };
  }
}

export type User = Readonly<Omit<UserEntity, 'password'>>;
