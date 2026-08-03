import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';

import { UserEntity, type User } from '@ci/domains/user';

/**
 * window  — a recurring band to prefer or protect ("Fridays are deep work")
 * cadence — a target frequency ("gym 3x/week")
 * avoid   — an exclusion ("no meetings before 10")
 */
export type RhythmKind = 'window' | 'cadence' | 'avoid';

/** Soft rhythms cost fit score when violated; hard ones veto the slot outright. */
export type RhythmStrength = 'soft' | 'hard';

export type RhythmSource = 'declared' | 'answer';

/**
 * A standing constraint the fit solver optimises against.
 *
 * These are the user's own stated shape of a week. Keeping them explicit and
 * editable is what separates a schedule that proposes from one that nags.
 */
@Entity({ schema: 'ci', name: 'rhythms' })
export class RhythmEntity {
  @PrimaryColumn('uuid', { name: 'rhythm_id' })
  id!: string;

  @Column({ type: 'uuid', name: 'user_id' })
  userId!: string;

  @ManyToOne(() => UserEntity)
  @JoinColumn({ name: 'user_id' })
  user?: UserEntity;

  @Column({ type: 'text' })
  label!: string;

  @Column({ type: 'text' })
  kind!: RhythmKind;

  /** Shape depends on `kind` — see the migration for each variant. */
  @Column({ type: 'jsonb' })
  spec!: Record<string, unknown>;

  @Column({ type: 'text', default: 'soft' })
  strength!: RhythmStrength;

  @Column({ type: 'text', default: 'declared' })
  source!: RhythmSource;

  @Column({ type: 'uuid', name: 'source_answer_id', nullable: true })
  sourceAnswerId!: string | null;

  @Column({ type: 'boolean', default: true })
  active!: boolean;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;

  static toEgressType(entity: RhythmEntity): Rhythm {
    return {
      id: entity.id,
      userId: entity.userId,
      label: entity.label,
      kind: entity.kind,
      spec: entity.spec ?? {},
      strength: entity.strength,
      source: entity.source,
      sourceAnswerId: entity.sourceAnswerId,
      active: entity.active,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    };
  }
}

export type Rhythm = Readonly<Omit<RhythmEntity, 'user'>> & {
  user?: User;
};
