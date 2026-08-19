import { Entity, PrimaryColumn, Column, CreateDateColumn } from 'typeorm';

import type { AskGrantScope, GrantMode } from '../types';

/**
 * `ci.ask_grants` — standing consent for the ask path. Replaces reliance on the
 * single `saved_searches.is_public` boolean with a per-grantee, per-query-type
 * grant whose `mode` selects the Grant Manager's three-state posture
 * (auto / review / block). Revocable via `revokedAt`.
 */
@Entity({ schema: 'ci', name: 'ask_grants' })
export class AskGrantEntity {
  @PrimaryColumn({ type: 'uuid', name: 'id' })
  id!: string;

  @Column({ type: 'uuid', name: 'owner_user_id' })
  ownerUserId!: string;

  /**
   * The local user this grant is for. Exactly one of `granteeUserId` /
   * `granteePeerLinkId` is set — a grant addresses either a household member
   * or a linked peer Companion.
   */
  @Column({ type: 'uuid', name: 'grantee_user_id', nullable: true })
  granteeUserId!: string | null;

  /** The peer link this grant is for (federated asks). */
  @Column({ type: 'uuid', name: 'grantee_peer_link_id', nullable: true })
  granteePeerLinkId!: string | null;

  @Column({ type: 'text', name: 'query_type' })
  queryType!: string;

  @Column({ type: 'text', name: 'data_class', nullable: true })
  dataClass!: string | null;

  @Column({ type: 'jsonb', name: 'scope', nullable: true })
  scope!: AskGrantScope | null;

  @Column({ type: 'text', name: 'mode', default: 'review' })
  mode!: GrantMode;

  @Column({ type: 'text', name: 'purpose', nullable: true })
  purpose!: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @Column({ type: 'timestamptz', name: 'revoked_at', nullable: true })
  revokedAt!: Date | null;

  static toEgressType(entity: AskGrantEntity): AskGrant {
    return {
      id: entity.id,
      ownerUserId: entity.ownerUserId,
      granteeUserId: entity.granteeUserId,
      granteePeerLinkId: entity.granteePeerLinkId,
      queryType: entity.queryType,
      dataClass: entity.dataClass,
      scope: entity.scope,
      mode: entity.mode,
      purpose: entity.purpose,
      createdAt: entity.createdAt,
      revokedAt: entity.revokedAt,
    };
  }
}

export type AskGrant = Readonly<AskGrantEntity>;
