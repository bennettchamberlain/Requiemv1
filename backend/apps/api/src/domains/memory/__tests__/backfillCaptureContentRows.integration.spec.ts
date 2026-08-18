import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { DataSource, type QueryRunner } from 'typeorm';

import { createSyntheticTestUser } from '../../__tests__/support/applianceUser';
import { databaseAvailability, resolveConnection } from '../../__tests__/support/databaseConnection';
import { acquireSchemaWriteLock, type SchemaLock } from '../../__tests__/support/schemaLock';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * THE CAPTURE-CONTENT BACKFILL (20260818174213), AGAINST REAL POSTGRES.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * 8abfb5de5 fixed `destinationsFor` so a NEW dated capture.* import writes a
 * `ci.content` row alongside its `ci.events` row. This migration is the
 * one-time recovery for events that already landed in `ci.events` under the
 * old, incomplete destination list — it has no application-code counterpart
 * to unit test, only the SQL itself, so it is proved here the same way
 * `PersonLinkStage.spec.ts` proves `identifier_claims.sql`: applied for real,
 * inside a transaction that always rolls back.
 *
 * Four fixtures cover the branches that matter:
 *  - a capture event with a FileId and no content row — the case this exists
 *    to fix;
 *  - a capture event that already has a content row (a post-fix import, or a
 *    second run of this same migration) — must not get a second one;
 *  - a capture event with NO FileId (bytes were never uploaded, e.g. the
 *    Instagram rows on the real appliance whose media_type never matched
 *    MediaStage's predicate) — must stay untouched, because there is nothing
 *    to link and fabricating a content row would describe a file that does
 *    not exist;
 *  - a non-capture event that happens to carry a FileId-shaped key — must be
 *    ignored by the `category = 'capture'` filter.
 */

const availability = databaseAvailability();
const describeWithDatabase = availability.available ? describe : describe.skip;

if (!availability.available) {
  console.warn(`[memory/backfillCaptureContentRows.integration] SKIPPED — ${availability.reason}`);
}

jest.setTimeout(60_000);

/** The migration's `-- migrate:up` half, applied inside the test transaction. */
function migrationUp(): string {
  const file = path.resolve(
    __dirname,
    '../../../../db/postgres/migrations/20260818174213_backfill_capture_content_rows.sql',
  );

  const sql = readFileSync(file, 'utf8');
  const start = sql.indexOf('-- migrate:up');
  const end = sql.indexOf('-- migrate:down');

  if (start < 0 || end < 0) {
    throw new Error(`${file} has no migrate:up / migrate:down markers.`);
  }

  return sql.slice(start + '-- migrate:up'.length, end);
}

describeWithDatabase(`backfill_capture_content_rows against real Postgres (${availability.target})`, () => {
  let dataSource: DataSource;
  let runner: QueryRunner;
  let schemaLock: SchemaLock | null = null;
  let ownerUserId: string;

  // One id per fixture event, named for what the fixture proves.
  const recoverableEventId = randomUUID();
  const recoverableFileId = randomUUID();
  const alreadyLinkedEventId = randomUUID();
  const alreadyLinkedFileId = randomUUID();
  const preExistingContentId = randomUUID();
  const noFileIdEventId = randomUUID();
  const nonCaptureEventId = randomUUID();
  const nonCaptureFileId = randomUUID();

  function q<T>(text: string, params?: unknown[]): Promise<T> {
    return runner.query(text, params) as Promise<T>;
  }

  /** Seeds the ci.entities base row + ci.events detail row for one fixture event. */
  async function seedEvent(args: {
    eventId: string;
    category: string;
    name: string;
    metadata: Record<string, unknown>;
    sourceId: string;
  }): Promise<void> {
    await q(
      `INSERT INTO ci.entities (entity_id, entity_type, name, properties, owner_user_id, linked_table, linked_id)
       VALUES ($1, 'Event', $2, '{}'::jsonb, $3, 'events', $1)`,
      [args.eventId, args.name, ownerUserId],
    );
    await q(
      `INSERT INTO ci.events
         (event_id, user_id, start_time, category, source_type, source_system, source_id, metadata)
       VALUES ($1, $2, now(), $3, 'ci.import', 'backfill_spec', $4, $5::jsonb)`,
      [args.eventId, ownerUserId, args.category, args.sourceId, JSON.stringify(args.metadata)],
    );
  }

  async function seedFile(fileId: string, contentType: string): Promise<void> {
    await q(
      `INSERT INTO ci.files (id, filename, content_type, user_id)
       VALUES ($1, 'fixture.jpg', $2, $3)`,
      [fileId, contentType, ownerUserId],
    );
  }

  beforeAll(async () => {
    const connection = resolveConnection();

    if (connection == null) {
      throw new Error(
        'backfillCaptureContentRows.integration ran with no database configured; the gate broke.',
      );
    }

    dataSource = new DataSource({
      type: 'postgres',
      ...(connection.url != null
        ? { url: connection.url }
        : {
            host: connection.host,
            port: connection.port,
            username: connection.username,
            password: connection.password,
            database: connection.database,
          }),
      entities: [],
      synchronize: false,
      logging: false,
      extra: { max: 2 },
    });

    await dataSource.initialize();

    // SHARED: this migration is pure DML (no ALTER/CREATE against shared
    // ci.* tables — the `CREATE TEMP TABLE` it opens with is session-local),
    // so it only needs to coexist with other writers, not exclude them. See
    // domains/__tests__/support/schemaLock.ts.
    schemaLock = await acquireSchemaWriteLock(dataSource, 'backfillCaptureContentRows');

    runner = dataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();

    ownerUserId = await createSyntheticTestUser(
      (sql, params) => q(sql, params),
      'BackfillCaptureContentRows',
    );

    // Fixture 1: recoverable — capture event, FileId resolves to a live file,
    // no content row yet. This is the 2,092-row case on the real appliance.
    await seedFile(recoverableFileId, 'image/jpeg');
    await seedEvent({
      eventId: recoverableEventId,
      category: 'capture',
      name: 'Recoverable photo',
      sourceId: 'recoverable-1',
      metadata: {
        kind: 'capture.photo',
        FileId: recoverableFileId,
        mediaType: 'image/jpeg',
        Text: 'a caption',
      },
    });

    // Fixture 2: already linked — same shape, but a content row (and its own
    // entities base row) already exists, as a post-fix import or a prior run
    // of this migration would leave behind.
    await seedFile(alreadyLinkedFileId, 'video/mp4');
    await seedEvent({
      eventId: alreadyLinkedEventId,
      category: 'capture',
      name: 'Already linked video',
      sourceId: 'already-linked-1',
      metadata: { kind: 'capture.video', FileId: alreadyLinkedFileId, mediaType: 'video/mp4' },
    });
    await q(
      `INSERT INTO ci.entities (entity_id, entity_type, name, properties, owner_user_id, linked_table, linked_id)
       VALUES ($1, 'Content', 'Already linked video', '{}'::jsonb, $2, 'content', $1)`,
      [preExistingContentId, ownerUserId],
    );
    await q(
      `INSERT INTO ci.content
         (id, type, mimetype, external_id, user_id, event_id, source_type, source_system, source_id)
       VALUES ($1, 'media', 'video/mp4', $2, $3, $4, 'ci.import', 'backfill_spec', 'already-linked-1')`,
      [preExistingContentId, alreadyLinkedFileId, ownerUserId, alreadyLinkedEventId],
    );

    // Fixture 3: no FileId — bytes were never uploaded (MediaStage's
    // image/video/audio predicate never matched), same as the real
    // appliance's 6 Instagram rows. Must be left alone: there is nothing to
    // link.
    await seedEvent({
      eventId: noFileIdEventId,
      category: 'capture',
      name: 'Never uploaded',
      sourceId: 'no-fileid-1',
      metadata: { kind: 'capture.photo', mediaType: 'text/plain' },
    });

    // Fixture 4: not a capture event at all, but carries a FileId-shaped key
    // — proves the `category = 'capture'` filter actually excludes it rather
    // than the test only happening to have no non-capture rows.
    await seedFile(nonCaptureFileId, 'image/jpeg');
    await seedEvent({
      eventId: nonCaptureEventId,
      category: 'communication',
      name: 'Not a capture',
      sourceId: 'non-capture-1',
      metadata: { kind: 'communication.message', FileId: nonCaptureFileId },
    });

    // The migration itself, applied HERE inside the transaction that always
    // rolls back — the real file, not a copy that could drift.
    await runner.query(migrationUp());
  });

  afterAll(async () => {
    if (runner != null) {
      // ALWAYS. The fixtures and everything the migration wrote disappear
      // with this line — nothing here is left for the real appliance to
      // trip over.
      await runner.rollbackTransaction();
      await runner.release();
    }

    await schemaLock?.release();

    if (dataSource?.isInitialized) {
      await dataSource.destroy();
    }
  });

  it('creates a content row for a capture event with an unlinked file', async () => {
    const rows = await q<
      Array<{
        id: string;
        type: string;
        mimetype: string | null;
        external_id: string | null;
        text: string | null;
        source_type: string | null;
        source_system: string | null;
        source_id: string | null;
        user_id: string;
        source_data: Record<string, unknown>;
      }>
    >(`SELECT * FROM ci.content WHERE event_id = $1`, [recoverableEventId]);

    expect(rows).toHaveLength(1);
    const [row] = rows;

    expect(row.type).toBe('media');
    expect(row.external_id).toBe(recoverableFileId);
    expect(row.mimetype).toBe('image/jpeg');
    expect(row.text).toBe('a caption');
    expect(row.source_type).toBe('ci.import');
    expect(row.source_system).toBe('backfill_spec');
    expect(row.source_id).toBe('recoverable-1');
    expect(row.user_id).toBe(ownerUserId);
    // source_data recovers the event's own metadata verbatim — the same
    // object toContentInput/toEventInput would both have received at push
    // time — not a reconstruction.
    expect(row.source_data).toEqual({
      kind: 'capture.photo',
      FileId: recoverableFileId,
      mediaType: 'image/jpeg',
      Text: 'a caption',
    });
  });

  it('gives the new content row a CTI base row with the linked event title', async () => {
    const [content] = await q<Array<{ id: string }>>(`SELECT id FROM ci.content WHERE event_id = $1`, [
      recoverableEventId,
    ]);

    const [entity] = await q<
      Array<{
        name: string | null;
        owner_user_id: string;
        linked_table: string | null;
        linked_id: string | null;
      }>
    >(`SELECT name, owner_user_id, linked_table, linked_id FROM ci.entities WHERE entity_id = $1`, [
      content.id,
    ]);

    expect(entity).toEqual({
      name: 'Recoverable photo',
      owner_user_id: ownerUserId,
      linked_table: 'content',
      linked_id: content.id,
    });
  });

  it('does not duplicate a content row that already links the event', async () => {
    const rows = await q<Array<{ id: string }>>(`SELECT id FROM ci.content WHERE event_id = $1`, [
      alreadyLinkedEventId,
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(preExistingContentId);
  });

  it('leaves a capture event with no FileId untouched — there is nothing to link', async () => {
    const rows = await q<Array<{ id: string }>>(`SELECT id FROM ci.content WHERE event_id = $1`, [
      noFileIdEventId,
    ]);

    expect(rows).toHaveLength(0);
  });

  it('ignores a non-capture event even when it carries a FileId-shaped key', async () => {
    const rows = await q<Array<{ id: string }>>(`SELECT id FROM ci.content WHERE event_id = $1`, [
      nonCaptureEventId,
    ]);

    expect(rows).toHaveLength(0);
  });

  it('is idempotent — running it again creates nothing new', async () => {
    const before = await q<Array<{ count: string }>>(`SELECT count(*) AS count FROM ci.content`);

    await runner.query(migrationUp());

    const after = await q<Array<{ count: string }>>(`SELECT count(*) AS count FROM ci.content`);

    expect(after[0].count).toBe(before[0].count);

    const stillOne = await q<Array<{ id: string }>>(`SELECT id FROM ci.content WHERE event_id = $1`, [
      recoverableEventId,
    ]);

    expect(stillOne).toHaveLength(1);
  });
});
