import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { SYSTEM_USER, type ServiceContext } from '@ci/common/context';
import { EventService as SignallingEventService } from '@ci/domains/events';

import { EventEntity } from '../../entities/EventEntity';
import { EventService } from '../EventService';

/** Chainable query-builder mock recording every clause, returning `many` from getMany. */
function makeQueryBuilder(many: unknown[]) {
  const calls: Record<string, unknown[][]> = {};
  const record = (name: string) => {
    calls[name] ??= [];

    return (...args: unknown[]) => {
      calls[name].push(args);

      return qb;
    };
  };

  const qb = {
    where: record('where'),
    andWhere: record('andWhere'),
    orderBy: record('orderBy'),
    addOrderBy: record('addOrderBy'),
    getMany: jest.fn(async () => many),
    calls,
  };

  return qb;
}

describe('EventService.findInRange — the calendar read path', () => {
  let service: EventService;
  let qb: ReturnType<typeof makeQueryBuilder>;

  const ctx = { userId: 'user-1' } as ServiceContext;
  const from = new Date('2026-08-03T00:00:00Z');
  const to = new Date('2026-08-10T00:00:00Z');

  function setup(many: unknown[] = []) {
    qb = makeQueryBuilder(many);
    const dataSource = {
      getRepository: jest.fn(() => ({ createQueryBuilder: jest.fn(() => qb) })),
    };

    return Test.createTestingModule({
      providers: [
        EventService,
        { provide: getRepositoryToken(EventEntity), useValue: {} },
        { provide: SignallingEventService, useValue: { send: jest.fn() } },
        { provide: DataSource, useValue: dataSource },
      ],
    })
      .compile()
      .then((moduleRef) => {
        service = moduleRef.get(EventService);
      });
  }

  const clauses = () => (qb.calls.andWhere ?? []).map(([clause]) => String(clause));
  const clauseWith = (needle: string) => clauses().find((clause) => clause.includes(needle));

  it('filters on interval overlap, not "starts within the window"', async () => {
    await setup();

    await service.findInRange(ctx, from, to);

    // An event that began before `from` but runs into the window must survive —
    // COALESCE treats a null end_time as an instant at start_time.
    expect(clauseWith('COALESCE(event.end_time, event.start_time) >= :from')).toBeDefined();
    expect(clauseWith('event.start_time < :to')).toBeDefined();

    // The search path's "must also END in-window" predicate must NOT appear.
    expect(clauseWith('event.end_time <= :to')).toBeUndefined();
  });

  it('binds the window as given', async () => {
    await setup();

    await service.findInRange(ctx, from, to);

    const params = (qb.calls.andWhere ?? []).map(([, bind]) => bind);
    expect(params).toContainEqual({ to });
    expect(params).toContainEqual({ from });
  });

  it('excludes cancelled and no-show but keeps tentative', async () => {
    await setup();

    await service.findInRange(ctx, from, to);

    const status = clauseWith('event.status');
    expect(status).toContain("NOT IN ('cancelled', 'no_show')");
    // A maybe on the calendar is still a claim on the slot.
    expect(status).not.toContain('tentative');
  });

  it('excludes soft-deleted rows', async () => {
    await setup();

    await service.findInRange(ctx, from, to);

    expect((qb.calls.where ?? [])[0]?.[0]).toBe('event.is_deleted = false');
  });

  it('scopes to the viewer', async () => {
    await setup();

    await service.findInRange(ctx, from, to);

    const params = (qb.calls.andWhere ?? []).map(([, bind]) => bind);
    expect(params).toContainEqual({ userId: 'user-1' });
  });

  it('does not scope when acting as the system user', async () => {
    await setup();

    await service.findInRange({ userId: SYSTEM_USER } as ServiceContext, from, to);

    expect(clauseWith('event.user_id = :userId')).toBeUndefined();
  });

  it('orders chronologically with a deterministic tiebreak', async () => {
    await setup();

    await service.findInRange(ctx, from, to);

    expect(qb.calls.orderBy?.[0]).toEqual(['event.start_time', 'ASC']);
    expect(qb.calls.addOrderBy?.[0]).toEqual(['event.event_id', 'ASC']);
  });

  it('maps rows through the egress type', async () => {
    await setup([{ id: 'e1', title: 'Standup', startTime: from, endTime: null }]);

    const result = await service.findInRange(ctx, from, to);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: 'e1', title: 'Standup' });
  });
});
