import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

export type PeerTrustTier = 'family' | 'trusted' | 'peer' | 'stranger';
export type PeerLinkStatus = 'pending' | 'active' | 'revoked';

/**
 * `ci.peer_links` — a peer Companion this box exchanges asks with. Each box
 * holds its own links; CI-Portal provides discovery (handle → endpoint +
 * issuer) but never the relationships themselves.
 */
@Entity({ schema: 'ci', name: 'peer_links' })
export class PeerLinkEntity {
  @PrimaryColumn({ type: 'uuid', name: 'id' })
  id!: string;

  @Column({ type: 'uuid', name: 'owner_user_id' })
  ownerUserId!: string;

  @Column({ type: 'text', name: 'peer_handle' })
  peerHandle!: string;

  @Column({ type: 'text', name: 'display_name', nullable: true })
  displayName!: string | null;

  @Column({ type: 'text', name: 'memory_endpoint' })
  memoryEndpoint!: string;

  @Column({ type: 'text', name: 'peer_issuer', nullable: true })
  peerIssuer!: string | null;

  @Column({ type: 'text', name: 'peer_subject', nullable: true })
  peerSubject!: string | null;

  /** The person in the owner's memory graph this peer corresponds to. */
  @Column({ type: 'uuid', name: 'person_entity_id', nullable: true })
  personEntityId!: string | null;

  @Column({ type: 'text', name: 'trust_tier', default: 'peer' })
  trustTier!: PeerTrustTier;

  @Column({ type: 'text', name: 'status', default: 'active' })
  status!: PeerLinkStatus;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;

  @Column({ type: 'timestamptz', name: 'revoked_at', nullable: true })
  revokedAt!: Date | null;

  static toEgressType(entity: PeerLinkEntity): PeerLink {
    return {
      id: entity.id,
      ownerUserId: entity.ownerUserId,
      peerHandle: entity.peerHandle,
      displayName: entity.displayName,
      memoryEndpoint: entity.memoryEndpoint,
      peerIssuer: entity.peerIssuer,
      peerSubject: entity.peerSubject,
      personEntityId: entity.personEntityId,
      trustTier: entity.trustTier,
      status: entity.status,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
      revokedAt: entity.revokedAt,
    };
  }
}

export type PeerLink = Readonly<PeerLinkEntity>;
