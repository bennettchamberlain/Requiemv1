import { defineEvent } from '@ci/domains/events';

export const TaskCreatedEvent = 'task.created';
export const TaskUpdatedEvent = 'task.updated';
export const TaskRemovedEvent = 'task.deleted';

export type TaskCreatedPayload = {
  taskId: string;
};

export type TaskUpdatedPayload = {
  taskId: string;
};

export type TaskRemovedPayload = {
  taskId: string;
};

defineEvent<TaskCreatedPayload>(TaskCreatedEvent);
defineEvent<TaskUpdatedPayload>(TaskUpdatedEvent);
defineEvent<TaskRemovedPayload>(TaskRemovedEvent);

declare module '@ci/domains/events/registry' {
  interface EventRegistry {
    [TaskCreatedEvent]: TaskCreatedPayload;
    [TaskUpdatedEvent]: TaskUpdatedPayload;
    [TaskRemovedEvent]: TaskRemovedPayload;
  }
}
