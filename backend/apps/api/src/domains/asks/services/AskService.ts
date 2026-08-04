import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v7 as uuidv7 } from 'uuid';

import { type UserServiceContext } from '@ci/common/context';
import { LoggerService } from '@ci/common/logging';

import { assertAskTransition } from '../askStatus';
import { type Ask, AskEntity } from '../entities/AskEntity';
import type { AskStatus, CreateAskDto, GrantDecision } from '../types';

import { AskAuditService } from './AskAuditService';
import { GrantService } from './GrantService';

/**
 * Owns the {@link AskEntity} lifecycle and the submit orchestration that ties
 * the ask, the consent grants, and the audit log together.
 *
 * Phase 0 delivery is intra-Hub and synchronous, so a created ask is immediately
 * marked `delivered`; {@link submit} then evaluates the responder's standing
 * grants and routes the ask (auto-answer / owner review / auto-deny). Every
 * transition is validated against the pure state machine
 * ({@link assertAskTransition}) so no illegal edge is ever persisted.
 *
 * NOTE (Phase 0 scope): the `auto` and owner-`approve` paths move an ask to
 * `answering` but do not yet PRODUCE an answer — the run-as-owner executor
 * (`runAsk`, task #1719) and the disclosure filter (Phase 1) complete them and
 * write the terminal `answered` audit. The `deny` (block) and owner-`decline`
 * paths are fully terminal here and are audited.
 */
@Injectable()
export class AskService {
  constructor(
    @InjectRepository(AskEntity)
    private readonly askRepository: Repository<AskEntity>,
    private readonly grantService: GrantService,
    private readonly auditService: AskAuditService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(AskService.name);
  }

  /** Create an ask (asker = caller) and mark it delivered to the responder. */
  async create(context: UserServiceContext, data: CreateAskDto): Promise<Ask> {
    const direction = data.direction ?? 'local';
    const isInbound = direction === 'inbound';

    if (isInbound && !data.peerLinkId) {
      throw new BadRequestException('An inbound ask must carry its peer link');
    }

    // A local ask must be directed at someone else. An inbound peer ask has no
    // local asker at all, so the self-ask guard does not apply to it.
    if (!isInbound && data.responderUserId === context.userId) {
      throw new BadRequestException('An ask must be directed at another user');
    }

    const record = this.askRepository.create({
      id: data.id ?? uuidv7(),
      askerUserId: isInbound ? null : context.userId,
      peerLinkId: data.peerLinkId ?? null,
      direction,
      responderUserId: data.responderUserId,
      query: data.query,
      status: assertAskTransition('sent', 'delivered'),
      consentBasis: null,
      expiresAt: data.expiresAt ?? null,
    });

    const entity = await this.askRepository.save(record);

    return AskEntity.toEgressType(entity);
  }

  /**
   * Create an ask and apply the standing-grant decision:
   * - `deny` (a matching `block` grant) → immediately declined + audited;
   * - `auto` (a matching `auto` grant) → left `delivered` with the grant recorded
   *   as the consent basis, for the run-as-owner executor to answer (#1719);
   * - `review` (no matching grant, or a `review` grant) → moved to the owner's
   *   review inbox (`under_review`).
   *
   * Returns the resulting ask and the decision so the caller can surface it.
   */
  async submit(
    context: UserServiceContext,
    data: CreateAskDto,
  ): Promise<{ ask: Ask; decision: GrantDecision }> {
    const ask = await this.create(context, data);
    const evaluation = await this.grantService.evaluate(ask);

    if (evaluation.decision === 'deny') {
      const declined = await this.systemTransition(ask.id, 'declined', {
        consentBasis: evaluation.grantId ?? null,
      });
      await this.auditService.record({
        askId: ask.id,
        askerUserId: ask.askerUserId,
        responderUserId: ask.responderUserId,
        query: ask.query,
        consentBasis: evaluation.grantId ?? null,
        outcome: 'declined',
      });

      return { ask: declined, decision: 'deny' };
    }

    if (evaluation.decision === 'auto') {
      const preAuthorized = await this.setConsentBasis(ask.id, evaluation.grantId ?? null);

      return { ask: preAuthorized, decision: 'auto' };
    }

    const inboxed = await this.systemTransition(ask.id, 'under_review');

    return { ask: inboxed, decision: 'review' };
  }

