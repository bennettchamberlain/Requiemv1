import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v7 as uuidv7 } from 'uuid';

import { type UserServiceContext } from '@ci/common/context';
import { LoggerService } from '@ci/common/logging';

import { assertAskTransition } from '../askStatus';
import { type Ask, AskEntity } from '../entities/AskEntity';
import type { AskStatus, CreateAskDto } from '../types';

/**
 * Owns the {@link AskEntity} lifecycle. Phase 0 delivery is intra-Hub and
 * synchronous, so a created ask is immediately marked `delivered`; the grant
 * decision (auto-answer vs owner review) is applied by the resolver via
 * {@link GrantService}. Every transition is validated against the pure state
 * machine ({@link assertAskTransition}) so no illegal edge is ever persisted.
 */
@Injectable()
export class AskService {
  constructor(
    @InjectRepository(AskEntity)
    private readonly askRepository: Repository<AskEntity>,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(AskService.name);
  }

  /** Create an ask (asker = caller) and mark it delivered to the responder. */
  async create(context: UserServiceContext, data: CreateAskDto): Promise<Ask> {
    if (data.responderUserId === context.userId) {
      throw new BadRequestException('An ask must be directed at another user');
    }

    const record = this.askRepository.create({
      id: data.id ?? uuidv7(),
      askerUserId: context.userId,
      responderUserId: data.responderUserId,
      query: data.query,
      status: assertAskTransition('sent', 'delivered'),
      consentBasis: null,
      expiresAt: data.expiresAt ?? null,
    });

    const entity = await this.askRepository.save(record);

    return AskEntity.toEgressType(entity);
  }

  /** An ask is visible to its asker and its responder only. */
  async findById(context: UserServiceContext, id: string): Promise<Ask | null> {
    const entity = await this.forParticipant(context, id);

    return entity ? AskEntity.toEgressType(entity) : null;
  }

  /** The responder's review inbox: asks awaiting a decision, newest first. */
  async listInbox(context: UserServiceContext): Promise<Ask[]> {
    const rows = await this.askRepository.find({
      where: [
        { responderUserId: context.userId, status: 'delivered' },
        { responderUserId: context.userId, status: 'under_review' },
      ],
      order: { createdAt: 'DESC' },
    });

    return rows.map(AskEntity.toEgressType);
  }

  /** The asker's outbox: asks I have sent, newest first. */
  async listOutbox(context: UserServiceContext): Promise<Ask[]> {
    const rows = await this.askRepository.find({
      where: { askerUserId: context.userId },
      order: { createdAt: 'DESC' },
    });

    return rows.map(AskEntity.toEgressType);
  }

  /**
   * Move an ask along the lifecycle. Only the responder may drive review-side
   * transitions (`under_review` / `answering` / `answered` / `declined`);
   * `expired` may be applied by the sweep. The transition is rejected unless
   * the pure state machine permits it.
   */
  async transition(
    context: UserServiceContext,
    id: string,
    to: AskStatus,
    options: { consentBasis?: string | null } = {},
  ): Promise<Ask> {
    const entity = await this.responderOwned(context, id);
    entity.status = assertAskTransition(entity.status, to);
    if (options.consentBasis !== undefined) {
      entity.consentBasis = options.consentBasis;
    }

    const saved = await this.askRepository.save(entity);

    return AskEntity.toEgressType(saved);
  }

  private async forParticipant(
    context: UserServiceContext,
    id: string,
  ): Promise<AskEntity | null> {
    return this.askRepository.findOne({
      where: [
        { id, askerUserId: context.userId },
        { id, responderUserId: context.userId },
      ],
    });
  }

  private async responderOwned(context: UserServiceContext, id: string): Promise<AskEntity> {
    const entity = await this.askRepository.findOne({
      where: { id, responderUserId: context.userId },
    });
    if (entity == null) {
      throw new NotFoundException(`Ask ${id} not found`);
    }

    return entity;
  }
}
