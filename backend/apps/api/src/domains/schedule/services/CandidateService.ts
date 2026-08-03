import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { v7 as uuidv7 } from 'uuid';

import { SYSTEM_USER, type ServiceContext, type UserServiceContext } from '@ci/common/context';
import { LoggerService } from '@ci/common/logging';
import { EventService } from '@ci/domains/memory';

import { EventCandidateEntity, type EventCandidate } from '../entities/EventCandidateEntity';
import type { CreateCandidateDto, DeclineReason } from '../types';

/** Reasons that retire a candidate permanently rather than just for now. */
const PERMANENT_DECLINES: ReadonlySet<DeclineReason> = new Set(['never']);

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
      .addOrderBy('candidate.candidate_id', 'ASC');

    if (context.userId !== SYSTEM_USER) {
      query.andWhere('candidate.user_id = :userId', { userId: context.userId });
    }

    const result = await query.getMany();

    return result.map((entity) => EventCandidateEntity.toEgressType(entity));
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
  ): Promise<EventCandidate> {
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
