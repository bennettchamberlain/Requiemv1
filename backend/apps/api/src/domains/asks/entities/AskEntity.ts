import { Entity, PrimaryColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

import type { AskQuery, AskStatus } from '../types';

/**
 * `ci.asks` — an interpersonal question directed at another user's memory.
 * Distinct from `ci.questions` (descriptive self-analytics): here the asker is
 * not the record owner, so asker and responder are tracked separately.
 */
@Entity({ schema: 'ci', name: 'asks' })
export class AskEntity {
  @PrimaryColumn({ type: 'uuid', name: 'id' })
  id!: string;

  @Column({ type: 'uuid', name: 'asker_user_id' })
  askerUserId!: string;

  @Column({ type: 'uuid', name: 'responder_user_id' })
  responderUserId!: string;

  @Column({ type: 'jsonb', name: 'query' })
  query!: AskQuery;

  @Column({ type: 'text', name: 'status' })
  status!: AskStatus;

  @Column({ type: 'text', name: 'consent_basis', nullable: true })
  consentBasis!: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;

  @Column({ type: 'timestamptz', name: 'expires_at', nullable: true })
  expiresAt!: Date | null;

  static toEgressType(entity: AskEntity): Ask {
    return {
      id: entity.id,
      askerUserId: entity.askerUserId,
      responderUserId: entity.responderUserId,
      query: entity.query,
      status: entity.status,
      consentBasis: entity.consentBasis,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
      expiresAt: entity.expiresAt,
    };
  }
}

export type Ask = Readonly<AskEntity>;
