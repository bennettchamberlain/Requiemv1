import type { LoggerService } from '@ci/common/logging';
import config from '@ci/configuration';

import type { AccountPurgeService, PurgeRunSummary } from '../../services/AccountPurgeService';
import { AccountPurgeCron } from '../AccountPurgeCron';

const emptySummary: PurgeRunSummary = {
  considered: 0,
  purged: 0,
  failed: 0,
  unpinned: 0,
  outcomes: [],
};

function build(purgeDueAccounts: jest.Mock) {
  const logger = {
    setContext: jest.fn(),
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as LoggerService;

  const service = { purgeDueAccounts } as unknown as AccountPurgeService;

  return { cron: new AccountPurgeCron(service, logger), logger };
}

describe('AccountPurgeCron', () => {
  const enabled = config.accountDeletion.purge.enabled;

  afterEach(() => {
    config.accountDeletion.purge.enabled = enabled;
  });

  it('purges due accounts on a tick', async () => {
    const purgeDueAccounts = jest.fn().mockResolvedValue(emptySummary);
    const { cron } = build(purgeDueAccounts);

    await cron.purgeDueAccounts();

    expect(purgeDueAccounts).toHaveBeenCalledTimes(1);
  });

  it('does nothing while the purge is switched off', async () => {
    config.accountDeletion.purge.enabled = false;

    const purgeDueAccounts = jest.fn().mockResolvedValue(emptySummary);
    const { cron } = build(purgeDueAccounts);

    await cron.purgeDueAccounts();

    expect(purgeDueAccounts).not.toHaveBeenCalled();
  });

  it('does not start a second run while one is still going', async () => {
    // A purge of a large account can outlast the hourly tick. Overlapping runs
    // would have two batch loops deleting the same rows out from under each
    // other; the database advisory lock catches the cross-process case, this
    // catches the cheap one.
    let release: () => void = () => undefined;
    const inFlight = new Promise<PurgeRunSummary>((resolve) => {
      release = () => resolve(emptySummary);
    });

    const purgeDueAccounts = jest.fn().mockReturnValue(inFlight);
    const { cron, logger } = build(purgeDueAccounts);

    const first = cron.purgeDueAccounts();

    await cron.purgeDueAccounts();

    expect(purgeDueAccounts).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('previous run still in progress'));

    release();
    await first;
  });

  it('clears the guard after a failure, so a transient error is not permanent', async () => {
    const purgeDueAccounts = jest
      .fn()
      .mockRejectedValueOnce(new Error('database went away'))
      .mockResolvedValueOnce(emptySummary);

    const { cron, logger } = build(purgeDueAccounts);

    await cron.purgeDueAccounts();

    expect(logger.error).toHaveBeenCalled();

    await cron.purgeDueAccounts();

    expect(purgeDueAccounts).toHaveBeenCalledTimes(2);
  });
});
