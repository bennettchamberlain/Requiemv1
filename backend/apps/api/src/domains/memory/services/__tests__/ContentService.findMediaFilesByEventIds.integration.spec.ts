import { DataSource } from 'typeorm';
import { v7 as uuidv7 } from 'uuid';

import type { UserServiceContext } from '@ci/common/context';
import type { EventService as SignallingEventService } from '@ci/domains/events';
import { UserEntity } from '@ci/domains/user';

import { databaseAvailability, resolveConnection } from '../../../__tests__/support/databaseConnection';
import { acquireSchemaWriteLock, type SchemaLock } from '../../../__tests__/support/schemaLock';
import { BaseEntity } from '../../entities/BaseEntity';
import { ContentBaseEntity } from '../../entities/ContentBaseEntity';
import { ContentEntity } from '../../entities/ContentEntity';
import { EventBaseEntity } from '../../entities/EventBaseEntity';
import { EventEntity } from '../../entities/EventEntity';
import { ContentService } from '../ContentService';
import type { GraphDeltaWriter } from '../GraphDeltaWriter';

import { noopGraphDeltaWriter } from './harness/noopGraphDeltaWriter';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * `content.external_id` IS NOT ALWAYS A FILE ID — PROVED AGAINST REAL POSTGRES.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `ContentService.findMediaFilesByEventIds` is the one read path that joins
 * `ci.content.external_id` against `ci.files` (via {@link EventMediaLoader}, a
 * photo/video event's thumbnail resolution). For a locally-captured/uploaded
 * media row that is correct — `external_id` IS a `ci.files.id`. For a
 * digital-purchase/play content row keyed on a source-native URI (Spotify's
 * `spotify:track:<id>`, stamped by push/inputs.ts toContentInput) it is not,
 * and nothing distinguished the two before migration
 * 20260818215331_add_content_external_id_kind added `external_id_kind`.
 *
 * Today those URI-keyed rows never carry an `event_id` (Spotify plays have no
 * timeline event), so the existing `event.userId = :userId` join happened to
 * keep them out of this query — scoping by ACCIDENT, not by contract. This
 * spec seeds one linked to an event anyway (a future source could easily do
 * that) and proves the query excludes it on `external_id_kind`, not on
 * `event_id` merely being absent — while a genuine file-linked row, both
 * explicitly marked 'file' and left NULL (an unclassified pre-migration row),
 * keeps resolving exactly as before.
 *
 * Opt-in: set `MEMORY_TEST_DATABASE_URL` (or `DATABASE_URL`) to a database
 * with migrations applied THROUGH 20260818215331 — `databaseAvailability`
 * probes reachability only, so a target missing that column fails loudly
 * rather than skipping.
 *
 *   MEMORY_TEST_DATABASE_URL=postgres://companion:pw@localhost:5432/companion \
 *     yarn workspace @ci/be-api jest ContentService.findMediaFilesByEventIds.integration
 */

const availability = databaseAvailability({ urlEnvVar: 'MEMORY_TEST_DATABASE_URL' });
const describeWithDb = availability.available ? describe : describe.skip;

if (!availability.available) {
  console.warn(
    `[memory/ContentService.findMediaFilesByEventIds.integration] SKIPPED — ${availability.reason}`,
  );
}

jest.setTimeout(60_000);

describeWithDb(
  `ContentService.findMediaFilesByEventIds excludes external_uri rows in Postgres (${availability.target})`,
  () => {
    let dataSource: DataSource;
    let schemaLock: SchemaLock | null = null;
    let contentService: ContentService;

    const ownerCtx: UserServiceContext = { userId: uuidv7() } as UserServiceContext;
    const strangerId = uuidv7();

    const fileEventId = uuidv7();
    const fileContentId = uuidv7();
    const realFileId = uuidv7();

    const uriEventId = uuidv7();
    const uriContentId = uuidv7();

    const unclassifiedEventId = uuidv7();
    const unclassifiedContentId = uuidv7();
    const unclassifiedFileId = uuidv7();

    const send = jest.fn<Promise<string[]>, [unknown, unknown]>(async () => []);
    const signalling = { send } as unknown as SignallingEventService;

    async function seedEvent(eventId: string, name: string): Promise<void> {
      await dataSource.query(
        `INSERT INTO ci.entities (entity_id, entity_type, name, properties, owner_user_id, linked_table, linked_id)
         VALUES ($1, 'Event', $2, '{}'::jsonb, $3, 'events', $1)`,
        [eventId, name, ownerCtx.userId],
      );
      await dataSource.query(
        `INSERT INTO ci.events (event_id, user_id, start_time, category, source_type, source_system, source_id)
         VALUES ($1, $2, now(), 'capture', 'ci.import', 'findMediaFilesByEventIds_spec', $3)`,
        [eventId, ownerCtx.userId, eventId],
      );
    }

    async function seedContent(args: {
      contentId: string;
      eventId: string;
      externalId: string;
      externalIdKind: 'file' | 'external_uri' | null;
      mimetype: string;
      name: string;
      sourceId: string;
    }): Promise<void> {
      await dataSource.query(
        `INSERT INTO ci.entities (entity_id, entity_type, name, properties, owner_user_id, linked_table, linked_id)
         VALUES ($1, 'Content', $2, '{}'::jsonb, $3, 'content', $1)`,
        [args.contentId, args.name, ownerCtx.userId],
      );
      await dataSource.query(
        `INSERT INTO ci.content
           (id, type, mimetype, external_id, external_id_kind, user_id, event_id,
            source_type, source_system, source_id)
         VALUES ($1, 'media', $2, $3, $4, $5, $6, 'ci.import', 'findMediaFilesByEventIds_spec', $7)`,
        [
          args.contentId,
          args.mimetype,
          args.externalId,
          args.externalIdKind,
          ownerCtx.userId,
          args.eventId,
          args.sourceId,
        ],
      );
    }

    beforeAll(async () => {
      const connection = resolveConnection({ urlEnvVar: 'MEMORY_TEST_DATABASE_URL' });

      if (connection == null) {
        throw new Error('databaseAvailability passed but no connection resolved');
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
        entities: [BaseEntity, UserEntity, ContentBaseEntity, ContentEntity, EventBaseEntity, EventEntity],
      });
      await dataSource.initialize();

      // SHARED: this suite only commits/reads rows, never DDL — see
      // domains/__tests__/support/schemaLock.ts.
      schemaLock = await acquireSchemaWriteLock(
        dataSource,
        'memory/ContentService.findMediaFilesByEventIds.integration',
      );

      for (const [id, name] of [
        [ownerCtx.userId, 'Owner'],
        [strangerId, 'Stranger'],
      ] as const) {
        await dataSource.query(
          `INSERT INTO ci.users (id, name, email) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING`,
          [id, `${name} spec fixture`, `${name.toLowerCase()}.${id}@example.invalid`],
        );
      }

      await dataSource.query(
        `INSERT INTO ci.files (id, filename, content_type, user_id) VALUES ($1, 'fixture.jpg', 'image/jpeg', $2)`,
        [realFileId, ownerCtx.userId],
      );
      await dataSource.query(
        `INSERT INTO ci.files (id, filename, content_type, user_id) VALUES ($1, 'fixture2.jpg', 'image/jpeg', $2)`,
        [unclassifiedFileId, ownerCtx.userId],
      );

      // Fixture 1: a genuine locally-captured photo — external_id_kind='file'.
      // Must resolve, exactly as before this migration existed.
      await seedEvent(fileEventId, 'File-linked photo');
      await seedContent({
        contentId: fileContentId,
        eventId: fileEventId,
        externalId: realFileId,
        externalIdKind: 'file',
        mimetype: 'image/jpeg',
        name: 'File-linked photo content',
        sourceId: 'file-linked-1',
      });

      // Fixture 2: the bug this migration guards against — a URI-keyed content
      // row, linked to an event (Spotify plays never carry one today, but
      // nothing stops a future source from linking one). Must NOT resolve: its
      // external_id would 404 or, worse, collide with an unrelated file's uuid.
      await seedEvent(uriEventId, 'URI-linked play');
      await seedContent({
        contentId: uriContentId,
        eventId: uriEventId,
        externalId: 'spotify:track:not-a-file-id',
        externalIdKind: 'external_uri',
        mimetype: 'audio/mpeg',
        name: 'URI-linked play content',
        sourceId: 'spotify:track:not-a-file-id',
      });

      // Fixture 3: an unclassified row (external_id_kind IS NULL) — what every
      // row created before this migration's backfill ran looks like, and
      // genuinely a file id. Must still resolve: the query only excludes rows
      // explicitly marked 'external_uri', not everything short of 'file'.
      await seedEvent(unclassifiedEventId, 'Unclassified photo');
      await seedContent({
        contentId: unclassifiedContentId,
        eventId: unclassifiedEventId,
        externalId: unclassifiedFileId,
        externalIdKind: null,
        mimetype: 'image/jpeg',
        name: 'Unclassified photo content',
        sourceId: 'unclassified-1',
      });

      contentService = new ContentService(
        dataSource.getRepository(ContentEntity),
        dataSource.getRepository(ContentBaseEntity),
        dataSource.getRepository(EventEntity),
        signalling,
        noopGraphDeltaWriter() as unknown as GraphDeltaWriter,
      );
    });

    afterAll(async () => {
      if (dataSource?.isInitialized) {
        await dataSource.query('DELETE FROM ci.entities WHERE owner_user_id = ANY($1)', [
          [ownerCtx.userId, strangerId],
        ]);
        await dataSource.query('DELETE FROM ci.files WHERE user_id = ANY($1)', [[ownerCtx.userId]]);
        await dataSource.query('DELETE FROM ci.users WHERE id = ANY($1)', [[ownerCtx.userId, strangerId]]);
        // Before destroy(): the lock is held on a runner from this pool.
        await schemaLock?.release();
        await dataSource.destroy();
      }
    });

    it('resolves the file-kind row and the unclassified (NULL-kind) row, but not the external_uri row', async () => {
      const links = await contentService.findMediaFilesByEventIds(ownerCtx, [
        fileEventId,
        uriEventId,
        unclassifiedEventId,
      ]);

      const byEvent = new Map(links.map((l) => [l.eventId, l]));

      expect(byEvent.get(fileEventId)?.fileId).toBe(realFileId);
      expect(byEvent.get(unclassifiedEventId)?.fileId).toBe(unclassifiedFileId);
      expect(byEvent.has(uriEventId)).toBe(false);
      expect(links).toHaveLength(2);
    });

    it('never resolves anything for a stranger — user scoping still holds', async () => {
      const links = await contentService.findMediaFilesByEventIds(
        { userId: strangerId } as UserServiceContext,
        [fileEventId, uriEventId, unclassifiedEventId],
      );

      expect(links).toHaveLength(0);
    });
  },
);
