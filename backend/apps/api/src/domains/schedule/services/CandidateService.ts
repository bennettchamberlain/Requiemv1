import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { v7 as uuidv7 } from 'uuid';

import { SYSTEM_USER, type ServiceContext, type UserServiceContext } from '@ci/common/context';
import { LoggerService } from '@ci/common/logging';
import { type Event, EventService } from '@ci/domains/memory';

import { EventCandidateEntity, type EventCandidate } from '../entities/EventCandidateEntity';
import { type CreateCandidateDto, type DeclineReason, USER_AUTHORED_GENERATOR_PREFIX } from '../types';

/** Reasons that retire a candidate permanently rather than just for now. */
const PERMANENT_DECLINES: ReadonlySet<DeclineReason> = new Set(['never']);

/** Fresh window for a returned candidate whose original one has already closed. */
const RETURNED_WINDOW_DAYS = 7;

/**
 * Something the user typed themselves leads the slate — they asked for it, so
 * it should not queue behind a week of machine suggestions.
 *
 * Done here rather than as a CASE in the ORDER BY for two reasons. The query
 * has no LIMIT and already materialises every matching row, so this is exactly
 * equivalent to sorting in SQL. And it has to hold once a scorer starts
 * populating `fit_score`: hand-written tasks have none, and `NULLS LAST` would
 * otherwise push them to the very back the moment scoring lands.
 *
 * Order WITHIN each group is whatever the query returned, preserved by
 * concatenating two filters rather than sorting.
 */
function partitionUserAuthoredFirst(rows: EventCandidateEntity[]): EventCandidateEntity[] {
  const isUserAuthored = (row: EventCandidateEntity): boolean =>
    row.generator?.startsWith(USER_AUTHORED_GENERATOR_PREFIX) === true;

  const authored = rows.filter(isUserAuthored);

  return authored.length === 0 ? rows : [...authored, ...rows.filter((row) => !isUserAuthored(row))];
}

@Injectable()
export class CandidateService {
  constructor(
    @InjectRepository(EventCandidateEntity)
    private readonly candidateRepository: Repository<EventCandidateEntity>,
    private readonly eventService: EventService,
    private readonly dataSource: DataSource,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(CandidateService.name);
  }

  /**
   * Live candidates whose plausible window overlaps [from, to).
   *
   * Snoozed rows reappear once `snoozed_until` has passed — snoozing is "not
   * now", not a quiet delete, and the user should not have to remember what they
   * deferred.
   */
  async findInRange(context: ServiceContext, from: Date, to: Date): Promise<EventCandidate[]> {
    const query = this.dataSource
      .getRepository(EventCandidateEntity)
      .createQueryBuilder('candidate')
      .where('candidate.window_start < :to', { to })
      .andWhere('candidate.window_end >= :from', { from })
      .andWhere(
        "(candidate.status = 'open' OR (candidate.status = 'snoozed' AND candidate.snoozed_until <= NOW()))",
      )
      .orderBy('candidate.fit_score', 'DESC', 'NULLS LAST')
      // Newest first, so a task just added lands at the front of the rail
      // instead of behind everything already sitting there. Was ASC, which is
      // what made a new card append to the back.
      .addOrderBy('candidate.created_at', 'DESC')
      // Deterministic final tiebreak: two rows can share a created_at, and the
      // order must not shuffle between page loads. candidate_id is uuidv7, so
      // DESC keeps the newest-first reading.
      .addOrderBy('candidate.candidate_id', 'DESC');

    if (context.userId !== SYSTEM_USER) {
      query.andWhere('candidate.user_id = :userId', { userId: context.userId });
    }

    const result = await query.getMany();

    return partitionUserAuthoredFirst(result).map((entity) => EventCandidateEntity.toEgressType(entity));
  }

