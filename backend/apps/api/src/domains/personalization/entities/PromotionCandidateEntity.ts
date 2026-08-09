import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

import type { PromotionCandidateKind, PromotionCandidateStatus } from '../types';

@Entity({ schema: 'ci', name: 'promotion_candidates' })
export class PromotionCandidateEntity {
  @PrimaryColumn({ type: 'uuid', name: 'promotion_candidate_id' })
  id!: string;

  @Column({ type: 'uuid', name: 'user_id' })
  userId!: string;

  @Column({ type: 'text', name: 'kind' })
  kind!: PromotionCandidateKind;

  @Column({ type: 'jsonb', default: '{}' })
  payload!: Record<string, unknown>;

  @Column({ type: 'double precision', default: 0 })
  confidence!: number;

  @Column({ type: 'jsonb', default: '[]', name: 'evidence' })
  evidence!: unknown[];

  @Column({ type: 'text', default: 'pending' })
  status!: PromotionCandidateStatus;

  @Column({ type: 'text', nullable: true, name: 'source_job' })
  sourceJob!: string | null;

  @Column({ type: 'boolean', default: true, name: 'requires_user_input' })
  requiresUserInput!: boolean;

  @Column({ type: 'text', nullable: true, name: 'review_prompt' })
  reviewPrompt!: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;
}

export type PromotionCandidate = Readonly<
  Omit<PromotionCandidateEntity, 'createdAt' | 'updatedAt'>
> & {
  createdAt: Date;
  updatedAt: Date;
};
