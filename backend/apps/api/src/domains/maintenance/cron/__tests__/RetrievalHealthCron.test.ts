import { SCHEDULE_CRON_OPTIONS } from '@nestjs/schedule/dist/schedule.constants';

import { PersonalizationService, type TrustMode } from '@ci/domains/personalization';

import type { RetrievalHealthAlert, RetrievalHealthRun } from '../../services/RetrievalHealthService';
import { ALERT_REPEAT_DAYS, RETRIEVAL_HEALTH_CRON, RetrievalHealthCron } from '../RetrievalHealthCron';

/**
 * The appliance has ~43 crons that DO things and, before this one, none that
 * KNOW anything. What has to hold for the knowing job to be worth having:
 *
 *  - it measures unconditionally, and only the CARDS are gated;
 *  - the card reports a fact about the machine, so the personal trust dial does
 *    not suppress it — and the cron does not pretend to ask;
 *  - it does not say the same thing every night;
 *  - it runs on the worker, off second 0.
 */

const TRUST_MODES: readonly TrustMode[] = ['cautious', 'balanced', 'hands_off'];

const ALERT: RetrievalHealthAlert = {
  entityType: 'content',
  reason: 'vector_zero',
  key: 'retrieval_health:content:vector_zero',
  title: 'Search cannot find your content records',
  text: 'All 366,862 content records are missing from the search index.',
  detail: { total: 366862, embedded: 366862, vectored: 0 },
};

const USER = '00000000-0000-0000-0000-0000000000aa';
const SELF_ENTITY = '00000000-0000-0000-0000-0000000000se';

/**
 * A real {@link PersonalizationService}, resolving to a self Person whose
 * `planner.trust_mode` is the mode under test. Only the two repositories it
 * reads through are stubbed, so the profile and every decision come from the
 * service itself.
 */
function makePersonalization(trustMode: TrustMode): PersonalizationService {
  const userContextService = {
    getSelfIdentity: jest.fn(async () => ({ entityId: SELF_ENTITY, aliases: ['me'] })),
  };
  const personService = {
    findById: jest.fn(async () => ({ id: SELF_ENTITY, properties: { planner: { trust_mode: trustMode } } })),
  };

  return new PersonalizationService(personService as never, userContextService as never);
}

function makeRun(alerts: RetrievalHealthAlert[] = [ALERT]): RetrievalHealthRun {
  return {
    runId: '11111111-1111-4111-8111-111111111111',
    capturedAt: new Date('2026-08-21T03:40:50.000Z'),
    perType: {},
    baselines: {},
    alerts,
    persisted: 18,
    pruned: 0,
  };
}

function makeCron(
  options: {
    alerts?: RetrievalHealthAlert[];
    actionsEnabled?: boolean;
    recentKeys?: string[];
    users?: string[];
  } = {},
) {
  const queries: Array<{ sql: string; params: unknown[] }> = [];

  const dataSource = {
    query: jest.fn(async (sql: string, params: unknown[] = []) => {
      queries.push({ sql, params });

      if (sql.includes('FROM ci.users')) {
        return (options.users ?? [USER]).map((id) => ({ id }));
      }

      if (sql.includes('FROM ci.actions')) {
        return (options.recentKeys ?? []).includes(params[1] as string) ? [{ '?column?': 1 }] : [];
      }

      return [];
    }),
  };

  const retrievalHealthService = { capture: jest.fn(async () => makeRun(options.alerts)) };
  const actionService = { create: jest.fn(async () => ({ id: 'action' })) };
  const featureService = { isFeatureEnabled: jest.fn(async () => options.actionsEnabled ?? true) };
  const logger = { setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn() };

  const cron = new RetrievalHealthCron(
    dataSource as never,
    retrievalHealthService as never,
    actionService as never,
    featureService as never,
    logger as never,
  );

  return {
    cron,
    dataSource,
    retrievalHealthService,
    actionService,
    featureService,
    logger,
    queries,
  };
}

