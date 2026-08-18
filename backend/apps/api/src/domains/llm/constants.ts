import type { QueueOptions } from '@ci/domains/events';

/**
 * Serial LLM work: chat turns, thread titles, and answer inference share this
 * queue so they cannot stampede a 1–2 slot local GPU. `localConcurrency: 1`
 * is the point — chat jobs jump the line via INTERACTIVE_JOB_PRIORITY, then
 * titles/inference run when the slot is free.
 */
export const LLM_QUEUE = 'llm';

export const LLM_QUEUE_OPTIONS: QueueOptions = {
  localConcurrency: 1,
  expireInSeconds: 900,
  retryLimit: 3,
  retryDelay: 10,
};

export type ThreadGenerationStatus = 'idle' | 'queued' | 'running' | 'failed';

export const GENERATION_STATUSES = ['idle', 'queued', 'running', 'failed'] as const;

export function isActiveGenerationStatus(status: string | null | undefined): boolean {
  return status === 'queued' || status === 'running';
}
