import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { v7 as uuidv7 } from 'uuid';

import { type UserServiceContext } from '@ci/common/context';
import { LoggerService } from '@ci/common/logging';
import { UserEntity } from '@ci/domains/user';

import { assertAskTransition } from '../askStatus';
import { type AskAnswer } from '../entities/AskAnswerEntity';
import { type Ask, AskEntity } from '../entities/AskEntity';
import type { AskStatus, CreateAskDto, DisclosedAnswer, GrantDecision } from '../types';

import { AskAnswerService } from './AskAnswerService';
import { AskAuditService } from './AskAuditService';
import { GrantService } from './GrantService';

/**
 * The single failure a caller gets for an unroutable responder.
 *
 * "You cannot ask yourself" and "no such user" MUST be indistinguishable. They
 * used to differ badly: a self-ask raised this, while an unknown id fell through
 * to the `asks_responder_user_id_fkey` violation from Postgres — a 500 carrying
 * the constraint name. That turns `createAsk` into an account-enumeration
 * oracle usable by any signed-in user against arbitrary ids.
 */
const UNROUTABLE_RESPONDER = 'An ask must be directed at another user';

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
    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,
    private readonly grantService: GrantService,
    private readonly auditService: AskAuditService,
    private readonly answerService: AskAnswerService,
    @InjectDataSource()
    private readonly dataSource: DataSource,
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

    // A local ask must be directed at someone else, and at someone who exists.
    // An inbound peer ask has no local asker at all, so the self-ask guard does
    // not apply to it — but its responder is the link owner, which we already
    // resolved from a live link.
    //
    // Both failures raise the IDENTICAL message (see {@link UNROUTABLE_RESPONDER}).
    // Checking existence here rather than letting the FK fire is the point: the
    // constraint violation names the responder column, which answers "does this
    // account exist?" for any id the caller cares to try.
    //
    // An OUTBOUND ask carries a null responder (the responder is the peer named
    // by the link), so there is no local account to look up and nothing to
    // enumerate.
    if (!isInbound) {
      const unroutable =
        data.responderUserId === context.userId ||
        (data.responderUserId != null && !(await this.userExists(data.responderUserId)));
      if (unroutable) {
        throw new BadRequestException(UNROUTABLE_RESPONDER);
      }
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
   * Persist a disclosure and finalize its ask ATOMICALLY.
   *
   * The answer row and the audit row are one disclosure recorded twice; written
   * on separate connections they could disagree permanently. A crash between
   * them left an answer the asker could read with no audit row saying it
   * happened — and NOT a transient state: `AskAnswerService.create` is
   * insert-only, so the retry raises a conflict instead of writing the missing
   * audit. One transaction is what makes the two halves inseparable.
   *
   * The lifecycle gate still lives in {@link complete}, which runs INSIDE the
   * transaction — a refusal there rolls the answer back rather than leaving it
   * behind.
   */
  async completeWithAnswer(
    context: UserServiceContext,
    id: string,
    disclosure: {
      answer: DisclosedAnswer;
      /** References that actually crossed to the asker. */
      disclosedEntityIds: string[];
      /** Entities the answer was computed over (post-redaction, pre-ceiling). */
      backingEntityIds: string[];
    },
  ): Promise<{ ask: Ask; answer: AskAnswer }> {
    return this.dataSource.transaction(async (manager) => {
      const answer = await this.answerService.create({ askId: id, answer: disclosure.answer }, manager);
      const ask = await this.complete(context, id, disclosure.disclosedEntityIds, {
        backingEntityIds: disclosure.backingEntityIds,
        manager,
      });

      return { ask, answer };
    });
  }

  /**
   * Finalize an answerable ask (owner-approved `answering`, or auto-authorized
   * `delivered` with a consent basis) into `answered`, recording the terminal
   * audit. Responder-scoped. An auto-authorized ask is first advanced
   * `delivered → answering` so the lifecycle is honored.
   *
   * `disclosedEntityIds` is what the ASKER received — for every form but
   * `retrieval` that is empty, because those answers itemize nothing.
   * `options.backingEntityIds` is the owner-only record of what the answer was
   * computed over; the two are separate fields precisely so the audit stops
   * claiming the candidate set was disclosed.
   */
  async complete(
    context: UserServiceContext,
    id: string,
    disclosedEntityIds: string[],
    options: { backingEntityIds?: string[]; manager?: EntityManager } = {},
  ): Promise<Ask> {
    const entity = await this.responderOwned(context, id, options.manager);

    const isAuto = entity.status === 'delivered' && entity.consentBasis != null;
    if (entity.status !== 'answering' && !isAuto) {
      throw new BadRequestException(`Ask ${id} is not ready to answer (status: ${entity.status})`);
    }

    if (entity.status === 'delivered') {
      entity.status = assertAskTransition(entity.status, 'answering');
    }

    entity.status = assertAskTransition(entity.status, 'answered');
    const saved = await this.asks(options.manager).save(entity);

    await this.auditService.record(
      {
        askId: saved.id,
        askerUserId: saved.askerUserId,
        responderUserId: saved.responderUserId,
        query: saved.query,
        consentBasis: saved.consentBasis,
        outcome: isAuto ? 'auto_answered' : 'answered',
        disclosedEntities: disclosedEntityIds,
        backingEntities: options.backingEntityIds ?? [],
      },
      options.manager,
    );

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

  private async responderOwned(
    context: UserServiceContext,
    id: string,
    manager?: EntityManager,
  ): Promise<AskEntity> {
    const entity = await this.asks(manager).findOne({
      where: { id, responderUserId: context.userId },
    });
    if (entity == null) {
      throw new NotFoundException(`Ask ${id} not found`);
    }

    return entity;
  }

  /** The transaction's ask repository when one is supplied, otherwise the injected one. */
  private asks(manager?: EntityManager): Repository<AskEntity> {
    return manager ? manager.getRepository(AskEntity) : this.askRepository;
  }

  /**
   * Does this local account exist? A bare existence probe — never surfaced to
   * the caller as its own outcome (see {@link UNROUTABLE_RESPONDER}).
   */
  private async userExists(userId: string): Promise<boolean> {
    return (await this.userRepository.countBy({ id: userId })) > 0;
  }

  private async byId(id: string): Promise<AskEntity> {
    const entity = await this.askRepository.findOne({ where: { id } });
    if (entity == null) {
      throw new NotFoundException(`Ask ${id} not found`);
    }

    return entity;
  }
}
