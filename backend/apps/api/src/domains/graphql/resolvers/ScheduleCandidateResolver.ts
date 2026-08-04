import { UseGuards } from '@nestjs/common';
import { Args, ID, Int, Mutation, Query, Resolver } from '@nestjs/graphql';

import { Context, type RequestContext, toServiceContext } from '@ci/common/context';
import { JwtOrApiKeyAuthGuard } from '@ci/common/guards';
import { LoggerService } from '@ci/common/logging';
import {
  CandidateService,
  SuggestionSyncService,
  TaskBreakdownService,
  type DeclineReason,
} from '@ci/domains/schedule';

import { EventType } from '../types/EventType';
import { ScheduleCandidateType } from '../types/ScheduleCandidateType';

@UseGuards(JwtOrApiKeyAuthGuard)
@Resolver(() => ScheduleCandidateType)
export class ScheduleCandidateResolver {
  constructor(
    private readonly candidateService: CandidateService,
    private readonly suggestionSyncService: SuggestionSyncService,
    private readonly taskBreakdownService: TaskBreakdownService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(ScheduleCandidateResolver.name);
  }

  @Query(() => [ScheduleCandidateType], {
    description: 'Open schedule candidates whose plausible window overlaps [from, to)',
  })
  async scheduleCandidates(
    @Context() context: RequestContext,
    @Args('from', { type: () => Date }) from: Date,
    @Args('to', { type: () => Date }) to: Date,
  ): Promise<ScheduleCandidateType[]> {
    const candidates = await this.candidateService.findInRange(toServiceContext(context), from, to);

    return candidates.map((candidate) => ScheduleCandidateType.toType(candidate));
  }

  @Mutation(() => Int, {
    description:
      'Refresh the slate from current actions and insight key_actions. Idempotent; returns rows written.',
  })
  async syncScheduleSuggestions(@Context() context: RequestContext): Promise<number> {
    return this.suggestionSyncService.sync(toServiceContext(context));
  }

  /**
   * Split a free-text brain dump into candidates on the slate.
   *
   * Writes to the same table every other proposer uses, so the cards behave
   * identically once they land — including that scheduling one still means
   * dragging it onto a day.
   */
  @Mutation(() => [ScheduleCandidateType], {
    description: "Break free text into schedule candidates. Adds to the slate; schedules nothing.",
  })
  async breakDownTasks(
    @Context() context: RequestContext,
    @Args('text', { type: () => String }) text: string,
  ): Promise<ScheduleCandidateType[]> {
    const candidates = await this.taskBreakdownService.breakDown(
      { ...context, ...toServiceContext(context) },
      text,
    );

    this.logger.log('Brain dump split into candidates', { count: candidates.length });

    return candidates.map((candidate) => ScheduleCandidateType.toType(candidate));
  }

  /**
   * Promote a candidate to committed time. This is the only crossing from
   * possible to committed, and it is always an explicit user action — dragging
   * a card onto a day. Nothing auto-accepts.
   */
  @Mutation(() => EventType, { description: 'Accept a candidate at a chosen time, minting a real event' })
  async acceptCandidate(
    @Context() context: RequestContext,
    @Args('id', { type: () => ID }) id: string,
    @Args('startTime', { type: () => Date }) startTime: Date,
    @Args('endTime', { type: () => Date, nullable: true }) endTime?: Date,
  ): Promise<EventType> {
    const { event } = await this.candidateService.accept(
      toServiceContext(context),
      id,
      startTime,
      endTime,
    );

    this.logger.log('Candidate placed on the schedule', { candidateId: id, eventId: event.id });

    return EventType.toType(event);
  }

  /**
   * The inverse of {@link acceptCandidate}: take a placed task off the calendar
   * and put it back among the possibilities. Only events minted from a
   * candidate qualify — a mirrored calendar row has no candidate to return to.
   */
  @Mutation(() => ScheduleCandidateType, {
    description: 'Return a placed event to the slate, deleting the event it minted',
  })
  async returnEventToSlate(
    @Context() context: RequestContext,
    @Args('eventId', { type: () => ID }) eventId: string,
  ): Promise<ScheduleCandidateType> {
    const candidate = await this.candidateService.returnToSlate(toServiceContext(context), eventId);

    this.logger.log('Event returned to the slate', { eventId, candidateId: candidate.id });

    return ScheduleCandidateType.toType(candidate);
  }

  @Mutation(() => ScheduleCandidateType, {
    description: 'Reject a candidate. reason: not_now | wrong_time | not_like_this | never',
  })
  async declineCandidate(
    @Context() context: RequestContext,
    @Args('id', { type: () => ID }) id: string,
    @Args('reason', { type: () => String, nullable: true, defaultValue: 'not_now' }) reason: string,
  ): Promise<ScheduleCandidateType> {
    const candidate = await this.candidateService.decline(
      toServiceContext(context),
      id,
      reason as DeclineReason,
    );

    return ScheduleCandidateType.toType(candidate);
  }

  @Mutation(() => ScheduleCandidateType, { description: 'Defer a candidate until a future instant' })
  async snoozeCandidate(
    @Context() context: RequestContext,
    @Args('id', { type: () => ID }) id: string,
    @Args('until', { type: () => Date }) until: Date,
  ): Promise<ScheduleCandidateType> {
    const candidate = await this.candidateService.snooze(toServiceContext(context), id, until);

    return ScheduleCandidateType.toType(candidate);
  }
}
