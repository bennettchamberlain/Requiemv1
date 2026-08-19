import type { DataSource } from 'typeorm';

import type { FeatureService } from '@ci/common/feature';
import type { LoggerService } from '@ci/common/logging';

import { PythonFunctionCrons } from '../cron/PythonFunctionCrons';
import type { PythonFunctionService } from '../services/PythonFunctionService';

const logger = { setContext() {}, log() {}, warn() {}, error() {} } as unknown as LoggerService;

/**
 * @param userIds onboarded users (`SELECT id FROM ci.users …`).
 * @param usersWithSummaries users the dossier precondition query returns;
 *   defaults to every onboarded user so the un-gated crons are unaffected.
 */
function makeCrons(userIds: string[], smartRotation = false, usersWithSummaries = userIds) {
  const rows = (ids: string[]) => ids.map((id) => ({ id }));
  // Untyped on purpose: assertions read the bound parameters (calls[n][1]),
  // which a one-argument signature would type away.
  const query: jest.Mock = jest.fn(async (sql: string) =>
    sql.includes('ci.summaries') ? rows(usersWithSummaries) : rows(userIds),
  );
  const dataSource = { query } as unknown as DataSource;
  const pythonFunctionService = {
    dispatch: jest.fn().mockResolvedValue(true),
  } as unknown as PythonFunctionService;
  const featureService = {
    isFeatureEnabled: jest.fn().mockResolvedValue(smartRotation),
  } as unknown as FeatureService;

  return {
    crons: new PythonFunctionCrons(dataSource, pythonFunctionService, logger, featureService),
    pythonFunctionService,
    query,
  };
}

describe('PythonFunctionCrons', () => {
  it('fans hourly summaries out per onboarded user with an hour-window singleton key', async () => {
    const { crons, pythonFunctionService } = makeCrons(['user-1', 'user-2']);

    await crons.hourlySummaries();

    expect(pythonFunctionService.dispatch).toHaveBeenCalledTimes(2);

    const hourKey = new Date().toISOString().slice(0, 13);

    expect(pythonFunctionService.dispatch).toHaveBeenCalledWith(
      'summary',
      'hourly_summary',
      'user-1',
      {},
      { singletonKey: `fn:hourly_summary:user-1:${hourKey}` },
    );
    expect(pythonFunctionService.dispatch).toHaveBeenCalledWith(
      'summary',
      'hourly_summary',
      'user-2',
      {},
      { singletonKey: `fn:hourly_summary:user-2:${hourKey}` },
    );
  });

  it('scopes nightly HBPE singleton keys to the UTC day', async () => {
    const { crons, pythonFunctionService } = makeCrons(['user-1']);

    await crons.hbpeNightly();

    const dayKey = new Date().toISOString().slice(0, 10);

    expect(pythonFunctionService.dispatch).toHaveBeenCalledWith(
      'hbpe',
      'nightly',
      'user-1',
      {},
      { singletonKey: `fn:nightly:user-1:${dayKey}` },
    );
  });

  it('keeps fanning out when one user fails to enqueue', async () => {
    const { crons, pythonFunctionService } = makeCrons(['user-1', 'user-2']);

    (pythonFunctionService.dispatch as jest.Mock)
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(true);

    await expect(crons.insights()).resolves.toBeUndefined();
    expect(pythonFunctionService.dispatch).toHaveBeenCalledTimes(2);
  });

  it('does nothing when no users are onboarded', async () => {
    const { crons, pythonFunctionService } = makeCrons([]);

    await crons.dailySummaries();

    expect(pythonFunctionService.dispatch).not.toHaveBeenCalled();
  });

  /**
   * dossier_refresh reads the last 30 days of hourly/daily summaries and has
   * nothing to build without them. Hourly summaries run at :05 and this cron
   * at :12, so on a quiet appliance the un-gated fan-out enqueued a job per
   * user per hour whose only possible outcome was "no summaries" — 19 dead
   * letters on the QA box before the Python side stopped raising.
   */
  describe('dossier refresh precondition', () => {
    it('does not enqueue for a user with no summaries in the lookback window', async () => {
      const { crons, pythonFunctionService, query } = makeCrons(['user-1'], false, []);

      await crons.dossierRefresh();

      expect(pythonFunctionService.dispatch).not.toHaveBeenCalled();
      expect(query.mock.calls[0][0]).toContain('ci.summaries');
      expect(query.mock.calls[0][1]).toEqual([30]);
    });

    it('enqueues only the users that have summaries to build from', async () => {
      const { crons, pythonFunctionService } = makeCrons(['user-1', 'user-2'], false, ['user-2']);

      await crons.dossierRefresh();

      const hourKey = new Date().toISOString().slice(0, 13);

      expect(pythonFunctionService.dispatch).toHaveBeenCalledTimes(1);
      expect(pythonFunctionService.dispatch).toHaveBeenCalledWith(
        'summary',
        'dossier_refresh',
        'user-2',
        { lookback_days: 30 },
        { singletonKey: `fn:dossier_refresh:user-2:${hourKey}` },
      );
    });

    it('leaves the other crons on the full onboarded population', async () => {
      const { crons, pythonFunctionService } = makeCrons(['user-1'], false, []);

      await crons.hourlySummaries();
      await crons.actions();

      expect(pythonFunctionService.dispatch).toHaveBeenCalledTimes(2);
    });
  });

  describe('under smart.rotation', () => {
    it.each([['insights'], ['hourlySummaries'], ['dossierRefresh']] as const)(
      'cedes %s to SmartRotationListener instead of double-enqueuing',
      async (method) => {
        const { crons, pythonFunctionService } = makeCrons(['user-1'], true);

        await crons[method]();

        expect(pythonFunctionService.dispatch).not.toHaveBeenCalled();
      },
    );

    it.each([
      ['dailySummaries'],
      ['weeklySummaries'],
      ['monthlySummaries'],
      ['actions'],
      ['hbpeNightly'],
    ] as const)('still runs %s, which smart rotation has no equivalent for', async (method) => {
      const { crons, pythonFunctionService } = makeCrons(['user-1'], true);

      await crons[method]();

      expect(pythonFunctionService.dispatch).toHaveBeenCalledTimes(1);
    });
  });
});
