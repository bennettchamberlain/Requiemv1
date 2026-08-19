import { Entity, PrimaryColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

import type { AskDirection, AskQuery, AskStatus } from '../types';

/**
 * `ci.asks` — an interpersonal question directed at another user's memory.
 * Distinct from `ci.questions` (descriptive self-analytics): here the asker is
 * not the record owner, so asker and responder are tracked separately.
 */
@Entity({ schema: 'ci', name: 'asks' })
export class AskEntity {
  @PrimaryColumn({ type: 'uuid', name: 'id' })
  id!: string;

  /**
   * The local user asking. NULL for an inbound peer ask, where the asker is a
   * peer Companion identified by {@link peerLinkId} instead — minting a shadow
   * local user per peer would let anyone reachable on the Portal accumulate an
   * account on every box they can talk to.
   */
  @Column({ type: 'uuid', name: 'asker_user_id', nullable: true })
  askerUserId!: string | null;

  /** The peer this ask came from (inbound) or was sent to (outbound). */
  @Column({ type: 'uuid', name: 'peer_link_id', nullable: true })
  peerLinkId!: string | null;

  @Column({ type: 'text', name: 'direction', default: 'local' })
  direction!: AskDirection;

  /** NULL for an OUTBOUND ask — the responder is the peer, not a local user. */
  @Column({ type: 'uuid', name: 'responder_user_id', nullable: true })
  responderUserId!: string | null;

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
      peerLinkId: entity.peerLinkId,
      direction: entity.direction,
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
