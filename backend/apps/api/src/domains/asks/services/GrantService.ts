import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { v7 as uuidv7 } from 'uuid';

import { type UserServiceContext } from '@ci/common/context';
import { LoggerService } from '@ci/common/logging';

import { type Ask } from '../entities/AskEntity';
import { type AskGrant, AskGrantEntity } from '../entities/AskGrantEntity';
import { evaluateGrant } from '../grantMatch';
import type { CreateAskGrantDto, GrantEvaluation } from '../types';

/**
 * Owns standing consent grants and evaluates an incoming ask against them. The
 * decision logic itself is the pure {@link evaluateGrant}; this service only
 * loads the owner-and-grantee-scoped grants and delegates, keeping the
 * security-critical rule unit-testable without a database.
 */
@Injectable()
export class GrantService {
  constructor(
    @InjectRepository(AskGrantEntity)
    private readonly grantRepository: Repository<AskGrantEntity>,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(GrantService.name);
  }

  /** Create a standing grant owned by the caller. */
  async create(context: UserServiceContext, data: CreateAskGrantDto): Promise<AskGrant> {
    // Exactly one grantee kind, mirroring the DB CHECK. Allowing both would let
    // a grant intended for a household member also authorize a peer.
    const hasUser = data.granteeUserId != null;
    const hasPeer = data.granteePeerLinkId != null;
    if (hasUser === hasPeer) {
      throw new BadRequestException('A grant must name exactly one of granteeUserId / granteePeerLinkId');
    }

    const record = this.grantRepository.create({
      id: data.id ?? uuidv7(),
      ownerUserId: context.userId,
      granteeUserId: data.granteeUserId ?? null,
      granteePeerLinkId: data.granteePeerLinkId ?? null,
      queryType: data.queryType,
      dataClass: data.dataClass ?? null,
      scope: data.scope ?? null,
      mode: data.mode ?? 'review',
      purpose: data.purpose ?? null,
      revokedAt: null,
    });
    const entity = await this.grantRepository.save(record);

    return AskGrantEntity.toEgressType(entity);
  }

  /** Revoke a grant (owner-scoped). Idempotent: re-revoking keeps the first time. */
  async revoke(context: UserServiceContext, id: string): Promise<AskGrant> {
    const entity = await this.grantRepository.findOne({
      where: { id, ownerUserId: context.userId },
    });
    if (entity == null) {
      throw new NotFoundException(`Grant ${id} not found`);
    }

    if (entity.revokedAt == null) {
      entity.revokedAt = new Date();
      await this.grantRepository.save(entity);
    }

    return AskGrantEntity.toEgressType(entity);
  }

  /** All active (non-revoked) grants owned by the caller. */
  async listForOwner(context: UserServiceContext): Promise<AskGrant[]> {
    const rows = await this.grantRepository.find({
      where: { ownerUserId: context.userId, revokedAt: IsNull() },
      order: { createdAt: 'DESC' },
    });

    return rows.map(AskGrantEntity.toEgressType);
  }

  /**
   * Decide how a delivered ask should be handled — `auto`, `review`, or `deny` —
   * by evaluating the responder's standing grants for this asker. Review is the
   * default when nothing matches.
   */
  async evaluate(ask: Ask, now: Date = new Date()): Promise<GrantEvaluation> {
    // An inbound peer ask is authorized against grants addressed to its PEER
    // LINK; a local ask against grants addressed to the asking user. Selecting
    // on exactly one of the two keys is what stops a peer from picking up a
    // household member's grants (and vice versa).
    const grantee =
      ask.direction === 'inbound'
        ? { granteePeerLinkId: ask.peerLinkId ?? undefined }
        : { granteeUserId: ask.askerUserId ?? undefined };

    if (Object.values(grantee)[0] == null) {
      // No identifiable asker → no grant can match; fall through to review.
      return evaluateGrant(ask.query, [], now);
    }

    const grants = await this.grantRepository.find({
      where: {
        ownerUserId: ask.responderUserId,
        ...grantee,
        revokedAt: IsNull(),
      },
    });

    return evaluateGrant(ask.query, grants, now);
  }
}
