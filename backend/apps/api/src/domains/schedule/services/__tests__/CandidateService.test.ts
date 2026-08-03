import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import type { UserServiceContext } from '@ci/common/context';
import { LoggerService } from '@ci/common/logging';
import { EventService } from '@ci/domains/memory';

import { EventCandidateEntity } from '../../entities/EventCandidateEntity';
import { CandidateService } from '../CandidateService';

function makeQueryBuilder(many: unknown[]) {
  const calls: Record<string, unknown[][]> = {};
  const record = (name: string) => {
    calls[name] ??= [];

    return (...args: unknown[]) => {
      calls[name].push(args);

      return qb;
    };
  };

  const qb = {
    where: record('where'),
    andWhere: record('andWhere'),
    orderBy: record('orderBy'),
    addOrderBy: record('addOrderBy'),
    getMany: jest.fn(async () => many),
    calls,
  };

  return qb;
}

const ctx = { userId: 'user-1' } as UserServiceContext;

function baseCandidate(overrides: Partial<EventCandidateEntity> = {}): EventCandidateEntity {
  return {
    id: 'cand-1',
    userId: 'user-1',
    title: 'Strength session',
    description: null,
    rationale: 'Shoulder rehab shows up in 4 notes since June.',
    rationaleSources: [{ kind: 'summary', id: 'sum-1' }],
    windowStart: new Date('2026-08-03T00:00:00Z'),
    windowEnd: new Date('2026-08-10T00:00:00Z'),
    timeFlex: 'week',
    durationMinutes: 60,
    constraints: {},
    l0Class: 'EXERCISE',
    l1ClusterId: null,
    energyCost: 6,
    fitScore: 0.8,
    fitCurve: null,
    status: 'open',
    feedbackReason: null,
    feedbackAt: null,
    snoozedUntil: null,
    promotedEventId: null,
    dedupeKey: 'strength-session',
    generator: 'proposer/v1',
    confidence: 0.7,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as EventCandidateEntity;
}

describe('CandidateService', () => {
  let service: CandidateService;
  let repo: {
    findOne: jest.Mock;
    save: jest.Mock;
    create: jest.Mock;
  };
  let events: { create: jest.Mock };
  let qb: ReturnType<typeof makeQueryBuilder>;

  async function setup(many: unknown[] = []) {
    qb = makeQueryBuilder(many);
    repo = {
      findOne: jest.fn(),
      save: jest.fn(async (entity: EventCandidateEntity) => entity),
      create: jest.fn((entity: EventCandidateEntity) => entity),
    };
    events = { create: jest.fn(async () => [{ id: 'event-9' }]) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        CandidateService,
        { provide: getRepositoryToken(EventCandidateEntity), useValue: repo },
        { provide: EventService, useValue: events },
        {
          provide: DataSource,
          useValue: { getRepository: jest.fn(() => ({ createQueryBuilder: jest.fn(() => qb) })) },
        },
        { provide: LoggerService, useValue: { setContext: jest.fn(), log: jest.fn(), debug: jest.fn() } },
      ],
    }).compile();

    service = moduleRef.get(CandidateService);
  }

  describe('findInRange', () => {
    const from = new Date('2026-08-03T00:00:00Z');
    const to = new Date('2026-08-10T00:00:00Z');

    it('surfaces open candidates and snoozed ones whose deferral has elapsed', async () => {
      await setup();

      await service.findInRange(ctx, from, to);

      const clause = (qb.calls.andWhere ?? [])
        .map(([c]) => String(c))
        .find((c) => c.includes("status = 'open'"));

      expect(clause).toContain("candidate.status = 'snoozed' AND candidate.snoozed_until <= NOW()");
    });

    it('does not surface declined or accepted candidates', async () => {
      await setup();

      await service.findInRange(ctx, from, to);

      const clauses = (qb.calls.andWhere ?? []).map(([c]) => String(c)).join(' ');
      expect(clauses).not.toContain('declined');
      expect(clauses).not.toContain('accepted');
    });

    it('ranks by fit score, best first', async () => {
      await setup();

      await service.findInRange(ctx, from, to);

      expect(qb.calls.orderBy?.[0]).toEqual(['candidate.fit_score', 'DESC', 'NULLS LAST']);
    });
  });

  describe('upsert', () => {
    it('refreshes an existing open candidate rather than duplicating it', async () => {
      await setup();
      repo.findOne.mockResolvedValue(baseCandidate({ id: 'existing-1' }));

      const [result] = await service.upsert(ctx, [
        {
          title: 'Strength session',
          rationale: 'Updated reasoning.',
          window_start: new Date('2026-08-03T00:00:00Z'),
          window_end: new Date('2026-08-10T00:00:00Z'),
          dedupe_key: 'strength-session',
        },
      ]);

      expect(result.id).toBe('existing-1');
      expect(result.rationale).toBe('Updated reasoning.');
    });

    it('refuses to resurrect a candidate the user already declined', async () => {
      await setup();
      repo.findOne.mockResolvedValue(baseCandidate({ status: 'never' }));

      const result = await service.upsert(ctx, [
        {
          title: 'Strength session',
          rationale: 'Trying again.',
          window_start: new Date('2026-08-03T00:00:00Z'),
          window_end: new Date('2026-08-10T00:00:00Z'),
          dedupe_key: 'strength-session',
        },
      ]);

      expect(result).toHaveLength(0);
      expect(repo.save).not.toHaveBeenCalled();
    });
  });

  describe('accept', () => {
    const start = new Date('2026-08-06T18:00:00Z');

    it('mints a committed event and links it back to the candidate', async () => {
      await setup();
      repo.findOne.mockResolvedValue(baseCandidate());

      const { candidate, event } = await service.accept(ctx, 'cand-1', start);

      expect(events.create).toHaveBeenCalledTimes(1);
      expect(candidate.status).toBe('accepted');
      expect(candidate.promotedEventId).toBe('event-9');
      // The minted event comes back with the candidate so the caller need not
      // re-query to render what was just placed.
      expect(event.id).toBe('event-9');
    });

    it('writes the event as committed fact, not as a prediction', async () => {
      await setup();
      repo.findOne.mockResolvedValue(baseCandidate());

      await service.accept(ctx, 'cand-1', start);

      const [, dto] = events.create.mock.calls[0];
      expect(dto.is_predicted).toBe(false);
      expect(dto.status).toBe('confirmed');
    });

    it('carries provenance onto the event so the trail survives promotion', async () => {
      await setup();
      repo.findOne.mockResolvedValue(baseCandidate());

      await service.accept(ctx, 'cand-1', start);

      const [, dto] = events.create.mock.calls[0];
      expect(dto.inference_sources).toMatchObject({
        candidate_id: 'cand-1',
        rationale: 'Shoulder rehab shows up in 4 notes since June.',
      });
    });

    it('derives the end time from the estimated duration when none is given', async () => {
      await setup();
      repo.findOne.mockResolvedValue(baseCandidate({ durationMinutes: 90 }));

      await service.accept(ctx, 'cand-1', start);

      const [, dto] = events.create.mock.calls[0];
      expect(dto.end_time).toEqual(new Date('2026-08-06T19:30:00Z'));
    });

    it('honours an explicit end time over the estimate', async () => {
      await setup();
      repo.findOne.mockResolvedValue(baseCandidate({ durationMinutes: 90 }));
      const end = new Date('2026-08-06T18:45:00Z');

      await service.accept(ctx, 'cand-1', start, end);

      const [, dto] = events.create.mock.calls[0];
      expect(dto.end_time).toBe(end);
    });

    it('rejects a double-accept instead of minting a second event', async () => {
      await setup();
      repo.findOne.mockResolvedValue(baseCandidate({ status: 'accepted', promotedEventId: 'event-1' }));

      await expect(service.accept(ctx, 'cand-1', start)).rejects.toThrow(BadRequestException);
      expect(events.create).not.toHaveBeenCalled();
    });

    it('throws when the candidate does not belong to the viewer', async () => {
      await setup();
      repo.findOne.mockResolvedValue(null);

      await expect(service.accept(ctx, 'cand-1', start)).rejects.toThrow(NotFoundException);
    });
  });

  describe('decline', () => {
    it('retires the idea permanently on "never"', async () => {
      await setup();
      repo.findOne.mockResolvedValue(baseCandidate());

      const result = await service.decline(ctx, 'cand-1', 'never');

      expect(result.status).toBe('never');
      expect(result.feedbackReason).toBe('never');
    });

    it('keeps a "wrong time" rejection recoverable and records the reason', async () => {
      await setup();
      repo.findOne.mockResolvedValue(baseCandidate());

      const result = await service.decline(ctx, 'cand-1', 'wrong_time');

      expect(result.status).toBe('declined');
      expect(result.feedbackReason).toBe('wrong_time');
    });
  });

  describe('snooze', () => {
    it('defers a candidate to a future instant', async () => {
      await setup();
      repo.findOne.mockResolvedValue(baseCandidate());
      const until = new Date(Date.now() + 86_400_000);

      const result = await service.snooze(ctx, 'cand-1', until);

      expect(result.status).toBe('snoozed');
      expect(result.snoozedUntil).toBe(until);
    });

    it('rejects a snooze into the past, which would silently re-surface it', async () => {
      await setup();
      repo.findOne.mockResolvedValue(baseCandidate());

      await expect(service.snooze(ctx, 'cand-1', new Date(Date.now() - 1000))).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});
