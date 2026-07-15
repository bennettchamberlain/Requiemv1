import { UseGuards } from '@nestjs/common';
import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';

import { Context, type RequestContext, toServiceContext } from '@ci/common/context';
import { FeatureService } from '@ci/common/feature';
import { JwtOrApiKeyAuthGuard } from '@ci/common/guards';
import { AskAuditService, AskService, GrantService, type GrantMode } from '@ci/domains/asks';

import { CreateAskGrantInput, CreateAskInput } from '../types/AskInputs';
import { AskGrantPayload, AskPayload, CreateAskPayload } from '../types/AskPayloads';
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
