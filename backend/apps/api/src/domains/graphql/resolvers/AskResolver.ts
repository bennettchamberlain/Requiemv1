import { BadRequestException, ForbiddenException, NotFoundException, UseGuards } from '@nestjs/common';
import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';

import { Context, type RequestContext, toServiceContext } from '@ci/common/context';
import { FeatureService } from '@ci/common/feature';
import { JwtOrApiKeyAuthGuard } from '@ci/common/guards';
import {
  type Ask,
  AskAnswerService,
  AskAuditService,
  AskExecutorService,
  AskRateLimitService,
  AskService,
  GrantService,
  buildDisclosedAnswer,
  inferAnswerForm,
  type GrantMode,
} from '@ci/domains/asks';

import { AskAnswerType } from '../types/AskAnswerType';
import { CreateAskGrantInput, CreateAskInput } from '../types/AskInputs';
import { AskGrantPayload, AskPayload, CreateAskPayload, RunAskPayload } from '../types/AskPayloads';
import { AskAuditType, AskGrantType, AskType } from '../types/AskType';
import { GlobalUID } from '../types/GlobalUID';

/**
 * GraphQL surface for the interpersonal ask feature (epic #1712, Phase 0). Every
 * operation is signed-in-only ({@link JwtOrApiKeyAuthGuard}) and gated by the
 * `ask` feature flag (default off) — while the flag is off the surface behaves
 * as if absent (mutations return `{ success: false }`, queries return empty),
 * mirroring how the shared-search surface stays dark behind `shared.search`.
 *
 * The `answering`/answered completion of an approved or auto-authorized ask is
 * produced by the run-as-owner executor (`runAsk`, task #1719) and the
 * disclosure filter (Phase 1); this resolver drives the consent + lifecycle up
 * to that point.
 */
@UseGuards(JwtOrApiKeyAuthGuard)
@Resolver(() => AskType)
export class AskResolver {
  constructor(
    private readonly askService: AskService,
    private readonly grantService: GrantService,
    private readonly auditService: AskAuditService,
    private readonly rateLimitService: AskRateLimitService,
    private readonly executorService: AskExecutorService,
    private readonly answerService: AskAnswerService,
    private readonly featureService: FeatureService,
  ) {}

  @Mutation(() => CreateAskPayload)
  async createAsk(
    @Context() context: RequestContext,
    @Args('input') input: CreateAskInput,
  ): Promise<CreateAskPayload> {
    if (!(await this.enabled())) {
      return { success: false };
    }

    const serviceContext = toServiceContext(context);
    this.rateLimitService.consume(serviceContext.userId);
    const responderUserId = GlobalUID.parse('user', input.responderId);

    const { ask, decision } = await this.askService.submit(serviceContext, {
      responderUserId,
      query: {
        queryType: input.query.queryType,
        dataClass: input.query.dataClass,
        prompt: input.query.prompt,
      },
    });

    return { success: true, ask: AskType.toType(ask), decision };
  }

  @Mutation(() => AskPayload)
  async approveAsk(
    @Context() context: RequestContext,
    @Args('id', { type: () => ID }) gid: string,
  ): Promise<AskPayload> {
    if (!(await this.enabled())) {
      return { success: false };
    }

    const serviceContext = toServiceContext(context);
    const id = GlobalUID.parse('ask', gid);
    const ask = await this.askService.approve(serviceContext, id);

    return { success: true, ask: AskType.toType(ask) };
  }

  @Mutation(() => AskPayload)
  async declineAsk(
    @Context() context: RequestContext,
    @Args('id', { type: () => ID }) gid: string,
  ): Promise<AskPayload> {
    if (!(await this.enabled())) {
      return { success: false };
    }

    const serviceContext = toServiceContext(context);
    const id = GlobalUID.parse('ask', gid);
    const ask = await this.askService.decline(serviceContext, id);

    return { success: true, ask: AskType.toType(ask) };
  }

  /**
   * Run an answerable ask (owner-approved, or auto-authorized) as the responder,
   * producing the disclosure-filtered answer and finalizing the ask to
   * `answered`. Only the responder may run their own asks; the query executes in
   * the responder's memory scope. `redactItemIds` is the owner's "deny all but X"
   * set — matched entity ids to withhold (counted, never itemized to the asker).
   *
   * The answer carries entity id+type REFERENCES and a templated summary only —
   * never raw node content or forwardable signed media URLs.
   */
  @Mutation(() => RunAskPayload)
  async runAsk(
    @Context() context: RequestContext,
    @Args('id', { type: () => ID }) gid: string,
    @Args('redactItemIds', { type: () => [String], nullable: true }) redactItemIds?: string[],
  ): Promise<RunAskPayload> {
    if (!(await this.enabled())) {
      return { success: false };
    }

    const serviceContext = toServiceContext(context);
    const id = GlobalUID.parse('ask', gid);

    const ask = await this.askService.findById(serviceContext, id);
    if (ask == null) {
      throw new NotFoundException(`Ask ${gid} not found`);
    }

    // Only the responder (memory owner) may produce the answer for their ask.
    if (ask.responderUserId !== serviceContext.userId) {
      throw new ForbiddenException('Only the responder may run this ask');
    }

    // CHECK BEFORE ACT. `complete()` validates the lifecycle, but it runs at the
    // END — so without this gate an ask that was `declined` (or is still in
    // `under_review`) would still have its query executed and its answer
    // PERSISTED, and only then be rejected. There is no transaction, so that
    // row survives the thrown error and is readable by the asker via
    // `askAnswer`, which is visible to either participant. Refusing up front is
    // what keeps the grant decision authoritative.
    if (!isAnswerable(ask)) {
      throw new BadRequestException(`Ask ${gid} is not ready to answer (status: ${ask.status})`);
    }

    const identifiers = await this.executorService.execute(ask);
    const matches = identifiers.map((identifier) => ({ id: identifier.id, type: identifier.type }));

    const redacted = new Set(redactItemIds ?? []);
    // Entities that back the disclosure (post-redaction) — recorded in the audit
    // for accountability regardless of whether they are itemized to the asker.
    const backingIds = matches.filter((match) => !redacted.has(match.id)).map((match) => match.id);

    const answer = buildDisclosedAnswer({
      form: inferAnswerForm(ask.query),
      matches,
      redactedIds: redactItemIds,
      consentBasis: ask.consentBasis,
    });

    const savedAnswer = await this.answerService.create({ askId: id, answer });
    const completed = await this.askService.complete(serviceContext, id, backingIds);

    return {
      success: true,
      ask: AskType.toType(completed),
      answer: AskAnswerType.toType(savedAnswer),
      disclosedCount: answer.disclosedCount,
      withheldCount: answer.withheldCount,
    };
  }