  async findById(context: ServiceContext, id: string): Promise<EventCandidate | null> {
    const entity = await this.candidateRepository.findOne({
      where: {
        id,
        ...(context.userId !== SYSTEM_USER && { userId: context.userId }),
      },
    });

    return entity ? EventCandidateEntity.toEgressType(entity) : null;
  }

  /**
   * Upsert proposals by `dedupe_key`.
   *
   * A collision with a row the user already acted on is left untouched: once
   * something is declined, accepted, or snoozed, a later generation run must not
   * resurrect it. Only `open` rows get refreshed with new reasoning.
   */
  async upsert(context: UserServiceContext, proposals: CreateCandidateDto[]): Promise<EventCandidate[]> {
    const written: EventCandidateEntity[] = [];

    for (const proposal of proposals) {
      const existing = await this.candidateRepository.findOne({
        where: { userId: context.userId, dedupeKey: proposal.dedupe_key },
      });

      if (existing && existing.status !== 'open') {
        this.logger.debug('Skipping candidate the user already acted on', {
          dedupeKey: proposal.dedupe_key,
          status: existing.status,
        });

        continue;
      }

      const entity = this.candidateRepository.create({
        ...(existing ?? {}),
        id: existing?.id ?? uuidv7(),
        userId: context.userId,
        title: proposal.title,
        description: proposal.description ?? null,
        rationale: proposal.rationale,
        rationaleSources: proposal.rationale_sources ?? [],
        windowStart: proposal.window_start,
        windowEnd: proposal.window_end,
        timeFlex: proposal.time_flex ?? 'week',
        durationMinutes: proposal.duration_minutes ?? null,
        constraints: proposal.constraints ?? {},
        l0Class: proposal.l0_class ?? null,
        l1ClusterId: proposal.l1_cluster_id ?? null,
        energyCost: proposal.energy_cost ?? null,
        dedupeKey: proposal.dedupe_key,
        generator: proposal.generator ?? null,
        confidence: proposal.confidence ?? null,
        status: 'open',
      });

      written.push(await this.candidateRepository.save(entity));
    }

    return written.map((entity) => EventCandidateEntity.toEgressType(entity));
  }

  /**
   * Promote a candidate into a real event at a time the user chose.
   *
   * This is the only path from possible to committed, and it is always driven by
   * an explicit user action — there is no auto-accept anywhere in the system.
   * The event is written first so the candidate never claims a promotion that
   * does not exist (the table's promotion-consistency check enforces the pair).
   */
  async accept(
    context: UserServiceContext,
    id: string,
    startTime: Date,
    endTime?: Date,
  ): Promise<{ candidate: EventCandidate; event: Event }> {
    const candidate = await this.candidateRepository.findOne({
      where: { id, userId: context.userId },
    });

    if (!candidate) {
      throw new NotFoundException(`Candidate ${id} not found`);
    }

    if (candidate.status === 'accepted') {
      throw new BadRequestException(`Candidate ${id} was already accepted`);
    }

    const resolvedEnd =
      endTime ??
      (candidate.durationMinutes
        ? new Date(startTime.getTime() + candidate.durationMinutes * 60_000)
        : undefined);

    const [event] = await this.eventService.create(context, {
      title: candidate.title,
      description: candidate.description ?? undefined,
      start_time: startTime,
      end_time: resolvedEnd,
      category: candidate.l0Class ?? undefined,
      energy_level: candidate.energyCost ?? undefined,
      status: 'confirmed',
      // Accepted-from-a-suggestion is a fact about provenance, not a prediction:
      // the user committed to this, so is_predicted stays false and HBPE may
      // train on it like any other real event. inference_sources keeps the trail.
      is_predicted: false,
      created_by: 'schedule:candidate',
      inference_sources: {
        candidate_id: candidate.id,
        rationale: candidate.rationale,
        rationale_sources: candidate.rationaleSources ?? [],
        generator: candidate.generator,
      },
    });

    candidate.status = 'accepted';
    candidate.promotedEventId = event.id;
    candidate.feedbackAt = new Date();
    candidate.feedbackReason = null;
    candidate.snoozedUntil = null;

    const saved = await this.candidateRepository.save(candidate);

    this.logger.log('Candidate accepted', { candidateId: candidate.id, eventId: event.id });

    return { candidate: EventCandidateEntity.toEgressType(saved), event };
  }

