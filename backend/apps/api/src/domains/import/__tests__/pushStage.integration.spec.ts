import { randomUUID } from 'node:crypto';

import { PushStage } from '../stages/PushStage';
import type { StageRunContext } from '../types';

import { createStagingHarness, importDatabase, type StagingHarness } from './support/stagingHarness';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * THE PUSH LEDGER, AGAINST REAL POSTGRES.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The destinations themselves are mocked here — what they do with a record is
 * their own domain's business, tested there. What is NOT mocked is the part this
 * stage owns and only a database can show:
 *
 *  - `push_status` moves per ROW, so one poisoned record sits at `failed` while
 *    its 499 neighbours land. A cursor would have stranded all of them;
 *  - `entity_mappings` remembers what each staged entity resolved to, and the
 *    participants of a message are read back through it — the join that turns a
 *    staged edge into a real sender;
 *  - a resumed push reads `push_status = 'pending'`, so it costs O(remaining)
 *    and does not re-send what already went.
 */

const describeWithDatabase = importDatabase.available ? describe : describe.skip;

if (!importDatabase.available) {
  console.warn(`[import/pushStage.integration] SKIPPED — ${importDatabase.reason}`);
}

jest.setTimeout(60_000);

describeWithDatabase(`the push stage (${importDatabase.target})`, () => {
  let harness: StagingHarness;
  let teardown: () => Promise<void>;

  beforeAll(async () => {
    ({ harness, teardown } = await createStagingHarness());
  });

  afterAll(async () => {
    await teardown();
  });

  /** A stage wired to recording doubles for every destination. */
  function makeStage(overrides: { communicationCreate?: jest.Mock; personCreate?: jest.Mock } = {}) {
    const sent: Array<{ destination: string; input: Record<string, unknown> }> = [];
    const record = (destination: string) =>
      jest.fn(async (_ctx: unknown, input: Record<string, unknown>) => {
        sent.push({ destination, input });

        return { id: `${destination}-row` };
      });

    // Real uuids: `entity_mappings.server_entity_id` is a uuid column, so a
    // readable fake id ("person-alice@example.com") fails the INSERT rather than
    // an assertion, which reads as a code bug and is not one.
    const personIds = new Map<string, string>();
    const people =
      overrides.personCreate ??
      jest.fn(async (_ctx: unknown, input: { linkedId?: string }) => {
        const handle = input.linkedId ?? 'unknown';
        const id = personIds.get(handle) ?? randomUUID();

        personIds.set(handle, id);

        return { id };
      });

    const communications = { create: overrides.communicationCreate ?? record('communications') };

    const stage = new PushStage(
      harness.dataSource,
      communications as never,
      { create: record('content') } as never,
      { create: record('events') } as never,
      { create: record('inventory') } as never,
      { create: record('position') } as never,
      { create: record('browser_activity') } as never,
      { create: people } as never,
      { setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), debug: jest.fn() } as never,
    );

    return { stage, sent, people, communications, personIds };
  }

  function contextFor(runId: string): StageRunContext {
    return {
      userId: harness.userId,
      runId,
      stageId: '44444444-4444-4444-8444-444444444444',
      scratchDir: '/var/tmp/ci-import/test',
      progress: async () => undefined,
    };
  }

  /** Stage one email with a sender and two recipients, the shape gmail emits. */
  async function stageEmailWithParticipants(): Promise<string> {
    const runId = await harness.startRun();
    const { dataSource, userId } = harness;

    const [item] = await dataSource.query<Array<{ id: string }>>(
      `INSERT INTO ci_import.staged_items
         (run_id, user_id, data_source, classification, content_hash, occurred_at, metadata)
       VALUES ($1::uuid, $2::uuid, 'gmail', 'email', 'msg-1', now(), '{"Subject":"Hello"}'::jsonb)
       RETURNING id`,
      [runId, userId],
    );

    for (const [handle, relation] of [
      ['alice@example.com', 'from'],
      ['bob@example.com', 'to'],
      ['carol@example.com', 'cc'],
    ]) {
      const [entity] = await dataSource.query<Array<{ id: string }>>(
        `INSERT INTO ci_import.staged_entities (run_id, user_id, type, name, metadata, identity_key)
              VALUES ($1::uuid, $2::uuid, 'contact', $3, '{}'::jsonb, $3)
           RETURNING id`,
        [runId, userId, handle],
      );

      await dataSource.query(
        `INSERT INTO ci_import.staged_relationships (run_id, item_id, entity_id, relation, metadata)
              VALUES ($1::uuid, $2::uuid, $3::uuid, $4, '{}'::jsonb)`,
        [runId, item.id, entity.id, relation],
      );
    }

    return runId;
  }

  it('resolves staged entities before the records that name them, and records the mapping', async () => {
    const runId = await stageEmailWithParticipants();
    const { stage, people } = makeStage();

    const outcome = await stage.run(contextFor(runId));

    expect(outcome.detail.entities).toMatchObject({ resolved: 3, skipped: 0, failed: 0 });
    // Every person is filed under one namespace keyed on the handle, so the same
    // person from another export next month resolves to the same row.
    expect(people.mock.calls.map((call) => call[1].linkedId).sort()).toEqual([
      'alice@example.com',
      'bob@example.com',
      'carol@example.com',
    ]);

    const mappings = await harness.dataSource.query<Array<{ server_entity_id: string }>>(
      `SELECT m.server_entity_id
         FROM ci_import.entity_mappings m
         JOIN ci_import.staged_entities e ON e.id = m.staged_entity_id
        WHERE e.run_id = $1::uuid`,
      [runId],
    );

    expect(mappings).toHaveLength(3);
  });

  it('attaches the sender and recipients to the communication it pushes', async () => {
    const runId = await stageEmailWithParticipants();
    const { stage, sent, personIds } = makeStage();

    await stage.run(contextFor(runId));

    const communication = sent.find((entry) => entry.destination === 'communications');

    // The regression this closes: a full-mbox import once recorded 15,434 items
    // and ZERO relationships, so every message arrived with no sender at all.
    expect(communication?.input.from_entity_id).toBe(personIds.get('alice@example.com'));
    expect(communication?.input.to_entity_ids).toEqual([
      personIds.get('bob@example.com'),
      personIds.get('carol@example.com'),
    ]);
  });

  it('skips a handle-less entity instead of minting a duplicate every run', async () => {
    const runId = await harness.startRun();

    await harness.dataSource.query(
      `INSERT INTO ci_import.staged_entities (run_id, user_id, type, name, metadata, identity_key)
            VALUES ($1::uuid, $2::uuid, 'album', 'European Vacation', '{}'::jsonb, NULL)`,
      [runId, harness.userId],
    );

    const { stage, people } = makeStage();
    const outcome = await stage.run(contextFor(runId));

    expect(outcome.detail.entities).toMatchObject({ resolved: 0, skipped: 1 });
    // Filing an album through the person lane would record it as a contact.
    expect(people).not.toHaveBeenCalled();
    // `skipped` is a decision, not an absence — a resumed push must not
    // reconsider it.
    const [row] = await harness.dataSource.query<Array<{ push_status: string }>>(
      `SELECT push_status FROM ci_import.staged_entities WHERE run_id = $1::uuid`,
      [runId],
    );

    expect(row.push_status).toBe('skipped');
    expect(outcome.partial).toBe(true);
  });

  it('fails one poisoned row without stranding the rest', async () => {
    const runId = await harness.startRun();
    const { dataSource, userId } = harness;

    for (const hash of ['good-1', 'poison', 'good-2']) {
      await dataSource.query(
        `INSERT INTO ci_import.staged_items
           (run_id, user_id, data_source, classification, content_hash, occurred_at, metadata)
         VALUES ($1::uuid, $2::uuid, 'gmail', 'email', $3, now(), '{}'::jsonb)`,
        [runId, userId, hash],
      );
    }

    const communicationCreate = jest.fn(async (_ctx: unknown, input: { source_id?: string }) => {
      if (input.source_id === 'poison') {
        throw new Error('communications rejected this record');
      }

      return { id: 'communication-row' };
    });

    const { stage } = makeStage({ communicationCreate });
    const outcome = await stage.run(contextFor(runId));

    expect(outcome.processed).toBe(2);
    expect(outcome.detail).toMatchObject({ pushed: 2, failed: 1 });
    // A partly-pushed run is not a failed one: two records are in ci.* and useful.
    expect(outcome.partial).toBe(true);

    const rows = await dataSource.query<
      Array<{ content_hash: string; push_status: string; push_error: string }>
    >(
      `SELECT content_hash, push_status, push_error FROM ci_import.staged_items
        WHERE run_id = $1::uuid ORDER BY content_hash`,
      [runId],
    );

    expect(rows.map((row) => [row.content_hash, row.push_status])).toEqual([
      ['good-1', 'pushed'],
      ['good-2', 'pushed'],
      ['poison', 'failed'],
    ]);
    expect(rows[2].push_error).toMatch(/rejected this record/);
  });

  it('resumes over what is left rather than re-sending what already went', async () => {
    const runId = await stageEmailWithParticipants();
    const first = makeStage();

    await first.stage.run(contextFor(runId));

    const sentFirst = first.sent.length;

    expect(sentFirst).toBeGreaterThan(0);

    // A second run of the same stage — what a redelivered job looks like. The
    // query IS the resume point, so there is nothing pending left to send.
    const second = makeStage();
    const outcome = await second.stage.run(contextFor(runId));

    expect(second.sent).toHaveLength(0);
    expect(outcome.processed).toBe(0);
  });

  it('records which destinations a row reached', async () => {
    const runId = await harness.startRun();

    await harness.dataSource.query(
      `INSERT INTO ci_import.staged_items
         (run_id, user_id, data_source, classification, content_hash, occurred_at, latitude, longitude, metadata)
       VALUES ($1::uuid, $2::uuid, 'twitter', 'message', 'geo-1', now(), 37.79, -122.39, '{}'::jsonb)`,
      [runId, harness.userId],
    );

    const { stage } = makeStage();

    await stage.run(contextFor(runId));

    const [row] = await harness.dataSource.query<Array<{ pushed_ref: { destinations: string[] } }>>(
      `SELECT pushed_ref FROM ci_import.staged_items WHERE run_id = $1::uuid`,
      [runId],
    );

    // A geotagged message is both a communication and a GPS donor.
    expect(row.pushed_ref.destinations).toEqual(['communications', 'position']);
  });
});