describe('RetrievalHealthCron schedule', () => {
  it('is registered with the seconds field set, and not on second 0', () => {
    const options = Reflect.getMetadata(
      SCHEDULE_CRON_OPTIONS,
      RetrievalHealthCron.prototype.captureRetrievalHealth,
    ) as { cronTime?: string; name?: string } | undefined;

    expect(options?.cronTime).toBe(RETRIEVAL_HEALTH_CRON);

    const fields = RETRIEVAL_HEALTH_CRON.trim().split(/\s+/);

    // Six fields: five would be read as second 0, which is the pile-up.
    expect(fields).toHaveLength(6);
    expect(fields[0]).toMatch(/^\d+$/);
    expect(fields[0]).not.toBe('0');
  });

  it('takes a second no recurring schedule holds', () => {
    // Seconds claimed by the sub-hourly and hourly schedules — the ones that
    // fire in EVERY hour and so can coincide with a nightly job whatever hour
    // it picks. See common/schedule/__tests__/cronSecondOffsets.test.ts.
    const claimed = ['10', '20', '25', '30', '35', '40', '45'];
    const [seconds] = RETRIEVAL_HEALTH_CRON.trim().split(/\s+/);

    expect(claimed).not.toContain(seconds);
  });

  it('carries an explicit registry name so the durable cron_runs stamp matches', () => {
    const options = Reflect.getMetadata(
      SCHEDULE_CRON_OPTIONS,
      RetrievalHealthCron.prototype.captureRetrievalHealth,
    ) as { name?: string } | undefined;

    expect(options?.name).toBe('RetrievalHealthCron.captureRetrievalHealth');
  });

  it('registers only where the worker role is served', () => {
    const registersUnder = (served: 'web' | 'worker'): boolean => {
      let registered = false;

      jest.isolateModules(() => {
        jest.doMock('@ci/common/roles', () => ({
          processRole: () => served,
          serves: (target: string) => target === served,
        }));
        // Registration is the subject; the collaborator barrels are a large
        // module graph this test has no use for, and re-requiring them twice
        // costs ~20s.
        jest.doMock('@ci/domains/intelligence', () => ({ ActionService: class {} }));
        jest.doMock('../../services/RetrievalHealthService', () => ({ RetrievalHealthService: class {} }));

        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const module = require('../RetrievalHealthCron') as typeof import('../RetrievalHealthCron');

        registered =
          Reflect.getMetadata(
            SCHEDULE_CRON_OPTIONS,
            module.RetrievalHealthCron.prototype.captureRetrievalHealth,
          ) != null;
      });

      jest.dontMock('@ci/common/roles');
      jest.dontMock('@ci/domains/intelligence');
      jest.dontMock('../../services/RetrievalHealthService');

      return registered;
    };

    expect(registersUnder('worker')).toBe(true);
    // A sweep of whole-table counts running in both processes is double the
    // counts and double the cards.
    expect(registersUnder('web')).toBe(false);
  });
});

