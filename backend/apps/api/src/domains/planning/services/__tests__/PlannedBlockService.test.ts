import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { type UserServiceContext } from '@ci/common/context';
import { LoggerService } from '@ci/common/logging';
import { EventEntity, EventService, PersonService, UserContextService } from '@ci/domains/memory';
import { PersonalizationService } from '@ci/domains/personalization';

import { PlannedBlockService } from '../PlannedBlockService';
import { PlanningTimeService } from '../PlanningTimeService';
import { TaskService } from '../TaskService';

const CTX = { userId: 'alice-uuid' } as UserServiceContext;

const OPEN_TASK = {
  id: 'task-1',
  userId: CTX.userId,
  title: 'Call the dentist',
  description: null,
  status: 'open',
  estimatedMinutes: 30,
  scheduledFor: null,
} as const;

function makeEventQb(row: EventEntity | null) {
  const qb = {
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    addOrderBy: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    getOne: jest.fn().mockResolvedValue(row),
    getMany: jest.fn().mockResolvedValue(row ? [row] : []),
  };

  return qb;
}

describe('PlannedBlockService', () => {
  let service: PlannedBlockService;
  let eventRepository: { createQueryBuilder: jest.Mock };
  let eventService: {
    findById: jest.Mock;
    findByIds: jest.Mock;
    findInRange: jest.Mock;
    create: jest.Mock;
    remove: jest.Mock;
  };
  let taskService: {
    findById: jest.Mock;
    update: jest.Mock;
    createPendingChange: jest.Mock;
  };
  let personalizationService: { decideAction: jest.Mock };

  beforeEach(async () => {
    eventRepository = { createQueryBuilder: jest.fn(() => makeEventQb(null)) };
    eventService = {
      findById: jest.fn(),
      findByIds: jest.fn(),
      findInRange: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue([
        {
          id: 'evt-1',
          title: OPEN_TASK.title,
          eventType: 'planned_block',
          startTime: new Date('2026-08-18T09:00:00.000Z'),
          endTime: new Date('2026-08-18T09:30:00.000Z'),
        },
      ]),
      remove: jest.fn(),
    };
    taskService = {
      findById: jest.fn().mockResolvedValue(OPEN_TASK),
      update: jest.fn().mockResolvedValue({ ...OPEN_TASK, scheduledFor: '2026-08-18' }),
      createPendingChange: jest.fn(),
    };
    personalizationService = { decideAction: jest.fn() };

    const planningTime = {
      timezoneFor: jest.fn().mockResolvedValue('UTC'),
      today: jest.fn().mockResolvedValue('2026-08-18'),
      localDate: jest.fn().mockResolvedValue('2026-08-18'),
      toInstant: jest.fn(async (_ctx: unknown, date: string, wall: string) => new Date(`${date}T${wall}:00.000Z`)),
    };

    const module = await Test.createTestingModule({
      providers: [
        PlannedBlockService,
        { provide: getRepositoryToken(EventEntity), useValue: eventRepository },
        { provide: EventService, useValue: eventService },
        { provide: TaskService, useValue: taskService },
        { provide: PlanningTimeService, useValue: planningTime },
        { provide: PersonalizationService, useValue: personalizationService },
        { provide: PersonService, useValue: { findById: jest.fn() } },
        { provide: UserContextService, useValue: { getSelfIdentity: jest.fn().mockResolvedValue(null) } },
        { provide: LoggerService, useValue: { setContext: jest.fn(), log: jest.fn(), debug: jest.fn() } },
      ],
    }).compile();

    service = module.get(PlannedBlockService);
  });

  it('user Schedule always places without consulting the trust dial', async () => {
    const outcome = await service.scheduleTask(CTX, OPEN_TASK.id);

    expect(personalizationService.decideAction).not.toHaveBeenCalled();
    expect(eventService.create).toHaveBeenCalledWith(
      CTX,
      expect.objectContaining({
        event_type: 'planned_block',
        task_id: OPEN_TASK.id,
        title: OPEN_TASK.title,
      }),
    );
    expect(outcome.status).toBe('placed');
  });

  it('automation review writes a pending schedule instead of placing', async () => {
    personalizationService.decideAction.mockResolvedValue('review');

    const outcome = await service.tryPlaceAfterOpen(CTX, OPEN_TASK as never, 0.8);

    expect(outcome.status).toBe('proposed');
    expect(eventService.create).not.toHaveBeenCalled();
    expect(taskService.createPendingChange).toHaveBeenCalledWith(
      CTX,
      expect.objectContaining({
        taskId: OPEN_TASK.id,
        kind: 'schedule',
      }),
    );
  });

  it('automation auto places into the next free gap', async () => {
    personalizationService.decideAction.mockResolvedValue('auto');

    const outcome = await service.tryPlaceAfterOpen(CTX, OPEN_TASK as never, 0.9);

    expect(personalizationService.decideAction).toHaveBeenCalledWith(CTX.userId, {
      kind: 'schedule_accept',
      confidence: 0.9,
      hasUserInput: false,
    });
    expect(outcome.status).toBe('placed');
    expect(eventService.create).toHaveBeenCalled();
  });

  it('automation skip leaves the task unscheduled', async () => {
    personalizationService.decideAction.mockResolvedValue('skip');

    const outcome = await service.tryPlaceAfterOpen(CTX, OPEN_TASK as never, 0.4);

    expect(outcome.status).toBe('skipped');
    expect(eventService.create).not.toHaveBeenCalled();
    expect(taskService.createPendingChange).not.toHaveBeenCalled();
  });
});
