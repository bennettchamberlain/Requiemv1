import type { Repository } from 'typeorm';

import type { UserServiceContext } from '@ci/common/context';
import type { LoggerService } from '@ci/common/logging';
import type { DeviceService } from '@ci/domains/devices';
import type { EventService } from '@ci/domains/events';

import type { PositionEntity } from '../../entities/PositionEntity';
import { PositionService } from '../PositionService';

const ctx = { userId: '00000000-0000-0000-0000-0000000000aa' } as UserServiceContext;

function makeService(existing: PositionEntity[] = []) {
  const created: Record<string, unknown>[] = [];
  const repository = {
    // Pass-through create so the spec can assert exactly what would be persisted.
    create: jest.fn((row: Record<string, unknown>) => {
      created.push(row);

      return row;
    }),
    save: jest.fn(async (rows: PositionEntity[]) =>
      rows.map((r) => ({ ...r, time: new Date((r as { time: Date }).time) })),
    ),
    // findExistingByTimes: mimics a real `In(times)` lookup against whatever
    // rows the test seeds as already persisted, keyed by the same instant
    // findExistingByTimes queries on (not string equality).
    find: jest.fn(async ({ where }: { where: { time: { _value: Date[] } } }) => {
      const queriedTimes = new Set(where.time._value.map((t) => t.getTime()));

      return existing.filter((row) => queriedTimes.has(row.time.getTime()));
    }),
  } as unknown as Repository<PositionEntity>;

  const deviceService = { findById: jest.fn(async () => null) } as unknown as DeviceService;
  const eventService = { send: jest.fn(async () => undefined) } as unknown as EventService;
  const logger = {
    setContext: jest.fn(),
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as LoggerService;

  return {
    service: new PositionService(repository, deviceService, eventService, logger),
    repository,
    eventService,
    created,
  };
}

function existingRow(over: Partial<PositionEntity> = {}): PositionEntity {
  return {
    id: 'existing-1',
    time: new Date('2026-01-01T00:00:00.000Z'),
    userId: ctx.userId,
    ...over,
  } as PositionEntity;
}

const fix = (over: Record<string, unknown> = {}) => ({
  time: '2026-01-01T00:00:00.000Z',
  source: 'gps' as const,
  location: { x: -73.9857, y: 40.7484 },
  ...over,
});

describe('PositionService bulk-ingest contract (#1672)', () => {
  it('persists the provenance triple when a record carries one', async () => {
    const { service, created } = makeService();

    await service.create(ctx, [
      fix({
        source_type: 'ci-import-tools',
        source_system: 'google_photos',
        source_id: 'IMG_1.jpg',
      }),
    ]);

    expect(created[0]).toMatchObject({
      sourceType: 'ci-import-tools',
      sourceSystem: 'google_photos',
      sourceId: 'IMG_1.jpg',
    });
  });

  it('nulls the triple for live fixes that have no import provenance', async () => {
    const { service, created } = makeService();

    await service.create(ctx, [fix()]);

    expect(created[0]).toMatchObject({ sourceType: null, sourceSystem: null, sourceId: null });
  });

  it('emits PositionCreatedEvent per row by default (live-device path unchanged)', async () => {
    const { service, eventService } = makeService();

    await service.create(ctx, [fix(), fix({ time: '2026-01-01T00:01:00.000Z' })]);

    expect(eventService.send).toHaveBeenCalledTimes(2);
  });

  it('emitCreated:false suppresses the per-row fan-out (bulk plane)', async () => {
    const { service, eventService, repository } = makeService();

    const rows = await service.create(ctx, [fix(), fix({ time: '2026-01-01T00:01:00.000Z' })], {
      emitCreated: false,
    });

    expect(eventService.send).not.toHaveBeenCalled();
    // Rows still persist and return — only the event fan-out is suppressed.
    expect(repository.save).toHaveBeenCalledTimes(1);
    expect(rows).toHaveLength(2);
  });

  describe('dedup contract (#1672)', () => {
    it('collapses in-batch duplicates that name the same instant with different string formatting', async () => {
      // Same instant, three different valid ISO representations: bare
      // seconds, explicit milliseconds, and a +00:00 offset instead of Z.
      // A GPS-track re-import can plausibly emit any of these for the same
      // fix depending on the exporter, so dedup has to key on the parsed
      // instant, not the literal string.
      const { service, repository, created } = makeService();

      const rows = await service.create(ctx, [
        fix({ time: '2026-01-01T00:00:00Z' }),
        fix({ time: '2026-01-01T00:00:00.000Z' }),
        fix({ time: '2026-01-01T00:00:00.000+00:00' }),
      ]);

      expect(created).toHaveLength(1);
      expect(rows).toHaveLength(1);
      expect(repository.save).toHaveBeenCalledTimes(1);
      expect((repository.save as jest.Mock).mock.calls[0][0]).toHaveLength(1);
    });

    it('does not re-insert a fix that already exists in the DB for that exact time', async () => {
      const { service, repository, created, eventService } = makeService([
        existingRow({ id: 'already-there', time: new Date('2026-01-01T00:00:00.000Z') }),
      ]);

      const rows = await service.create(ctx, [fix({ time: '2026-01-01T00:00:00.000Z' })]);

      expect(created).toHaveLength(0);
      expect(repository.save).not.toHaveBeenCalled();
      expect(eventService.send).not.toHaveBeenCalled();
      // The existing row is still returned to the caller — re-import is a
      // no-op, not data loss.
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe('already-there');
    });

    it('treats a differently-formatted duplicate of an existing DB row as already present too', async () => {
      // The DB row was written as a bare-Z timestamp; the re-import sends
      // the same instant with milliseconds. findExistingByTimes has to
      // recognize these as the same fix or the re-import duplicates it.
      const { service, repository, created } = makeService([
        existingRow({ id: 'already-there', time: new Date('2026-01-01T00:00:00.000Z') }),
      ]);

      const rows = await service.create(ctx, [fix({ time: '2026-01-01T00:00:00.000+00:00' })]);

      expect(created).toHaveLength(0);
      expect(repository.save).not.toHaveBeenCalled();
      expect(rows.map((r) => r.id)).toEqual(['already-there']);
    });

    it('still inserts a fix at a genuinely different time from an unrelated pre-existing row', async () => {
      // The pre-existing row sits at a different instant than anything in
      // this batch, so it must not suppress the new insert (over-eager
      // dedup would be just as bad as under-eager dedup here).
      const { service, repository, created } = makeService([
        existingRow({ id: 'already-there', time: new Date('2026-01-01T00:00:00.000Z') }),
      ]);

      const rows = await service.create(ctx, [fix({ time: '2026-01-01T05:00:00.000Z' })]);

      expect(created).toHaveLength(1);
      expect(repository.save).toHaveBeenCalledTimes(1);
      expect(rows).toHaveLength(1);
      expect(rows[0].id).not.toBe('already-there');
    });
  });
});
