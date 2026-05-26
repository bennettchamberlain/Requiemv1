import { z } from 'zod';

// ---------------------------------------------------------------------------
// Request DTOs
// ---------------------------------------------------------------------------

export const recallSchema = z.object({
  query: z.string().min(1).max(2000),
  maxResults: z.number().int().min(1).max(20).optional(),
});

export const absorbSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant', 'system']),
        content: z.string(),
      }),
    )
    .min(1),
  sessionId: z.string().optional(),
  platform: z.string().optional(),
});

export type RecallDto = z.infer<typeof recallSchema>;
export type AbsorbDto = z.infer<typeof absorbSchema>;

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

export interface AbsorbResult {
  ok: boolean;
  inserted: number;
}
