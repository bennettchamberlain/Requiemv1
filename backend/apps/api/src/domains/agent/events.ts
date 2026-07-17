import { defineEvent } from '@ci/domains/events';

/**
 * Event emitted when a raw agent-memory fragment is written.
 *
 * @see {@link AgentMemoryService.create} - The method that emits this event
 */
export const AgentMemoryCreatedEvent = 'agent-memory.created';

/**
 * Payload of {@link AgentMemoryCreatedEvent}.
 *
 * Carries the fragment's raw text directly — fragments are immutable and
 * write-once, so the search-index listener can embed the content without a
 * round-trip back into the agent domain (avoids a search-ingress → agent
 * dependency).
 */
export type AgentMemoryCreatedPayload = {
  /** The identifier of the newly created memory fragment. */
  memoryId: string;
  /** Owner of the fragment. */
  userId: string;
  /** Raw fragment text, embedded for the recall message channel. */
  content: string;
};

/**
 * Event emitted when a raw agent-memory fragment is deleted.
 *
 * Mirrors {@link AgentMemoryCreatedEvent} so the search-index listener can
 * cascade-delete the fragment's 'message' embedding. Without this, deleting an
 * agent_memories row leaves an orphaned embedding in ci_search.embeddings (the
 * 'message' channel has no DB-level FK back to ci.agent_memories).
 *
 * @see {@link AgentMemoryService.remove} - The method that emits this event
 */
export const AgentMemoryRemovedEvent = 'agent-memory.deleted';

/**
 * Payload of {@link AgentMemoryRemovedEvent}.
 *
 * Carries only the identifiers needed to reap the embedding — unlike the
 * created payload there is no `content`, since deletion needs nothing to embed.
 */
export type AgentMemoryRemovedPayload = {
  /** The identifier of the deleted memory fragment. */
  memoryId: string;
  /** Owner of the fragment. */
  userId: string;
};

defineEvent<AgentMemoryCreatedPayload>(AgentMemoryCreatedEvent);
defineEvent<AgentMemoryRemovedPayload>(AgentMemoryRemovedEvent);

declare module '@ci/domains/events/registry' {
  interface EventRegistry {
    [AgentMemoryCreatedEvent]: AgentMemoryCreatedPayload;
    [AgentMemoryRemovedEvent]: AgentMemoryRemovedPayload;
  }
}
