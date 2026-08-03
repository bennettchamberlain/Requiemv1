import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { v7 as uuidv7 } from 'uuid';

import { type UserServiceContext } from '@ci/common/context';
import { LoggerService } from '@ci/common/logging';

import {
  type PeerLink,
  PeerLinkEntity,
  type PeerLinkStatus,
  type PeerTrustTier,
} from '../entities/PeerLinkEntity';

export interface CreatePeerLinkDto {
  peerHandle: string;
  memoryEndpoint: string;
  displayName?: string | null;
  peerIssuer?: string | null;
  peerSubject?: string | null;
  personEntityId?: string | null;
  trustTier?: PeerTrustTier;
  status?: PeerLinkStatus;
}

/**
 * Owns the local half of the trust graph: which peers this box knows, how much
 * it trusts them, and which person in the owner's memory each one is.
 */
@Injectable()
export class PeerLinkService {
  constructor(
    @InjectRepository(PeerLinkEntity)
    private readonly repository: Repository<PeerLinkEntity>,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(PeerLinkService.name);
  }

  /** Link a peer (idempotent on (owner, handle) — re-linking refreshes it). */
  async upsert(context: UserServiceContext, data: CreatePeerLinkDto): Promise<PeerLink> {
    const existing = await this.repository.findOne({
      where: { ownerUserId: context.userId, peerHandle: data.peerHandle },
    });

    const record = this.repository.create({
      ...(existing ?? { id: uuidv7(), ownerUserId: context.userId, peerHandle: data.peerHandle }),
      memoryEndpoint: data.memoryEndpoint,
      displayName: data.displayName ?? existing?.displayName ?? null,
      peerIssuer: data.peerIssuer ?? existing?.peerIssuer ?? null,
      peerSubject: data.peerSubject ?? existing?.peerSubject ?? null,
      personEntityId: data.personEntityId ?? existing?.personEntityId ?? null,
      trustTier: data.trustTier ?? existing?.trustTier ?? 'peer',
      status: data.status ?? existing?.status ?? 'active',
      revokedAt: null,
    });

    return PeerLinkEntity.toEgressType(await this.repository.save(record));
  }

  async findAll(context: UserServiceContext): Promise<PeerLink[]> {
    const rows = await this.repository.find({ where: { ownerUserId: context.userId } });

    return rows.map(PeerLinkEntity.toEgressType);
  }

  async findByHandle(context: UserServiceContext, handle: string): Promise<PeerLink | null> {
    const row = await this.repository.findOne({
      where: { ownerUserId: context.userId, peerHandle: handle },
    });

    return row ? PeerLinkEntity.toEgressType(row) : null;
  }

  /**
   * Attribute an INBOUND ask to a known peer by the OIDC identity that signed
   * it. Only active links match — a revoked peer is indistinguishable from an
   * unknown one, which is what makes revocation immediate and total.
   */
  async findActiveByIssuerSubject(
    ownerUserId: string,
    issuer: string,
    subject: string,
  ): Promise<PeerLink | null> {
    const row = await this.repository.findOne({
      where: {
        ownerUserId,
        peerIssuer: issuer,
        peerSubject: subject,
        status: 'active',
        revokedAt: IsNull(),
      },
    });

    return row ? PeerLinkEntity.toEgressType(row) : null;
  }

  /**
   * All ACTIVE links across this box matching a peer's OIDC identity. An
   * inbound ask is addressed to the box, so this is how it is routed to the
   * right responder. Returning a list (rather than one row) keeps the
   * multi-user household case explicit: the caller must disambiguate rather
   * than silently answering as an arbitrary member.
   */
  async findActiveByPeerIdentity(issuer: string, subject: string): Promise<PeerLink[]> {
    const rows = await this.repository.find({
      where: { peerIssuer: issuer, peerSubject: subject, status: 'active', revokedAt: IsNull() },
    });

    return rows.map(PeerLinkEntity.toEgressType);
  }

  /** Revoke a peer link — takes effect on the next inbound ask. */
  async revoke(context: UserServiceContext, handle: string): Promise<PeerLink> {
    const row = await this.repository.findOne({
      where: { ownerUserId: context.userId, peerHandle: handle },
    });

    if (row == null) {
      throw new NotFoundException(`Peer ${handle} not found`);
    }

    row.status = 'revoked';
    row.revokedAt = new Date();
    this.logger.log(`peer link revoked: ${handle}`);

    return PeerLinkEntity.toEgressType(await this.repository.save(row));
  }
}
