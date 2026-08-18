import { randomUUID } from 'node:crypto';

import { DataSource } from 'typeorm';

import { databaseAvailability, resolveConnection } from '../../__tests__/harness/pipelineHarness';
import {
  loadBrowserActivityRows,
  loadCommunicationRows,
  loadContentRows,
  loadEventRows,
  loadFileRows,
  loadItemRows,
  loadPersonRows,
} from '../index/entityRows';

/**
 * Every index-stage row loader, EXECUTED against the real schema.
 *
 * The unit specs mock the DataSource, so a loader whose SQL names a column the
 * schema no longer has passes every one of them and then fails on every real
 * slice — which is precisely what happened: content's title moved to the CTI
 * base row, `SELECT c.title` kept shipping, and 5,562 ledger rows piled up as
 * `stage_threw: column c.title does not exist` before anyone looked. Running
 * each loader once with a random id is enough — Postgres validates columns
 * before it cares that no row matches.
 */

const availability = databaseAvailability();
const describeWithDatabase = availability.available ? describe : describe.skip;

if (!availability.available) {
  console.warn(`[pipeline/entityRows.integration] SKIPPED — ${availability.reason}`);
}

jest.setTimeout(60_000);

describeWithDatabase(`entityRows loaders agree with the live schema (${availability.target})`, () => {
  let dataSource: DataSource;

  beforeAll(async () => {
    const connection = resolveConnection();

    if (connection == null) {
      throw new Error('databaseAvailability passed but no connection resolved');
    }

    dataSource = new DataSource({
      type: 'postgres',
      // Discrete fields when there is no URL, so a password containing URL
      // metacharacters (the dev one ends in `!`) never has to survive a round
      // trip through percent-encoding.
      ...(connection.url != null
        ? { url: connection.url }
        : {
            host: connection.host,
            port: connection.port,
            username: connection.username,
            password: connection.password,
            database: connection.database,
          }),
    });
    await dataSource.initialize();
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.destroy();
    }
  });

  const LOADERS = [
    ['content', loadContentRows],
    ['communication', loadCommunicationRows],
    ['event', loadEventRows],
    ['item', loadItemRows],
    ['person', loadPersonRows],
    ['file', loadFileRows],
    ['browser-activity', loadBrowserActivityRows],
  ] as const;

  it.each(LOADERS)('%s loader executes cleanly', async (_type, loader) => {
    // A random user + random id: no row can match, but Postgres validates the
    // SQL — columns, joins, casts — before it cares about that.
    await expect(loader(dataSource, randomUUID(), [randomUUID()])).resolves.toEqual([]);
  });
});
