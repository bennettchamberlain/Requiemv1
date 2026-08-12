import {
  EntityIdentifierEntity,
  EntityIdentifierService,
  GraphIngestService,
  NodeEntity,
  RelationshipEntity,
} from '@ci/domains/graph';
import { GraphDeltaWriter } from '@ci/domains/memory';

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
  function makeStage(
    overrides: { communicationCreate?: jest.Mock; contentCreate?: jest.Mock; graph?: GraphIngestService } = {},
  ) {
    const sent: Array<{ destination: string; input: Record<string, unknown> }> = [];
    // Every destination takes an ARRAY and reports `inserted` per row — that is
    // the upserting path, and the flag is how the stage tells a row it WROTE
    // from one the destination already had. `inserted: false` is what a real
    // service returns when the provenance triple is already present.
    const record = (destination: string, inserted = true) =>
      jest.fn(async (_ctx: unknown, inputs: Array<Record<string, unknown>>) => {
        for (const input of inputs) {
          sent.push({ destination, input });
        }

        return inputs.map(() => ({ entity: { id: `${destination}-row` }, inserted }));
      });

    // The entity lane runs against the REAL GraphIngestService, not a double.
    //
    // It was a double once, and the double accepted a normalized handle in
    // `linkedId` — a `uuid` column — so every entity that had a handle failed
    // against the actual database and every entity without one was skipped.
    // Nothing resolved, and because `entity_mappings` stayed empty the
    // participant join silently produced nothing for any record. The mock
    // agreed with the code at every step.
    const logger = { setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() };
    const graph =
      overrides.graph ??
      new GraphIngestService(
        harness.dataSource.getRepository(NodeEntity),
        harness.dataSource.getRepository(RelationshipEntity),
        new EntityIdentifierService(
          harness.dataSource.getRepository(EntityIdentifierEntity),
          logger as never,
        ),
        logger as never,
        // Real, for the same reason the ingest service is: `ci.graph_deltas` is
        // written by the application now (the triggers were dropped), so a
        // doubled writer would let the entity lane resolve rows while recording
        // nothing — and the delta is what the insight summaries read.
        new GraphDeltaWriter(harness.dataSource, logger as never),
      );

    const communications = { createManyDetailed: overrides.communicationCreate ?? record('communications') };

    const stage = new PushStage(
      harness.dataSource,
      communications as never,
      { createManyDetailed: overrides.contentCreate ?? record('content') } as never,
      { createDetailed: record('events') } as never,
      { createManyDetailed: record('inventory') } as never,
      // Positions carry no provenance triple, so this one never reports.
      { create: record('position') } as never,
      { createManyDetailed: record('browser_activity') } as never,
      graph as never,
      logger as never,
    );

    return { stage, sent, graph, communications };
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
        `INSERT INTO ci_import.staged_entities
           (run_id, user_id, type, name, metadata, identity_key, data_source)
              VALUES ($1::uuid, $2::uuid, 'contact', $3, '{}'::jsonb, $3, 'gmail')
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
    const { stage } = makeStage();

    const outcome = await stage.run(contextFor(runId));

    expect(outcome.detail.entities).toMatchObject({ resolved: 3, skipped: 0, failed: 0 });

    const mappings = await harness.dataSource.query<Array<{ server_entity_id: string }>>(
      `SELECT m.server_entity_id
         FROM ci_import.entity_mappings m
         JOIN ci_import.staged_entities e ON e.id = m.staged_entity_id
        WHERE e.run_id = $1::uuid`,
      [runId],
    );

    expect(mappings).toHaveLength(3);
  });

  it('counts a row whose destinations all already had it as deduped, not as a write', async () => {
    // The reason the services report `inserted` at all. Every destination
    // upserts, so a collision is absorbed silently — a re-push used to count as
    // 10,808 writes and report `deduped: 0` on an archive that was mostly
    // repeats, and the destination breakdown claimed 7,339 content records
    // where 2,354 rows existed.
    const runId = await stageEmailWithParticipants();
    const { stage, sent } = makeStage({
      communicationCreate: jest.fn(async (_ctx: unknown, inputs: Array<Record<string, unknown>>) => {
        for (const input of inputs) {
          sent.push({ destination: 'communications', input });
        }

        return inputs.map(() => ({ entity: { id: 'communication-row' }, inserted: false }));
      }),
    });

    const outcome = await stage.run(contextFor(runId));

    expect(outcome.detail).toMatchObject({ pushed: 0, deduped: 1, failed: 0 });
    // The record was still SENT — it just wrote nothing, so it must not inflate
    // the destination breakdown.
    expect(sent.filter((entry) => entry.destination === 'communications')).toHaveLength(1);
    expect(outcome.detail.destinations).not.toHaveProperty('communications');
  });

  it('counts entities in its own total, so Read and Save agree on one import', async () => {
    // A real Amazon archive read 10,890 and saved 10,808. Nothing was lost: the
    // parse stage counts items AND entities, while this stage's denominator was
    // items alone, so the two steps described the same import with different
    // numbers and the 82 missing rows read as a silent drop.
    const runId = await stageEmailWithParticipants();
    const { stage } = makeStage();

    const outcome = await stage.run(contextFor(runId));

    const [{ items }] = await harness.dataSource.query<Array<{ items: string }>>(
      `SELECT count(*) AS items FROM ci_import.staged_items WHERE run_id = $1::uuid`,
      [runId],
    );

    // One email, three contacts.
    expect(outcome.total).toBe(Number(items) + 3);
    expect(outcome.processed).toBe(outcome.total);
  });

  it('writes real ci.entities rows, with a linked id a uuid column accepts', async () => {
    // The bug in one test. `linked_id` is a uuid; the handle used to be written
    // into it directly, so this INSERT failed for every entity that had one.
    const runId = await stageEmailWithParticipants();
    const { stage } = makeStage();

    await stage.run(contextFor(runId));

    const rows = await harness.dataSource.query<Array<{ entity_type: string; linked_table: string }>>(
      `SELECT e.entity_type, e.linked_table
         FROM ci.entities e
         JOIN ci_import.entity_mappings m ON m.server_entity_id = e.entity_id
         JOIN ci_import.staged_entities s ON s.id = m.staged_entity_id
        WHERE s.run_id = $1::uuid`,
      [runId],
    );

    expect(rows).toHaveLength(3);
    expect(rows.every((row) => row.entity_type === 'Person')).toBe(true);
    // Namespaced by the parser that produced them, per GraphIngestService.
    expect(rows.every((row) => row.linked_table === 'import:gmail')).toBe(true);
  });

  it('indexes each handle in ci.entity_identifiers, which is what links people later', async () => {
    // Without these rows a person imported from one export can never be matched
    // to the same person in another — the table was empty on a real import.
    const runId = await stageEmailWithParticipants();
    const { stage } = makeStage();

    await stage.run(contextFor(runId));

    const identifiers = await harness.dataSource.query<Array<{ value_normalized: string }>>(
      `SELECT i.value_normalized
         FROM ci.entity_identifiers i
         JOIN ci_import.entity_mappings m ON m.server_entity_id = i.entity_id
         JOIN ci_import.staged_entities s ON s.id = m.staged_entity_id
        WHERE s.run_id = $1::uuid AND i.kind = 'email'
        ORDER BY i.value_normalized`,
      [runId],
    );

    expect(identifiers.map((row) => row.value_normalized)).toEqual([
      'alice@example.com',
      'bob@example.com',
      'carol@example.com',
    ]);
  });

  it('resolves the same handle to the same row on a re-import', async () => {
    // Idempotency is the reason the identity is a natural key rather than a
    // fresh uuid: a second import of the same archive must not double everyone.
    const { stage } = makeStage();

    const first = await stageEmailWithParticipants();
    await stage.run(contextFor(first));

    const second = await stageEmailWithParticipants();
    await stage.run(contextFor(second));

    const [{ count }] = await harness.dataSource.query<Array<{ count: string }>>(
      `SELECT count(DISTINCT m.server_entity_id) AS count
         FROM ci_import.entity_mappings m
         JOIN ci_import.staged_entities s ON s.id = m.staged_entity_id
        WHERE s.run_id IN ($1::uuid, $2::uuid)`,
      [first, second],
    );

    expect(Number(count)).toBe(3);
  });

  it('attaches the sender and recipients to the communication it pushes', async () => {
    const runId = await stageEmailWithParticipants();
    const { stage, sent } = makeStage();

    await stage.run(contextFor(runId));

    const communication = sent.find((entry) => entry.destination === 'communications');

    // Read back through the mapping table rather than from a mock's memory: the
    // participant ids are only correct if the join the stage itself uses agrees.
    const resolved = new Map(
      (
        await harness.dataSource.query<Array<{ identity_key: string; server_entity_id: string }>>(
          `SELECT s.identity_key, m.server_entity_id
             FROM ci_import.entity_mappings m
             JOIN ci_import.staged_entities s ON s.id = m.staged_entity_id
            WHERE s.run_id = $1::uuid`,
          [runId],
        )
      ).map((row) => [row.identity_key, row.server_entity_id]),
    );

    // The regression this closes: a full-mbox import once recorded 15,434 items
    // and ZERO relationships, so every message arrived with no sender at all.
    expect(communication?.input.from_entity_id).toBe(resolved.get('alice@example.com'));
    expect(communication?.input.to_entity_ids).toEqual([
      resolved.get('bob@example.com'),
      resolved.get('carol@example.com'),
    ]);
  });

  it('resolves a handle-less entity by name, without filing it as a contact', async () => {
    // Handle-less entities used to be skipped outright, on the grounds that a
    // null key would mint a duplicate every run. That cost a real Amazon import
    // all 69 of its artists and 12 of its genres. A name IS a stable key for the
    // things that have no handle by nature, so they resolve — as a Concept, not
    // as a person, which is the part that actually mattered.
    const runId = await harness.startRun();

    await harness.dataSource.query(
      `INSERT INTO ci_import.staged_entities
         (run_id, user_id, type, name, metadata, identity_key, data_source)
            VALUES ($1::uuid, $2::uuid, 'album', 'European Vacation', '{}'::jsonb, NULL, 'google_photos')`,
      [runId, harness.userId],
    );

    const { stage } = makeStage();
    const outcome = await stage.run(contextFor(runId));

    expect(outcome.detail.entities).toMatchObject({ resolved: 1, skipped: 0, failed: 0 });

    const [row] = await harness.dataSource.query<Array<{ entity_type: string }>>(
      `SELECT e.entity_type
         FROM ci.entities e
         JOIN ci_import.entity_mappings m ON m.server_entity_id = e.entity_id
         JOIN ci_import.staged_entities s ON s.id = m.staged_entity_id
        WHERE s.run_id = $1::uuid`,
      [runId],
    );

    expect(row.entity_type).toBe('Concept');
  });

  it('skips only an entity with nothing at all to key on', async () => {
    const runId = await harness.startRun();

    await harness.dataSource.query(
      `INSERT INTO ci_import.staged_entities (run_id, user_id, type, name, metadata, identity_key)
            VALUES ($1::uuid, $2::uuid, 'album', NULL, '{}'::jsonb, NULL)`,
      [runId, harness.userId],
    );

    const { stage } = makeStage();
    const outcome = await stage.run(contextFor(runId));

    expect(outcome.detail.entities).toMatchObject({ resolved: 0, skipped: 1 });
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

    const communicationCreate = jest.fn(async (_ctx: unknown, inputs: Array<{ source_id?: string }>) => {
      if (inputs.some((input) => input.source_id === 'poison')) {
        throw new Error('communications rejected this record');
      }

      return inputs.map(() => ({ entity: { id: 'communication-row' }, inserted: true }));
    });

    const { stage } = makeStage({ communicationCreate });
    const outcome = await stage.run(contextFor(runId));

    // All three rows were resolved, so the bar reaches its total; the breakdown
    // is what says two landed and one did not. Counting only successes made a
    // stage that examined everything report as half finished.
    expect(outcome.processed).toBe(3);
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

  it('sends every destination a batch, which is the path that upserts', async () => {
    // `create` with one row inserts and throws on a duplicate; only the batch
    // method is an upsert on the provenance triple. Two audiobook listens are
    // two events but ONE content row, because content is keyed on the work's
    // URI — so the single-row path raised
    // "duplicate key value violates content_source_triple_uniq" on the second.
    const runId = await harness.startRun();

    await harness.dataSource.query(
      `INSERT INTO ci_import.staged_items
         (run_id, user_id, data_source, classification, content_hash, occurred_at, metadata)
       VALUES ($1::uuid, $2::uuid, 'audible', 'listen', 'listen-1', now(), '{}'::jsonb)`,
      [runId, harness.userId],
    );

    const { stage, sent } = makeStage();

    await stage.run(contextFor(runId));

    // media.listen fans out to events and content; both must have been handed
    // an array, or the mock would not have recorded anything.
    expect(sent.map((entry) => entry.destination).sort()).toEqual(['content', 'events']);
  });

  it('counts a duplicate as deduped, not as a failure', async () => {
    // The record is in ci.* — it just arrived earlier. Reporting that as failure
    // makes a re-import look broken and marks rows for a retry that can never
    // succeed.
    const runId = await harness.startRun();

    await harness.dataSource.query(
      `INSERT INTO ci_import.staged_items
         (run_id, user_id, data_source, classification, content_hash, occurred_at, metadata)
       VALUES ($1::uuid, $2::uuid, 'audible', 'email', 'dupe-1', now(), '{}'::jsonb)`,
      [runId, harness.userId],
    );

    const duplicate = Object.assign(new Error('duplicate key value violates unique constraint'), {
      code: '23505',
    });
    const { stage } = makeStage({
      communicationCreate: jest.fn(async () => {
        throw duplicate;
      }),
    });

    const outcome = await stage.run(contextFor(runId));

    expect(outcome.detail).toMatchObject({ pushed: 0, deduped: 1, failed: 0 });
    // A run that deduped everything still finished its work.
    expect(outcome.processed).toBe(outcome.total);

    const [row] = await harness.dataSource.query<Array<{ push_status: string; push_error: string | null }>>(
      `SELECT push_status, push_error FROM ci_import.staged_items WHERE run_id = $1::uuid`,
      [runId],
    );

    // `skipped`, so a resumed push does not reconsider it forever.
    expect(row.push_status).toBe('skipped');
    expect(row.push_error).toBeNull();
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
