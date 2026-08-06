import { BadRequestException, ForbiddenException } from '@nestjs/common';

import { type RequestContext } from '@ci/common/context';
import { type EventCandidate } from '@ci/domains/schedule';

import { GlobalUID } from '../../types/GlobalUID';
import { ScheduleCandidateResolver } from '../ScheduleCandidateResolver';

/**
 * Resolver-layer tests for the schedule surface. The service-layer suites all
 * mock the repository, so nothing previously crossed the GraphQL boundary —
 * which is exactly where the id encoding, the feature gate and the argument
 * validation live.
 *
 * Covered here:
 *  - returnEventToSlate must hand the service a raw uuid, not the GlobalUID the
 *    client was given. `promoted_event_id` is a uuid column; the encoded id
 *    made Postgres raise 22P02 and turned the whole mutation into a 500.
 *  - `schedule.page` gates every method, not just the React route.
 *  - declineCandidate rejects reasons outside the DeclineReason vocabulary
 *    instead of blind-casting them.
 */

const ownerCtx = { userId: 'owner-1' } as unknown as RequestContext;

const RAW_EVENT_ID = '00000000-0000-0000-0000-0000000000e1';
const CANDIDATE_ID = '00000000-0000-0000-0000-0000000000c1';

const sampleCandidate = {
  id: CANDIDATE_ID,
  title: 'Call the dentist',
  description: null,
  rationale: 'You said this was overdue',
  rationaleSources: [],
  windowStart: new Date('2026-08-01T00:00:00Z'),
  windowEnd: new Date('2026-08-08T00:00:00Z'),
  timeFlex: 'week',
  durationMinutes: 15,
  l0Class: null,
  energyCost: null,
  fitScore: null,
  status: 'open',
  generator: 'adapter/action',
  confidence: 0.5,
} as unknown as EventCandidate;

const sampleEvent = {
  id: RAW_EVENT_ID,
  category: 'activity',
  title: 'Call the dentist',
  startTime: new Date('2026-08-04T15:00:00Z'),
  endTime: new Date('2026-08-04T15:15:00Z'),
  metadata: {},
};

function makeResolver(enabled = true) {
  const candidateService = {
    findInRange: jest.fn().mockResolvedValue([sampleCandidate]),
    accept: jest.fn().mockResolvedValue({ candidate: sampleCandidate, event: sampleEvent }),
    returnToSlate: jest.fn().mockResolvedValue(sampleCandidate),
    decline: jest.fn().mockResolvedValue(sampleCandidate),
    snooze: jest.fn().mockResolvedValue(sampleCandidate),
  };

  const suggestionSyncService = { sync: jest.fn().mockResolvedValue(7) };
  const taskBreakdownService = { breakDown: jest.fn().mockResolvedValue([sampleCandidate]) };
  const featureService = { isFeatureEnabled: jest.fn().mockResolvedValue(enabled) };
  const logger = { setContext: jest.fn(), log: jest.fn(), debug: jest.fn(), error: jest.fn() };

  return {
    resolver: new ScheduleCandidateResolver(
      candidateService as never,
      suggestionSyncService as never,
      taskBreakdownService as never,
      featureService as never,
      logger as never,
    ),
    candidateService,
    suggestionSyncService,
    taskBreakdownService,
    featureService,
  };
}