describe('RetrievalHealthCron.captureRetrievalHealth', () => {
  it('captures the snapshot and raises one card per alert', async () => {
    const { cron, actionService, retrievalHealthService } = makeCron();

    await cron.captureRetrievalHealth();

    expect(retrievalHealthService.capture).toHaveBeenCalledTimes(1);
    expect(actionService.create).toHaveBeenCalledTimes(1);

    const [context, dto] = actionService.create.mock.calls[0] as unknown as [
      { userId: string },
      { title: string; metadata: Record<string, unknown>; source: string },
    ];

    expect(context.userId).toBe(USER);
    expect(dto.title).toBe(ALERT.title);
    expect(dto.metadata).toMatchObject({
      key: ALERT.key,
      kind: 'retrieval_health',
      reason: 'vector_zero',
      entityType: 'content',
      vectored: 0,
    });
    // 'anomaly'/'suggestion' share the Brief's three-cards-a-day producer cap;
    // an infrastructure alert must not spend it.
    expect(dto.source).toBe('legacy');
  });

  it('measures even when the alert cards are switched off', async () => {
    const { cron, retrievalHealthService, actionService, logger } = makeCron({ actionsEnabled: false });

    await cron.captureRetrievalHealth();

    // The measurement is the point; the flag only silences the cards.
    expect(retrievalHealthService.capture).toHaveBeenCalledTimes(1);
    expect(actionService.create).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('actions feature disabled'),
      expect.anything(),
    );
  });

  it('does not repeat a card the user was already shown this week', async () => {
    const { cron, actionService, queries } = makeCron({ recentKeys: [ALERT.key] });

    await cron.captureRetrievalHealth();

    expect(actionService.create).not.toHaveBeenCalled();

    const probe = queries.find((entry) => entry.sql.includes('FROM ci.actions'));

    expect(probe?.params).toEqual([USER, ALERT.key, ALERT_REPEAT_DAYS]);
  });

  it('raises the card for a different alert key even while another is open', async () => {
    const other: RetrievalHealthAlert = {
      ...ALERT,
      reason: 'embed_zero',
      key: 'retrieval_health:event:embed_zero',
    };
    const { cron, actionService } = makeCron({ alerts: [ALERT, other], recentKeys: [ALERT.key] });

    await cron.captureRetrievalHealth();

    expect(actionService.create).toHaveBeenCalledTimes(1);
    const [, dto] = actionService.create.mock.calls[0] as unknown as [unknown, { metadata: { key: string } }];

    expect(dto.metadata.key).toBe(other.key);
  });

  it('does not touch the feed at all when nothing is wrong', async () => {
    const { cron, actionService, featureService } = makeCron({ alerts: [] });

    await cron.captureRetrievalHealth();

    expect(featureService.isFeatureEnabled).not.toHaveBeenCalled();
    expect(actionService.create).not.toHaveBeenCalled();
  });

  it('keeps going for the other users when one card fails', async () => {
    const second = '00000000-0000-0000-0000-0000000000bb';
    const { cron, actionService, logger } = makeCron({ users: [USER, second] });

    actionService.create.mockRejectedValueOnce(new Error('feed write failed'));

    await cron.captureRetrievalHealth();

    expect(actionService.create).toHaveBeenCalledTimes(2);
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('Failed to raise retrieval-health alert'),
      expect.objectContaining({ userId: USER }),
    );
  });
});

/**
 * These alerts are UNGATED by the personal trust dial, and that is a decision,
 * not an oversight — so it is tested against the real
 * {@link PersonalizationService} rather than a stub that can be told to say
 * anything. A stubbed `decideAction` returning `'skip'` is exactly how the
 * dead gate this replaced managed to look protective for a whole review cycle.
 */
describe('RetrievalHealthCron trust dial', () => {
  it.each(TRUST_MODES)('raises the card in %s mode, and the dial could not have refused it', async (mode) => {
    const personalization = makePersonalization(mode);

    // The question the cron used to ask. A COUNT is confidence 1, and at 1
    // every mode auto-promotes a feed_action — cautious included (its
    // threshold IS 1). There was never an answer the cron could act on.
    await expect(
      personalization.decideAction(USER, { kind: 'feed_action', confidence: 1, hasUserInput: false }),
    ).resolves.toBe('auto');
    await expect(personalization.getTrustMode(USER)).resolves.toBe(mode);

    const { cron, actionService } = makeCron();

    await cron.captureRetrievalHealth();

    expect(actionService.create).toHaveBeenCalledTimes(1);
  });

  it('does not inject the trust dial, so no dead gate can grow back', () => {
    // The only seam left: what Nest hands the constructor. A reinstated
    // `decideAction` call needs the service back in here first.
    const injected = (Reflect.getMetadata('design:paramtypes', RetrievalHealthCron) ?? []) as unknown[];

    expect(injected).not.toHaveLength(0);
    expect(injected).not.toContain(PersonalizationService);
  });
});
