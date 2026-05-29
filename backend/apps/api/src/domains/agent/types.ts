import { z } from 'zod';

// ---------------------------------------------------------------------------
// Request DTOs
// ---------------------------------------------------------------------------

export const recallSchema = z.object({
  query: z.string().min(1).max(2000),
  maxResults: z.number().int().min(1).max(20).optional(),
});

export const turnSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant', 'system']),
        content: z.string(),
      }),
    )
    .min(1),
  sessionId: z.string().optional(),
});

/**
 * A raw memory fragment written by the agent or Hermes's built-in memory
 * system (on_memory_write).  Stored verbatim in ci.notes for later extraction
 * into structured graph entities.
 */
export const noteSchema = z.object({
  content: z.string().min(1).max(10000),
  /** Optional short label — defaults to the target file name if omitted. */
  title: z.string().max(500).optional(),
  /** Hermes target file: "memory" | "user", or any other source identifier. */
  source: z.string().max(50).optional(),
});

export type RecallDto = z.infer<typeof recallSchema>;
export type TurnDto = z.infer<typeof turnSchema>;
export type NoteDto = z.infer<typeof noteSchema>;

// ---------------------------------------------------------------------------
// Response shapes
// ---------------------------------------------------------------------------

export interface ContextResult {
  block: string;
}

export interface RecallResult {
  block: string;
  resultCount: number;
}
