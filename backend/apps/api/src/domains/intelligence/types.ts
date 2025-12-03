import { z } from 'zod';

import type { Thread } from '@ci/domains/conversations';
import type { User } from '@ci/domains/user';

export interface Action {
  id: string;

  title: string | null;
  text: string | null;
  imageUrl: string | null;

  threadId: string | null;

  thread?: Thread;
  user?: User;
  tags?: string[];
}

export interface CreateActionDto {
  title: string;
  text: string;
  imageUrl?: string;
  priority?: number;
  threadId: string;
}

export interface CreateAnswerDto {
  id?: string;
  text: string;
  question: {
    id: string;
  };
  answerConfidence?: number;
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
  answerConfidence?: number;
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

export interface CreateQuestionDto {
  id?: string;
  text: string;
  subcategory?: string;
  isPrivateTo?: string | null;
}

export interface UpdateQuestionDto {
  subcategory?: string;
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

export const createQuestionSchema = z.object({
  subcategory: z.string().optional(),
  text: z.string(),
  contextTags: z.array(z.string()).optional(),
  questionType: z.string().optional(),
  isSeedQuestion: z.boolean().optional(),
  isActive: z.boolean().optional(),
  createdByLlm: z.boolean().optional(),
  frequencyRecommendation: z.string().optional(),
  timesAsked: z.number().optional(),
  timesAnswered: z.number().optional(),
  isPrivateTo: z.string().nullable().optional(),
});

export const updateQuestionSchema = z.object({
  subcategory: z.string().optional(),
  text: z.string(),
  contextTags: z.array(z.string()).optional(),
  questionType: z.string().optional(),
  isSeedQuestion: z.boolean().optional(),
  isActive: z.boolean().optional(),
  createdByLlm: z.boolean().optional(),
  frequencyRecommendation: z.string().optional(),
  timesAsked: z.number().optional(),
  timesAnswered: z.number().optional(),
  isPrivateTo: z.string().nullable().optional(),
});

export const createAnswerSchema = z.object({
  text: z.string().min(1, 'Answer text is required').max(5000, 'Answer text must be 5000 characters or less'),
  question: z.object({
    id: z.string().uuid('Invalid question ID'),
  }),
  answerConfidence: z.number().min(0).max(1).optional(),
  answerSource: z.string().optional(),
  answerMethod: z.string().optional(),
  answeredAt: z.date().optional(),
  sessionContext: z.record(z.unknown()).optional(),
  emotionalState: z.string().optional(),
  locationContext: z.string().optional(),
  extractedEntities: z.array(z.string()).optional(),
  sentimentScore: z.number().min(-1).max(1).optional(),
  complexityScore: z.number().min(0).optional(),
  isSensitive: z.boolean().optional(),
  sharingLevel: z.string().optional(),
});

export const updateAnswerSchema = z.object({
  text: z
    .string()
    .min(1, 'Answer text is required')
    .max(5000, 'Answer text must be 5000 characters or less')
    .optional(),
  answerConfidence: z.number().min(0).max(1).optional(),
  answerSource: z.string().optional(),
  answerMethod: z.string().optional(),
  answeredAt: z.date().optional(),
  sessionContext: z.record(z.unknown()).optional(),
  emotionalState: z.string().optional(),
  locationContext: z.string().optional(),
  extractedEntities: z.array(z.string()).optional(),
  sentimentScore: z.number().min(-1).max(1).optional(),
  complexityScore: z.number().min(0).optional(),
  isSensitive: z.boolean().optional(),
  sharingLevel: z.string().optional(),
});
