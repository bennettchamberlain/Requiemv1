import type { CreateCommunicationDto } from '@ci/domains/memory';

import type { StagedItem } from '../../entities/StagedItemEntity';
import type { StageRunContext } from '../../types';
import { PushStage } from '../PushStage';

/**
 * Which mapper a communication actually reaches.
 *
 * `push/inputs.ts` has carried WhatsApp- and Messenger-specific mappers since
 * the port, and nothing called them: every communication went through the
 * generic `toCommunicationInput`. Neither export carries an is-from-me signal,
 * so `directionFor` found nothing and the generic default stood — a real
 * corpus pushed 4,205 WhatsApp rows all marked `inbound`, 437 of which the
 * owner had sent — and WhatsApp's thread name, which the importer stamps onto
 * `Conversation`, was read by nobody, so every message lost its chat grouping.
 *
 * These assertions are about the ROUTING, so they drive the real
 * `PushStage.run()` rather than the mappers directly: calling a mapper in a
 * test proves it works, which was never in doubt, and says nothing about
 * whether the stage calls it.
 */

const RUN_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '33333333-3333-4333-8333-333333333333';
const STAGE_ID = '22222222-2222-4222-8222-222222222222';

/** The account row + self Person row `resolveIsSelf` reads, for an owner named Liam Broza. */
const OWNER_ROWS = [
  { name: 'Liam Broza', email: 'liam.broza@example.com' },
  { name: 'Liam Broza', email: null },
];

let nextId = 0;

function stagedRow(over: Partial<StagedItem> = {}): StagedItem {
  nextId += 1;

  return {
    id: `44444444-4444-4444-8444-4444444444${String(nextId).padStart(2, '0')}`,
    runId: RUN_ID,
    userId: USER_ID,
    dataSource: 'whatsapp',
    classification: 'message',
    contentHash: `hash-${nextId}`,
    occurredAt: new Date('2024-05-01T12:00:00Z'),
    timespanEnd: null,
    latitude: null,
    longitude: null,
    filename: null,
    mediaType: null,
    originalLocation: null,
    intermediateLocation: null,
    metadata: {},
    createdAt: new Date('2026-08-12T00:00:00Z'),
    ...over,
  } as StagedItem;
}

function whatsAppRow(sender: string, text: string): StagedItem {
  return stagedRow({
    dataSource: 'whatsapp',
    metadata: { Sender: sender, Conversation: 'Family', Source: 'WhatsApp', Text: text },
  });
}

function messengerRow(sender: string, text: string): StagedItem {
  return stagedRow({
    dataSource: 'facebook',
    metadata: { Sender: sender, To: 'Alice Example', Conversation: 'Alice Example', Text: text },
  });
}

interface Harness {
  stage: PushStage;
  /** Every CreateCommunicationDto the stage handed CommunicationService, in order. */
  sent: CreateCommunicationDto[];
  warnings: Array<[string, unknown]>;
}

/**
 * A PushStage over a stubbed database, serving exactly the queries `run()`
 * issues. Entity resolution is empty, so `participants` is supplied directly as
 * the edges `participantsFor` would have joined.
 */
function makeStage(
  rows: StagedItem[],
  options: {
    ownerRows?: Array<{ name: string | null; email: string | null }>;
    ownerQueryThrows?: boolean;
    participants?: Array<{ relation: string; server_entity_id: string }>;
  } = {},
): Harness {
  let servedBatch = false;
  const sent: CreateCommunicationDto[] = [];
  const warnings: Array<[string, unknown]> = [];

  const dataSource = {
    query: jest.fn(async (sql: string) => {
      if (sql.includes('pg_database_size')) {
        return [{ bytes: '1000' }];
      }

      // Unreadable data directory → freeBytes null → the floor check abstains.
      if (sql.includes('data_directory')) {
        return [];
      }

      if (sql.trimStart().startsWith('UPDATE')) {
        return [];
      }

      if (sql.includes('staged_relationships')) {
        return options.participants ?? [];
      }

      if (sql.includes('FROM ci.users u')) {
        if (options.ownerQueryThrows) {
          throw new Error('relation "ci.users" does not exist');
        }

        return options.ownerRows ?? OWNER_ROWS;
      }

      // settledCounts — checked before the bare count(*) branch, which its
      // second leg would otherwise capture.
      if (sql.includes("'item' AS kind")) {
        return [];
      }

      // pushEntities: nothing staged, so the graph is never called.
      if (sql.includes('identity_key AS "identityKey"')) {
        return [];
      }

      if (sql.includes('count(*)')) {
        return [{ count: String(rows.length) }];
      }

      if (sql.includes('media_type AS "mediaType"')) {
        if (servedBatch) {
          return [];
        }

        servedBatch = true;

        return rows;
      }

      throw new Error(`unexpected query: ${sql}`);
    }),
  };

  const communications = {
    createManyDetailed: jest.fn(async (_ctx: unknown, input: CreateCommunicationDto[]) => {
      sent.push(...input);

      return input.map(() => ({ inserted: true }));
    }),
  };

  const noop = { createManyDetailed: jest.fn(async () => []), createDetailed: jest.fn(async () => []) };
  const logger = {
    setContext: jest.fn(),
    log: jest.fn(),
    warn: jest.fn((message: string, meta: unknown) => {
      warnings.push([message, meta]);
    }),
    debug: jest.fn(),
    error: jest.fn(),
  };

  const stage = new PushStage(
    dataSource as never,
    communications as never,
    noop as never,
    noop as never,
    noop as never,
    { create: jest.fn(async () => undefined) } as never,
    noop as never,
    { ingest: jest.fn(async () => ({ entities: [], errors: [] })) } as never,
    { send: jest.fn(async () => undefined) } as never,
    logger as never,
  );

  return { stage, sent, warnings };
}

