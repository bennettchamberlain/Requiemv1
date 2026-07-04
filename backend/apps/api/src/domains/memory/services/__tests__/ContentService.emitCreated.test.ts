import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import type { UserServiceContext } from '@ci/common/context';
import { EventService as SignallingEventService } from '@ci/domains/events';
import { ContentCreatedEvent } from '@ci/domains/memory/events';

import { ContentEntity } from '../../entities/ContentEntity';
import { EventEntity } from '../../entities/EventEntity';
import type { CreateContentDto } from '../../types';
import { ContentService } from '../ContentService';

/**
 * Regression guard for the bulk-ingest event-emission contract:
 * interactive create() emits ContentCreatedEvent (live search indexing), while
 * the bulk createMany() path suppresses it — indexing for bulk loads is
 * recovered by the post-load sweep (POST /api/maintenance/search-index/backfill).
 * If someone re-enables per-row emission in the bulk path (re-introducing the
 * pgboss fan-out that dominated import cost) or drops emission from the
 * interactive path (silently un-indexing live creates), this fails.
 */
describe('ContentService — ContentCreatedEvent emission contract', () => {
  let service: ContentService;
  let repo: { create: jest.Mock; save: jest.Mock; findOne: jest.Mock };
  let eventRepo: { findOne: jest.Mock };
  let signalling: { send: jest.Mock };

  const ctx = { userId: 'user-1' } as UserServiceContext;

  beforeEach(async () => {
    repo = {
      create: jest.fn((x: unknown) => x),
      save: jest.fn(async (x: { id?: string }) => ({ ...x, id: x.id ?? 'content-1' })),
      findOne: jest.fn(async () => null),
    };
    eventRepo = { findOne: jest.fn(async () => null) };
    signalling = { send: jest.fn() };

    const mod = await Test.createTestingModule({
      providers: [
        ContentService,
        { provide: getRepositoryToken(ContentEntity), useValue: repo },
        { provide: getRepositoryToken(EventEntity), useValue: eventRepo },
        { provide: SignallingEventService, useValue: signalling },
      ],
    }).compile();
    service = mod.get(ContentService);
  });

  it('interactive create() emits ContentCreatedEvent for the new row', async () => {
    await service.create(ctx, { type: 'note', text: 'hi' } as CreateContentDto);

    expect(signalling.send).toHaveBeenCalledTimes(1);
    // create() assigns a uuidv7 before save, so assert the event name + shape.
    expect(signalling.send).toHaveBeenCalledWith(ContentCreatedEvent, { contentId: expect.any(String) });
  });

  it('create() with emitCreated:false suppresses the event', async () => {
    await service.create(ctx, { type: 'note', text: 'hi' } as CreateContentDto, { emitCreated: false });

    expect(signalling.send).not.toHaveBeenCalled();
  });

  it('bulk createMany() never emits per-row events (indexing is deferred to the backfill sweep)', async () => {
    await service.createMany(ctx, [
      { type: 'note', text: 'a', source_type: 'ci-import-tools', source_system: 'x', source_id: '1' },
      { type: 'note', text: 'b', source_type: 'ci-import-tools', source_system: 'x', source_id: '2' },
    ] as CreateContentDto[]);

    expect(repo.save).toHaveBeenCalledTimes(2); // rows landed…
    expect(signalling.send).not.toHaveBeenCalled(); // …but no per-row fan-out
  });
});