describe('ScheduleCandidateResolver.returnEventToSlate', () => {
  beforeEach(() => jest.clearAllMocks());

  it('decodes the GlobalUID and passes the raw uuid to the service', async () => {
    const { resolver, candidateService } = makeResolver();

    const gid = GlobalUID.encode('event', RAW_EVENT_ID);
    // Guard the premise: the id the client holds is genuinely not a uuid.
    expect(gid).not.toBe(RAW_EVENT_ID);

    const result = await resolver.returnEventToSlate(ownerCtx, gid);

    expect(candidateService.returnToSlate).toHaveBeenCalledWith({ userId: 'owner-1' }, RAW_EVENT_ID);
    expect(result.id).toBe(CANDIDATE_ID);
  });

  it('round-trips the exact id EventType.toType hands the client', async () => {
    const { resolver, candidateService } = makeResolver();

    // What the calendar actually serialises into the drag payload.
    const idFromApi = GlobalUID.encode('event', RAW_EVENT_ID);

    await resolver.returnEventToSlate(ownerCtx, idFromApi);

    const [, passedId] = candidateService.returnToSlate.mock.calls[0];
    expect(passedId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('rejects an id encoded for a different resource rather than querying with it', async () => {
    const { resolver, candidateService } = makeResolver();

    const wrongType = GlobalUID.encode('note', RAW_EVENT_ID);

    await expect(resolver.returnEventToSlate(ownerCtx, wrongType)).rejects.toThrow(
      'Unexpected global id type',
    );
    expect(candidateService.returnToSlate).not.toHaveBeenCalled();
  });
});

describe('ScheduleCandidateResolver feature gating', () => {
  beforeEach(() => jest.clearAllMocks());

  it('gates every method on schedule.page', async () => {
    const { resolver, featureService } = makeResolver();

    await resolver.scheduleCandidates(ownerCtx, new Date(), new Date());

    expect(featureService.isFeatureEnabled).toHaveBeenCalledWith('schedule.page');
  });

  it('returns an empty slate without reading when the flag is off', async () => {
    const { resolver, candidateService } = makeResolver(false);

    expect(await resolver.scheduleCandidates(ownerCtx, new Date(), new Date())).toEqual([]);
    expect(candidateService.findInRange).not.toHaveBeenCalled();
  });

  it('writes nothing from syncScheduleSuggestions when the flag is off', async () => {
    const { resolver, suggestionSyncService } = makeResolver(false);

    expect(await resolver.syncScheduleSuggestions(ownerCtx)).toBe(0);
    expect(suggestionSyncService.sync).not.toHaveBeenCalled();
  });

  it('does not spend an LLM call on breakDownTasks when the flag is off', async () => {
    const { resolver, taskBreakdownService } = makeResolver(false);

    expect(await resolver.breakDownTasks(ownerCtx, 'buy milk, call mum')).toEqual([]);
    expect(taskBreakdownService.breakDown).not.toHaveBeenCalled();
  });

  it.each([
    [
      'acceptCandidate',
      (r: ScheduleCandidateResolver) => r.acceptCandidate(ownerCtx, CANDIDATE_ID, new Date()),
      'accept' as const,
    ],
    [
      'returnEventToSlate',
      (r: ScheduleCandidateResolver) =>
        r.returnEventToSlate(ownerCtx, GlobalUID.encode('event', RAW_EVENT_ID)),
      'returnToSlate' as const,
    ],
    [
      'declineCandidate',
      (r: ScheduleCandidateResolver) => r.declineCandidate(ownerCtx, CANDIDATE_ID, 'not_now'),
      'decline' as const,
    ],
    [
      'snoozeCandidate',
      (r: ScheduleCandidateResolver) =>
        r.snoozeCandidate(ownerCtx, CANDIDATE_ID, new Date(Date.now() + 86_400_000)),
      'snooze' as const,
    ],
  ])('rejects %s when the flag is off, without touching the service', async (_name, call, method) => {
    const { resolver, candidateService } = makeResolver(false);

    await expect(call(resolver)).rejects.toBeInstanceOf(ForbiddenException);
    expect(candidateService[method]).not.toHaveBeenCalled();
  });

  it('lets the mutations through when the flag is on', async () => {
    const { resolver, candidateService } = makeResolver();

    const event = await resolver.acceptCandidate(ownerCtx, CANDIDATE_ID, new Date());

    expect(candidateService.accept).toHaveBeenCalled();
    expect(event.id).toBe(GlobalUID.encode('event', RAW_EVENT_ID));
  });
});

describe('ScheduleCandidateResolver.declineCandidate', () => {
  beforeEach(() => jest.clearAllMocks());

  it.each(['not_now', 'wrong_time', 'not_like_this', 'never'])(
    'passes the documented reason %s straight through',
    async (reason) => {
      const { resolver, candidateService } = makeResolver();

      await resolver.declineCandidate(ownerCtx, CANDIDATE_ID, reason);

      expect(candidateService.decline).toHaveBeenCalledWith({ userId: 'owner-1' }, CANDIDATE_ID, reason);
    },
  );

  it.each(['Never', 'NOT_NOW', 'nope', '', 'source_dismissed'])(
    'rejects %p rather than storing it',
    async (reason) => {
      const { resolver, candidateService } = makeResolver();

      await expect(resolver.declineCandidate(ownerCtx, CANDIDATE_ID, reason)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(candidateService.decline).not.toHaveBeenCalled();
    },
  );

  it('names the accepted vocabulary in the error', async () => {
    const { resolver } = makeResolver();

    await expect(resolver.declineCandidate(ownerCtx, CANDIDATE_ID, 'Never')).rejects.toThrow(
      'not_now, wrong_time, not_like_this, never',
    );
  });
});
