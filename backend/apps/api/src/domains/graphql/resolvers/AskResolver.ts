import { BadRequestException, ForbiddenException, NotFoundException, UseGuards } from '@nestjs/common';
import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';

import { Context, type RequestContext, type UserServiceContext, toServiceContext } from '@ci/common/context';
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
  applyDisclosureCeiling,
  buildDisclosedAnswer,
  disclosureCeiling,
  inferAnswerForm,
  isAnswerable,
  type GrantMode,
  type TrustTier,
} from '@ci/domains/asks';
import { OutboundAskService, type PeerAskRequest, PeerLinkService } from '@ci/domains/peers';

import { AskAnswerType } from '../types/AskAnswerType';
import {
  CreateAskGrantInput,
  CreateAskInput,
  SendPeerAskInput,
  UpdateAskGrantInput,
} from '../types/AskInputs';
import {
  AskGrantPayload,
  AskPayload,
  CreateAskPayload,
  RunAskPayload,
  SendPeerAskPayload,
} from '../types/AskPayloads';
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
    private readonly peerLinkService: PeerLinkService,
    private readonly outboundAskService: OutboundAskService,
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

    return { success: true, ask: AskType.toType(ask, serviceContext.userId), decision };
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

    return { success: true, ask: AskType.toType(ask, serviceContext.userId) };
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

    return { success: true, ask: AskType.toType(ask, serviceContext.userId) };
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

    // The lifecycle gate runs HERE, before any side effect. `complete()` below
    // enforces it too, but it used to be the ONLY enforcement — and it ran after
    // `answerService.create`, so a declined ask still persisted an answer the
    // asker could read, with no audit row, before the throw. Checking first also
    // means a declined or already-answered ask never runs the search at all.
    if (!isAnswerable(ask.status, ask.consentBasis)) {
      throw new BadRequestException(`Ask ${gid} is not ready to answer (status: ${ask.status})`);
    }

    const identifiers = await this.executorService.execute(ask);
    const matches = identifiers.map((identifier) => ({ id: identifier.id, type: identifier.type }));

    const redacted = new Set(redactItemIds ?? []);
    // Entities that back the disclosure (post-redaction) — recorded in the audit
    // for accountability regardless of whether they are itemized to the asker.
    const backingIds = matches.filter((match) => !redacted.has(match.id)).map((match) => match.id);

    const built = buildDisclosedAnswer({
      form: inferAnswerForm(ask.query),
      matches,
      redactedIds: redactItemIds,
      consentBasis: ask.consentBasis,
    });

    // Phase 2 policy engine: clamp the answer to the asker's tier ceiling. This
    // is defence in depth, applied AFTER the grant already said yes — a grant
    // authorizes an ask, the ceiling caps how much any answer to it may reveal,
    // and the two are enforced independently so a mis-scoped grant cannot leak
    // more than the relationship allows.
    const tier = await this.resolveTier(serviceContext, ask);
    const answer = applyDisclosureCeiling(built, disclosureCeiling(tier, ask.query.dataClass));

    const savedAnswer = await this.answerService.create({ askId: id, answer });
    const completed = await this.askService.complete(serviceContext, id, backingIds);

    return {
      success: true,
      ask: AskType.toType(completed, serviceContext.userId),
      // The responder just ran this — they get their own true numbers.
      answer: AskAnswerType.toType(savedAnswer, true),
      disclosedCount: answer.disclosedCount,
      withheldCount: answer.withheldCount,
    };
  }

  /**
   * The asker's relationship tier, which sets the disclosure ceiling.
   *
   * A local ask comes from a member of the owner's own box (`household`). An ask
   * carrying a peer link is federated, so the tier is the one the owner assigned
   * that peer — and a link that has since been revoked or deleted resolves to
   * `stranger`, the strictest posture, rather than silently widening.
   */
  private async resolveTier(context: UserServiceContext, ask: Ask): Promise<TrustTier> {
    if (ask.peerLinkId == null) {
      return 'household';
    }

    const link = await this.peerLinkService.findById(context, ask.peerLinkId);

    return (link?.trustTier as TrustTier | undefined) ?? 'stranger';
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

    const serviceContext = toServiceContext(context);
    const id = GlobalUID.parse('ask', gid);
    // Enforce visibility via the parent ask (asker or responder only).
    const ask = await this.askService.findById(serviceContext, id);
    if (ask == null) {
      return null;
    }

    // Participation is not enough. An answer row can exist for an ask that never
    // reached a terminal answered state — that is exactly what the ordering bug
    // above produced — so the status is what decides whether it may be read.
    if (ask.status !== 'answered') {
      return null;
    }

    const answer = await this.answerService.findByAskId(id);

    return answer ? AskAnswerType.toType(answer, ask.responderUserId === serviceContext.userId) : null;
  }

  /**
   * Send an ask to a linked peer Companion — the OUTBOUND half of federation.
   *
   * The peer's box applies its owner's consent rules; this box learns only the
   * outcome. A declined result is indistinguishable from an unreachable peer.
   */
  @Mutation(() => SendPeerAskPayload)
  async sendPeerAsk(
    @Context() context: RequestContext,
    @Args('input') input: SendPeerAskInput,
  ): Promise<SendPeerAskPayload> {
    if (!(await this.enabled())) {
      return { success: false };
    }

    const serviceContext = toServiceContext(context);
    // Outbound asks consume the same per-user budget as local ones, so a
    // compromised client cannot use the peer path to bypass the limit.
    this.rateLimitService.consume(serviceContext.userId);

    const request = toPeerAskRequest(input);

    const { ask, response } = await this.outboundAskService.send(
      serviceContext,
      { handle: input.handle, prompt: input.prompt, request },
      input.peerAccessToken,
    );

    return {
      success: true,
      ask: AskType.toType(ask),
      status: response.status,
      reason: response.reason,
    };
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

    const serviceContext = toServiceContext(context);
    const rows = await this.askService.listInbox(serviceContext);

    return rows.map((row) => AskType.toType(row, serviceContext.userId));
  }

  /** The asker's outbox (asks I have sent). */
  @Query(() => [AskType])
  async askOutbox(@Context() context: RequestContext): Promise<AskType[]> {
    if (!(await this.enabled())) {
      return [];
    }

    const serviceContext = toServiceContext(context);
    const rows = await this.askService.listOutbox(serviceContext);

    return rows.map((row) => AskType.toType(row, serviceContext.userId));
  }

  @Query(() => AskType, { nullable: true })
  async ask(
    @Context() context: RequestContext,
    @Args('id', { type: () => ID }) gid: string,
  ): Promise<AskType | null> {
    if (!(await this.enabled())) {
      return null;
    }

    const serviceContext = toServiceContext(context);
    const id = GlobalUID.parse('ask', gid);
    const found = await this.askService.findById(serviceContext, id);

    return found ? AskType.toType(found, serviceContext.userId) : null;
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

  /**
   * CHANGE a standing grant — the Grant Manager matrix's core interaction
   * (`onChangeMode(grantId, mode)`), which until now had no backing mutation at
   * all. The only expressible "change" was `createAskGrant` a second time, which
   * left BOTH rows live and both matching the same asks.
   *
   * The change is applied as a supersede rather than an in-place update, so the
   * previous posture stays on the record; see `GrantService.supersede`. The
   * returned grant is the NEW row — its `supersedesGrantId` names the one it
   * replaced, and `myAskGrantHistory` shows both.
   */
  @Mutation(() => AskGrantPayload)
  async updateAskGrant(
    @Context() context: RequestContext,
    @Args('id', { type: () => ID }) gid: string,
    @Args('input') input: UpdateAskGrantInput,
  ): Promise<AskGrantPayload> {
    if (!(await this.enabled())) {
      return { success: false };
    }

    const serviceContext = toServiceContext(context);
    const id = GlobalUID.parse('ask-grant', gid);

    // `clearExpiry` and `expiresAt` are contradictory instructions, and guessing
    // which one the caller meant is how a grant ends up permanent by accident.
    if (input.clearExpiry === true && input.expiresAt != null) {
      throw new BadRequestException('Pass either expiresAt or clearExpiry, not both');
    }

    const expiresAt = input.clearExpiry === true ? null : input.expiresAt;

    const grant = await this.grantService.supersede(serviceContext, id, {
      mode: input.mode as GrantMode | undefined,
      dataClass: input.dataClass,
      // An omitted `dataClasses` inherits the previous scope; passing an empty
      // list is a real instruction ("no classes"), not an absence.
      scope: input.dataClasses ? { dataClasses: input.dataClasses } : undefined,
      purpose: input.purpose,
      expiresAt,
    });

    return { success: true, grant: AskGrantType.toType(grant) };
  }

  /**
   * Every grant the caller ever wrote, newest first — revoked, lapsed and
   * superseded included.
   *
   * Separate from {@link myAskGrants} (which stays active-only) because the two
   * answer different questions: that one is "what am I sharing?", this one is
   * "what have I ever shared, and what happened to it?". History is also what
   * lets a disclosure-history row resolve a `consentBasis` naming a grant that
   * has since been revoked — before this, every read path filtered revoked
   * grants out, so that basis resolved to nothing.
   */
  @Query(() => [AskGrantType])
  async myAskGrantHistory(@Context() context: RequestContext): Promise<AskGrantType[]> {
    if (!(await this.enabled())) {
      return [];
    }

    const rows = await this.grantService.listHistoryForOwner(toServiceContext(context));

    return rows.map(AskGrantType.toType);
  }

  /**
   * One of the caller's own grants by id, in ANY lifecycle state — the lookup
   * behind "what was the basis for this disclosure?" when the grant behind it
   * has since been revoked.
   */
  @Query(() => AskGrantType, { nullable: true })
  async askGrant(
    @Context() context: RequestContext,
    @Args('id', { type: () => ID }) gid: string,
  ): Promise<AskGrantType | null> {
    if (!(await this.enabled())) {
      return null;
    }

    const serviceContext = toServiceContext(context);
    const id = GlobalUID.parse('ask-grant', gid);
    const grant = await this.grantService.findByIdForOwner(serviceContext, id);

    return grant ? AskGrantType.toType(grant) : null;
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
/**
 * Narrow the flat GraphQL input back to the discriminated protocol shape.
 *
 * Fields belonging to other archetypes are DROPPED rather than passed through,
 * so a caller cannot smuggle (say) a content `dataClass` into an availability
 * request and have the peer interpret it.
 */
function toPeerAskRequest(input: SendPeerAskInput): PeerAskRequest {
  switch (input.archetype) {
    case 'availability':
      if (!input.from || !input.to) {
        throw new BadRequestException('An availability ask requires from and to');
      }

      return {
        archetype: 'availability',
        from: input.from,
        to: input.to,
        minMinutes: input.minMinutes,
        purpose: input.purpose,
      } as PeerAskRequest;
    case 'relationship':
      if (!input.subject) {
        throw new BadRequestException('A relationship ask requires a subject');
      }

      return { archetype: 'relationship', subject: input.subject } as PeerAskRequest;
    case 'content':
      if (!input.subject) {
        throw new BadRequestException('A content ask requires a subject');
      }

      return {
        archetype: 'content',
        subject: input.subject,
        dataClass: input.dataClass,
        from: input.from,
        to: input.to,
      } as PeerAskRequest;
    default:
      throw new BadRequestException(`Unsupported ask archetype: ${input.archetype}`);
  }
}
