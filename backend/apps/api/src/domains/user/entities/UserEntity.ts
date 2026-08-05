import { Entity, Column, PrimaryColumn, CreateDateColumn, UpdateDateColumn, DeleteDateColumn } from 'typeorm';

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

  /**
   * Set when the user requests account deletion; the hard purge happens later in the
   * background (see the migration for why a hard delete is impossible today).
   *
   * `@DeleteDateColumn` is doing real work here, not just recording a date: TypeORM
   * excludes soft-deleted rows from EVERY read on this repository unless a query opts
   * in with `withDeleted: true`. That is the access gate. Auth resolves users through
   * exactly three UserService methods — `findById` (JwtStrategy + ApiKeyStrategy),
   * `validatePassword` (login) and `findByEmail` (OIDC/portal) — and all of them
   * inherit the filter for free, so a deleted account authenticates nowhere and no
   * future auth path can forget the check. Anything that must see deleted rows (the
   * purge job; email-uniqueness checks) has to say so explicitly.
   */
  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt?: Date | null;

  /** Earliest time the background purge may hard-delete this account's data. */
  @Column({ type: 'timestamptz', name: 'purge_after', nullable: true })
  purgeAfter?: Date | null;

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

// Deletion state is internal: callers never see a soft-deleted user (the repository
// filters them out), so exposing `deletedAt`/`purgeAfter` on the egress type would be
// describing a state its consumers can never observe.
export type User = Readonly<Omit<UserEntity, 'password' | 'deletedAt' | 'purgeAfter'>>;
