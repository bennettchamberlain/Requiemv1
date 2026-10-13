import { ScratchDatabase, scratchDatabaseAvailability } from '../../__tests__/support/scratchDatabase';
import { CONNECTION_SCOPED_TABLES, USER_OWNED_TABLES } from '../dataDeletionPlan';

/**
 * The disconnect and account-deletion plans name tables and columns as
 * strings; a typo there is a delete that silently matches nothing. Checked
 * against a migrated database, for what the migrations create — the hbpe
 * schema in the user-owned plan is built by its own sidecar and is not there.
 *
 * Skips (loudly) when there is no administrative connection; see
 * `domains/__tests__/support/scratchDatabase.ts`.
 */

const availability = scratchDatabaseAvailability();
const describeWithDatabase = availability.available ? describe : describe.skip;

if (!availability.available) {
  console.warn(`[dataDeletionPlan.integration] SKIPPED — ${availability.reason}`);
}

jest.setTimeout(600_000);

describeWithDatabase(`data-deletion plans, against real Postgres (${availability.target})`, () => {
  let scratch: ScratchDatabase;

  beforeAll(async () => {
    scratch = await ScratchDatabase.create({ createdBy: 'dataDeletionPlan.integration.spec' });
    await scratch.assertOwn();
  });

  afterAll(async () => {
    await scratch?.drop();
  });

  it('every connection-scoped and ci_etl table the plans name exists', async () => {
    const columns = await scratch.dataSource.query<Array<{ ref: string }>>(
      `SELECT table_schema || '.' || table_name || '.' || column_name AS ref FROM information_schema.columns`,
    );
    const known = new Set(columns.map((c) => c.ref));
    const missing = [
      ...CONNECTION_SCOPED_TABLES.map((t) => `${t.schema}.${t.table}.${t.connectionColumn}`),
      ...USER_OWNED_TABLES.filter((t) => t.schema === 'ci_etl').map(
        (t) => `${t.schema}.${t.table}.${t.userColumn}`,
      ),
    ].filter((ref) => !known.has(ref));

    expect(missing).toEqual([]);
  });
});