  /**
   * Take a placed task back off the calendar and return it to the slate — the
   * inverse of {@link accept}, and the only way out of committed time that is
   * not a deletion.
   *
   * Scoped to events this system minted from a candidate, found by the
   * `promoted_event_id` backlink. An event mirrored from a synced calendar has
   * no candidate, so it cannot be dragged back: the schedule surface never
   * silently mutates a row another system owns, and un-committing a Google
   * event here would either lie about the source or destroy it.
   */
  async returnToSlate(context: UserServiceContext, eventId: string): Promise<EventCandidate> {
    const candidate = await this.candidateRepository.findOne({
      where: { userId: context.userId, promotedEventId: eventId },
    });

    if (!candidate) {
      throw new NotFoundException(
        `Event ${eventId} did not come from a suggestion, so there is nothing to return it to`,
      );
    }

    // The event goes first: a candidate that claims `open` while still holding a
    // promoted_event_id would violate the table's promotion-consistency check,
    // and accept() writes in the same order for the same reason.
    await this.eventService.remove(context, eventId);

    candidate.status = 'open';
    candidate.promotedEventId = null;
    candidate.feedbackAt = null;
    candidate.feedbackReason = null;
    candidate.snoozedUntil = null;

    // A candidate whose plausible window has already closed would come back
    // invisible — findInRange only surfaces windows overlapping the view. Give
    // an expired one a fresh week rather than returning it to a grave. A window
    // still open is left alone: it may carry real meaning ("before Friday").
    const now = new Date();
    if (candidate.windowEnd <= now) {
      candidate.windowStart = now;
      candidate.windowEnd = new Date(now.getTime() + RETURNED_WINDOW_DAYS * 86_400_000);
    }

    const saved = await this.candidateRepository.save(candidate);

    this.logger.log('Candidate returned to the slate', { candidateId: candidate.id, eventId });

    return EventCandidateEntity.toEgressType(saved);
  }

  /**
   * Record a rejection. `never` retires the idea for good; everything else marks
   * it declined for this round, and the reason is what the proposer learns from —
   * "wrong time" is far more useful feedback than a silent disappearance.
   */
  async decline(context: UserServiceContext, id: string, reason: DeclineReason): Promise<EventCandidate> {
    const candidate = await this.candidateRepository.findOne({
      where: { id, userId: context.userId },
    });

    if (!candidate) {
      throw new NotFoundException(`Candidate ${id} not found`);
    }

    candidate.status = PERMANENT_DECLINES.has(reason) ? 'never' : 'declined';
    candidate.feedbackReason = reason;
    candidate.feedbackAt = new Date();
    candidate.snoozedUntil = null;

    const saved = await this.candidateRepository.save(candidate);

    return EventCandidateEntity.toEgressType(saved);
  }

  /** Defer a candidate until `until`, after which findInRange surfaces it again. */
  async snooze(context: UserServiceContext, id: string, until: Date): Promise<EventCandidate> {
    if (until.getTime() <= Date.now()) {
      throw new BadRequestException('`until` must be in the future');
    }

    const candidate = await this.candidateRepository.findOne({
      where: { id, userId: context.userId },
    });

    if (!candidate) {
      throw new NotFoundException(`Candidate ${id} not found`);
    }

    if (candidate.status === 'accepted') {
      throw new BadRequestException(`Candidate ${id} was already accepted`);
    }

    candidate.status = 'snoozed';
    candidate.snoozedUntil = until;
    candidate.feedbackReason = 'not_now';
    candidate.feedbackAt = new Date();

    const saved = await this.candidateRepository.save(candidate);

    return EventCandidateEntity.toEgressType(saved);
  }
}
