import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import type { ServiceContext } from '@ci/common/context';
import { EventService as SignallingEventService } from '@ci/domains/events';

import { EventEntity } from '../../entities/EventEntity';
import { EventService } from '../EventService';

const ctx = { userId: 'user-1' } as ServiceContext;

function existing(overrides: Partial<EventEntity> = {}): EventEntity {
  return {
    id: 'e1',
    title: 'Design review',
    startTime: new Date('2026-08-03T14:00:00Z'),
    endTime: new Date('2026-08-03T15:30:00Z'),
    sourceSystem: null,
    externalSyncStatus: null,
    ...overrides,
  } as EventEntity;
}

describe('EventService.reschedule — moving an event on the calendar', () => {
  let service: EventService;
  let repo: { findOne: jest.Mock; save: jest.Mock; find: jest.Mock };
  let signalling: { send: jest.Mock };
  let saved: EventEntity | undefined;

  async function setup(row: EventEntity | null) {
    saved = undefined;
    repo = {
      findOne: jest.fn(async () => row),
      save: jest.fn(async (entity: EventEntity) => {
        saved = entity;

        return entity;
      }),
      find: jest.fn(async () => []),
    };
    signalling = { send: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        EventService,
        { provide: getRepositoryToken(EventEntity), useValue: repo },
        { provide: SignallingEventService, useValue: signalling },
        { provide: DataSource, useValue: { getRepository: jest.fn() } },
      ],
    }).compile();

    service = moduleRef.get(EventService);
  }

  const newStart = new Date('2026-08-06T10:00:00Z');

  it('preserves the duration when only a start is given', async () => {
    await setup(existing());

    await service.reschedule(ctx, 'e1', newStart);

    // 90 minutes in, 90 minutes out.
    expect(saved?.startTime).toEqual(newStart);
    expect(saved?.endTime).toEqual(new Date('2026-08-06T11:30:00Z'));
  });

  it('honours an explicit end time', async () => {
    await setup(existing());
    const end = new Date('2026-08-06T10:30:00Z');

    await service.reschedule(ctx, 'e1', newStart, end);

    expect(saved?.endTime).toBe(end);
  });

  it('leaves an open-ended event open-ended', async () => {
    await setup(existing({ endTime: null }));

    await service.reschedule(ctx, 'e1', newStart);

    expect(saved?.endTime).toBeNull();
  });

  it('marks an externally-sourced event as diverged from its calendar', async () => {
    await setup(existing({ sourceSystem: 'google_calendar' }));

    await service.reschedule(ctx, 'e1', newStart);

    // The move does not reach Google; `pending` is the record that it drifted.
    expect(saved?.externalSyncStatus).toBe('pending');
  });

  it('leaves a locally-created event unmarked', async () => {
    await setup(existing({ sourceSystem: null }));

    await service.reschedule(ctx, 'e1', newStart);

    expect(saved?.externalSyncStatus).toBeNull();
  });

  it('signals the move so search and enrichment re-read the row', async () => {
    await setup(existing());

    await service.reschedule(ctx, 'e1', newStart);

    expect(signalling.send).toHaveBeenCalledTimes(1);
  });

  it('returns null for an event the viewer does not own', async () => {
    await setup(null);

    await expect(service.reschedule(ctx, 'missing', newStart)).resolves.toBeNull();
    expect(repo.save).not.toHaveBeenCalled();
  });
});
