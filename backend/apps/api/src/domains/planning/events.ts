import { defineEvent } from '@ci/domains/events';

export const TaskCreatedEvent = 'task.created';
export const TaskUpdatedEvent = 'task.updated';
export const TaskRemovedEvent = 'task.deleted';

export const PlanningTodoScanEvent = 'planning.todo_scan';
export const PlanningTodoProcessEvent = 'planning.todo_process';
export const PlanningEventNowEvent = 'planning.event_now';
export const PlanningVerifyDoneEvent = 'planning.verify_done';

export type TaskCreatedPayload = {
  taskId: string;
};

export type TaskUpdatedPayload = {
  taskId: string;
};

export type TaskRemovedPayload = {
  taskId: string;
};

/** Per-user planning job payload. Cron fan-out resolves a real userId first. */
export type PlanningUserJobPayload = {
  userId: string;
};

defineEvent<TaskCreatedPayload>(TaskCreatedEvent);
defineEvent<TaskUpdatedPayload>(TaskUpdatedEvent);
defineEvent<TaskRemovedPayload>(TaskRemovedEvent);
defineEvent<PlanningUserJobPayload>(PlanningTodoScanEvent);
defineEvent<PlanningUserJobPayload>(PlanningTodoProcessEvent);
defineEvent<PlanningUserJobPayload>(PlanningEventNowEvent);
defineEvent<PlanningUserJobPayload>(PlanningVerifyDoneEvent);

declare module '@ci/domains/events/registry' {
  interface EventRegistry {
    [TaskCreatedEvent]: TaskCreatedPayload;
    [TaskUpdatedEvent]: TaskUpdatedPayload;
    [TaskRemovedEvent]: TaskRemovedPayload;
    [PlanningTodoScanEvent]: PlanningUserJobPayload;
    [PlanningTodoProcessEvent]: PlanningUserJobPayload;
    [PlanningEventNowEvent]: PlanningUserJobPayload;
    [PlanningVerifyDoneEvent]: PlanningUserJobPayload;
  }
}