  /** The disclosure-filtered answer for an ask (visible to asker or responder). */
  @Query(() => AskAnswerType, { nullable: true })
  async askAnswer(
    @Context() context: RequestContext,
    @Args('id', { type: () => ID }) gid: string,
  ): Promise<AskAnswerType | null> {
    if (!(await this.enabled())) {
      return null;
    }

    const id = GlobalUID.parse('ask', gid);
    // Enforce visibility via the parent ask (asker or responder only).
    const ask = await this.askService.findById(toServiceContext(context), id);
    if (ask == null) {
      return null;
    }

    const answer = await this.answerService.findByAskId(id);

    return answer ? AskAnswerType.toType(answer) : null;
  }

  @Mutation(() => AskGrantPayload)
  async createAskGrant(
    @Context() context: RequestContext,
    @Args('input') input: CreateAskGrantInput,
  ): Promise<AskGrantPayload> {
    if (!(await this.enabled())) {
      return { success: false };
    }

    const serviceContext = toServiceContext(context);
    const granteeUserId = GlobalUID.parse('user', input.granteeId);

    const grant = await this.grantService.create(serviceContext, {
      granteeUserId,
      queryType: input.queryType,
      dataClass: input.dataClass ?? null,
      scope: input.dataClasses ? { dataClasses: input.dataClasses } : null,
      mode: input.mode as GrantMode,
      purpose: input.purpose ?? null,
    });

    return { success: true, grant: AskGrantType.toType(grant) };
  }

  @Mutation(() => AskGrantPayload)
  async revokeAskGrant(
    @Context() context: RequestContext,
    @Args('id', { type: () => ID }) gid: string,
  ): Promise<AskGrantPayload> {
    if (!(await this.enabled())) {
      return { success: false };
    }

    const serviceContext = toServiceContext(context);
    const id = GlobalUID.parse('ask-grant', gid);
    const grant = await this.grantService.revoke(serviceContext, id);

    return { success: true, grant: AskGrantType.toType(grant) };
  }

  /** The responder's review inbox (asks awaiting a decision). */
  @Query(() => [AskType])
  async askInbox(@Context() context: RequestContext): Promise<AskType[]> {
    if (!(await this.enabled())) {
      return [];
    }

    const rows = await this.askService.listInbox(toServiceContext(context));

    return rows.map(AskType.toType);
  }

  /** The asker's outbox (asks I have sent). */
  @Query(() => [AskType])
  async askOutbox(@Context() context: RequestContext): Promise<AskType[]> {
    if (!(await this.enabled())) {
      return [];
    }

    const rows = await this.askService.listOutbox(toServiceContext(context));

    return rows.map(AskType.toType);
  }

  @Query(() => AskType, { nullable: true })
  async ask(
    @Context() context: RequestContext,
    @Args('id', { type: () => ID }) gid: string,
  ): Promise<AskType | null> {
    if (!(await this.enabled())) {
      return null;
    }

    const id = GlobalUID.parse('ask', gid);
    const found = await this.askService.findById(toServiceContext(context), id);

    return found ? AskType.toType(found) : null;
  }

  /** Standing grants owned by the caller (the Grant Manager). */
  @Query(() => [AskGrantType])
  async myAskGrants(@Context() context: RequestContext): Promise<AskGrantType[]> {
    if (!(await this.enabled())) {
      return [];
    }

    const rows = await this.grantService.listForOwner(toServiceContext(context));

    return rows.map(AskGrantType.toType);
  }

  /** The caller's disclosure history (asks they responded to). */
  @Query(() => [AskAuditType])
  async askDisclosureHistory(@Context() context: RequestContext): Promise<AskAuditType[]> {
    if (!(await this.enabled())) {
      return [];
    }

    const rows = await this.auditService.listForResponder(toServiceContext(context));

    return rows.map(AskAuditType.toType);
  }

  private async enabled(): Promise<boolean> {
    return this.featureService.isFeatureEnabled('ask');
  }
}

/**
 * The same predicate `AskService.complete` enforces: an ask is answerable once
 * the owner has approved it (`answering`), or when a standing grant already
 * authorized it (`delivered` carrying a consent basis). Kept in sync with
 * AskService.complete — both must agree or the gate is bypassable.
 */
function isAnswerable(ask: Ask): boolean {
  return ask.status === 'answering' || (ask.status === 'delivered' && ask.consentBasis != null);
}