  /** Owner approves a pending ask → `answering` (the executor completes it). */
  async approve(context: UserServiceContext, id: string): Promise<Ask> {
    return this.transition(context, id, 'answering');
  }

  /** Owner declines a pending ask → `declined`, and records the audit row. */
  async decline(context: UserServiceContext, id: string): Promise<Ask> {
    const declined = await this.transition(context, id, 'declined');
    await this.auditService.record({
      askId: declined.id,
      askerUserId: declined.askerUserId,
      responderUserId: declined.responderUserId,
      query: declined.query,
      consentBasis: declined.consentBasis,
      outcome: 'declined',
    });

    return declined;
  }

  /**
   * Finalize an answerable ask (owner-approved `answering`, or auto-authorized
   * `delivered` with a consent basis) into `answered`, recording the terminal
   * audit with the disclosed entity ids. Responder-scoped. An auto-authorized
   * ask is first advanced `delivered → answering` so the lifecycle is honored.
   */
  async complete(context: UserServiceContext, id: string, disclosedEntityIds: string[]): Promise<Ask> {
    const entity = await this.responderOwned(context, id);

    const isAuto = entity.status === 'delivered' && entity.consentBasis != null;
    if (entity.status !== 'answering' && !isAuto) {
      throw new BadRequestException(`Ask ${id} is not ready to answer (status: ${entity.status})`);
    }

    if (entity.status === 'delivered') {
      entity.status = assertAskTransition(entity.status, 'answering');
    }

    entity.status = assertAskTransition(entity.status, 'answered');
    const saved = await this.askRepository.save(entity);

    await this.auditService.record({
      askId: saved.id,
      askerUserId: saved.askerUserId,
      responderUserId: saved.responderUserId,
      query: saved.query,
      consentBasis: saved.consentBasis,
      outcome: isAuto ? 'auto_answered' : 'answered',
      disclosedEntities: disclosedEntityIds,
    });

    return AskEntity.toEgressType(saved);
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
   * Move an ask along the lifecycle as the RESPONDER. Only the responder may
   * drive review-side transitions; the transition is rejected unless the pure
   * state machine permits it.
   */
  async transition(
    context: UserServiceContext,
    id: string,
    to: AskStatus,
    options: { consentBasis?: string | null } = {},
  ): Promise<Ask> {
    const entity = await this.responderOwned(context, id);

    return this.applyTransition(entity, to, options);
  }

  /**
   * System-initiated transition (auto-decision / expiry sweep), NOT owner-scoped.
   * Callers must ensure the action is genuinely system-initiated — it is only
   * used internally by {@link submit} and the expiry sweep, never from a request
   * handler on behalf of a user.
   */
  async systemTransition(
    id: string,
    to: AskStatus,
    options: { consentBasis?: string | null } = {},
  ): Promise<Ask> {
    const entity = await this.byId(id);

    return this.applyTransition(entity, to, options);
  }

  /** Set the consent basis on an ask without changing its status (system-only). */
  async setConsentBasis(id: string, consentBasis: string | null): Promise<Ask> {
    const entity = await this.byId(id);
    entity.consentBasis = consentBasis;
    const saved = await this.askRepository.save(entity);

    return AskEntity.toEgressType(saved);
  }

  private async applyTransition(
    entity: AskEntity,
    to: AskStatus,
    options: { consentBasis?: string | null },
  ): Promise<Ask> {
    entity.status = assertAskTransition(entity.status, to);
    if (options.consentBasis !== undefined) {
      entity.consentBasis = options.consentBasis;
    }

    const saved = await this.askRepository.save(entity);

    return AskEntity.toEgressType(saved);
  }

  private async forParticipant(context: UserServiceContext, id: string): Promise<AskEntity | null> {
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

  private async byId(id: string): Promise<AskEntity> {
    const entity = await this.askRepository.findOne({ where: { id } });
    if (entity == null) {
      throw new NotFoundException(`Ask ${id} not found`);
    }

    return entity;
  }
}
