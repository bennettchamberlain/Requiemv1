import { z } from 'zod';

export type ActionSource = 'legacy' | 'correlation' | 'anomaly' | 'suggestion';

export interface CreateActionDto {
  id?: string;
  title: string;
  text: string;
  imageUrl?: string;
  priority?: number;
  threadId?: string;
  seen?: boolean;
  dismissed?: boolean;
  source?: ActionSource;
  metadata?: Record<string, unknown>;
}

export interface CreateAnswerDto {
  id?: string;
  text: string;
  question: {
    id: string;
  };
  answerConfidence?: number | null;
  answerRationale?: string | null;
  answerSource?: string;
  answerMethod?: string;
  answeredAt?: Date;
  sessionContext?: Record<string, unknown>;
  emotionalState?: string;
  locationContext?: string;
  extractedEntities?: string[];
  sentimentScore?: number;
  complexityScore?: number;
  isSensitive?: boolean;
  sharingLevel?: string;
}

export interface UpdateAnswerDto {
  text?: string;
  answerConfidence?: number | null;
  answerRationale?: string | null;
  answerSource?: string;
  answerMethod?: string;
  answeredAt?: Date;
  sessionContext?: Record<string, unknown>;
  emotionalState?: string;
  locationContext?: string;
  extractedEntities?: string[];
  sentimentScore?: number;
  complexityScore?: number;
  isSensitive?: boolean;
  sharingLevel?: string;
}

/**
 * `ci.questions.answer_tier` — which half of the catalogue a reflection belongs
 * to. Mirrors the `questions_answer_tier_check` constraint; selection orders by
 * it (see TIER_RANK_SQL in QuestionService).
 */
export const ANSWER_TIERS = ['factual', 'preference', 'narrative'] as const;
export type AnswerTier = (typeof ANSWER_TIERS)[number];

export interface CreateQuestionDto {
  id?: string;
  text: string;
  category?: string;
  answerTier?: AnswerTier | null;
  isSeedQuestion?: boolean;
  isActive?: boolean;
  createdByLlm?: boolean;
  frequencyRecommendation?: string;
  isPrivateTo?: string | null;
}

export interface UpdateQuestionDto {
  /** Historical name for `category` on the REST/GraphQL edge; still honoured. */
  subcategory?: string;
  category?: string;
  answerTier?: AnswerTier | null;
  text?: string;
  contextTags?: string[];
  questionType?: string;
  isSeedQuestion?: boolean;
  isActive?: boolean;
  createdByLlm?: boolean;
  frequencyRecommendation?: string;
  timesAsked?: number;
  timesAnswered?: number;
  isPrivateTo?: string;
}

const questionTextSchema = z
  .string()
  .trim()
  .min(1, 'Reflection text is required')
  .max(500, 'Reflection text must be 500 characters or less');

const questionCategorySchema = z
  .string()
  .trim()
  .min(1, 'Category is required')
  .max(120, 'Category must be 120 characters or less');

export const skipFeedQuestionSchema = z.object({
  presentationId: z.string().min(1),
});

export const createQuestionSchema = z.object({
  text: questionTextSchema,
  // `subcategory` predates `category` on this endpoint and was the ONLY field
  // the schema accepted, while the service reads `data.category` — so every
  // REST-created question landed with a null category. Both spellings are
  // accepted now; `category` wins when both are sent.
  category: questionCategorySchema.optional(),
  subcategory: questionCategorySchema.optional(),
  answerTier: z.enum(ANSWER_TIERS).nullish(),
});

export const updateQuestionSchema = z
  .object({
    text: questionTextSchema.optional(),
    category: questionCategorySchema.optional(),
    subcategory: questionCategorySchema.optional(),
    answerTier: z.enum(ANSWER_TIERS).nullish(),
    // Deactivation is the supported way to retire a reflection: ci.answers and
    // ci.feed_queue both cascade on delete, so a hard DELETE takes real human
    // answers with it.
    isActive: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field must be provided',
  });

/**
 * Query string for `GET /questions/catalogue`. Everything arrives as a string,
 * so the numeric and enum fields are coerced/validated rather than trusted.
 */
export const questionCatalogueQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
  category: z.string().trim().max(120).optional(),
  answerTier: z.enum(ANSWER_TIERS).optional(),
  status: z.enum(['active', 'inactive', 'all']).default('active'),
  answered: z.enum(['answered', 'unanswered', 'all']).default('all'),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
  // Comma-separated question ids — an explicit allow-list layered on top of
  // the other filters. Lets a caller with a fixed, known set of ids (the Self
  // page's curated Life Details list) fetch exactly those rows plus their
  // answer status in one call, instead of one call per id or over-fetching a
  // whole category.
  ids: z
    .string()
    .trim()
    .optional()
    .transform((val) =>
      val
        ? val
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : undefined,
    )
    .pipe(z.array(z.string().uuid()).max(100).optional()),
  // Comma-separated `ci.questions.question_key` slugs — the same allow-list as
  // `ids`, addressed by a name that survives leaving this database. A uuid
  // belongs to one appliance (`gen_uuid_v7()` mints a new one per install), so
  // client code that hardcoded curated ids matched nothing anywhere else and
  // silently rendered a dead section; a key is written by the seed migration
  // and means the same thing everywhere. Prefer this over `ids` for anything
  // fixed and curated. Both may be sent, and then both must match.
  keys: z
    .string()
    .trim()
    .optional()
    .transform((val) =>
      val
        ? val
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : undefined,
    )
    .pipe(z.array(z.string().max(120)).max(100).optional()),
});

export type QuestionCatalogueQueryDto = z.infer<typeof questionCatalogueQuerySchema>;

export const createAnswerSchema = z.object({
  text: z.string().min(1, 'Answer text is required').max(5000, 'Answer text must be 5000 characters or less'),
  question: z.object({
    id: z.string().uuid('Invalid question ID'),
  }),
});

export const updateAnswerSchema = z.object({
  text: z
    .string()
    .min(1, 'Answer text is required')
    .max(5000, 'Answer text must be 5000 characters or less')
    .optional(),
});
