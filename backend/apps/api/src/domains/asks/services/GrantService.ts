import { Injectable, NotFoundException } from '@nestjs/common';
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
    const record = this.grantRepository.create({
      id: data.id ?? uuidv7(),
      ownerUserId: context.userId,
      granteeUserId: data.granteeUserId,
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
    const grants = await this.grantRepository.find({
      where: {
        ownerUserId: ask.responderUserId,
        granteeUserId: ask.askerUserId,
        revokedAt: IsNull(),
      },
    });

    return evaluateGrant(ask.query, grants, now);
  }
}