const context: StageRunContext = {
  runId: RUN_ID,
  userId: USER_ID,
  stageId: STAGE_ID,
  scratchDir: '/tmp/does-not-matter',
  progress: jest.fn(async () => undefined),
} as unknown as StageRunContext;

describe('WhatsApp communications', () => {
  it('marks a message the owner sent outbound', async () => {
    const { stage, sent } = makeStage([whatsAppRow('Liam Broza', 'on my way')]);

    await stage.run(context);

    expect(sent).toHaveLength(1);
    expect(sent[0].direction).toBe('outbound');
  });

  it('marks a message from anyone else inbound', async () => {
    const { stage, sent } = makeStage([whatsAppRow('Alice Example', 'are we still on for tonight?')]);

    await stage.run(context);

    expect(sent[0].direction).toBe('inbound');
  });

  it('takes thread_id from Conversation, which the generic mapper never reads', async () => {
    // The silent half of the bug: toCommunicationInput reads
    // ThreadId/Thread/MessageID, and the WhatsApp importer stamps none of them.
    const { stage, sent } = makeStage([whatsAppRow('Alice Example', 'hi')]);

    await stage.run(context);

    expect(sent[0].thread_id).toBe('Family');
  });
});

describe('Facebook Messenger communications', () => {
  it('marks a message the owner sent outbound', async () => {
    const { stage, sent } = makeStage([messengerRow('Liam Broza', 'see you there')]);

    await stage.run(context);

    expect(sent[0].direction).toBe('outbound');
    // The Messenger contract also swaps the provenance triple's source_system.
    expect(sent[0].source_system).toBe('facebook_messenger');
    expect(sent[0].thread_id).toBe('Alice Example');
  });

  it('marks a message from anyone else inbound', async () => {
    const { stage, sent } = makeStage([messengerRow('Alice Example', 'see you there')]);

    await stage.run(context);

    expect(sent[0].direction).toBe('inbound');
  });
});

describe('when the owner cannot be resolved', () => {
  it('leaves every chat message inbound rather than guessing', async () => {
    const { stage, sent, warnings } = makeStage(
      [whatsAppRow('Liam Broza', 'on my way'), messengerRow('Liam Broza', 'see you there')],
      { ownerRows: [] },
    );

    await stage.run(context);

    expect(sent.map((input) => input.direction)).toEqual(['inbound', 'inbound']);
    expect(warnings.map(([message]) => message)).toContain(
      'No owner name resolved; chat messages stay inbound',
    );
  });

  it('survives a failed owner lookup without failing the push', async () => {
    const { stage, sent, warnings } = makeStage([whatsAppRow('Liam Broza', 'on my way')], {
      ownerQueryThrows: true,
    });

    const outcome = await stage.run(context);

    expect(outcome.detail).toMatchObject({ pushed: 1, failed: 0 });
    expect(sent[0].direction).toBe('inbound');
    // The thread name still lands: only direction depends on the owner.
    expect(sent[0].thread_id).toBe('Family');
    expect(warnings.map(([message]) => message)).toContain('Owner lookup failed; chat messages stay inbound');
  });
});

describe('every other communication', () => {
  it('still goes through the generic mapper, unchanged', async () => {
    const { stage, sent } = makeStage([
      stagedRow({
        dataSource: 'gmail',
        classification: 'email',
        metadata: {
          Subject: 'Lunch',
          ThreadId: 'thread-9',
          Direction: 'outgoing',
          Conversation: 'ignored by the generic path',
        },
      }),
    ]);

    await stage.run(context);

    expect(sent[0]).toMatchObject({
      direction: 'outbound',
      thread_id: 'thread-9',
      source_system: 'gmail',
      source_type: 'ci-import-tools',
    });
  });
});

describe('participant edges', () => {
  it('still ride on all three paths', async () => {
    // The staged edges are the whole point of resolving entities first, and the
    // specialised mappers must not cost a record its sender and recipients.
    const participants = [
      { relation: 'from', server_entity_id: 'entity-from' },
      { relation: 'to', server_entity_id: 'entity-to' },
      { relation: 'cc', server_entity_id: 'entity-cc' },
    ];
    const { stage, sent } = makeStage(
      [
        whatsAppRow('Alice Example', 'hi'),
        messengerRow('Alice Example', 'hi'),
        stagedRow({ dataSource: 'gmail', classification: 'email', metadata: { Subject: 'Lunch' } }),
      ],
      { participants },
    );

    await stage.run(context);

    expect(sent).toHaveLength(3);

    for (const input of sent) {
      expect(input.from_entity_id).toBe('entity-from');
      expect(input.to_entity_ids).toEqual(['entity-to', 'entity-cc']);
    }
  });
});
