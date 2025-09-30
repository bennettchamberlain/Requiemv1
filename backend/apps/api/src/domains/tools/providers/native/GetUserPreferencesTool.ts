/* eslint-disable @typescript-eslint/no-explicit-any */
import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { z } from 'zod';

import { BaseTool } from '../../core/BaseTool';
import type { ToolExecutionContext } from '../../core/types';

// Input schema for the tool
const getUserPreferencesInputSchema = z.object({
  category: z.enum(['food', 'environment', 'learning', 'general']).optional(),
  userId: z.string().optional(), // Optional - to query other users like family members
});

type GetUserPreferencesInput = z.infer<typeof getUserPreferencesInputSchema>;

// Output interface
interface UserPreference {
  id: string;
  label: string;
  category?: string;
  subcategory?: string;
  userId: string;
  createdAt: Date;
  question?: string;
  answer?: string;
}

interface GetUserPreferencesOutput {
  preferences: UserPreference[];
  totalCount: number;
  userId: string;
}

/**
 * Tool to retrieve user preferences from the database
 * Useful for dinner planning and food-related conversations
 */
@Injectable()
export class GetUserPreferencesTool extends BaseTool<GetUserPreferencesInput, GetUserPreferencesOutput> {
  readonly schema = {
    name: 'getUserPreferences',
    description:
      "Get user food preferences, dietary restrictions, allergies, and eating habits. Use this tool when planning meals, cooking, or discussing food choices. By default gets the current user's preferences, but can query other users if userId is provided.",
    category: 'database',
    parameters: {
      type: 'object',
      properties: {
        category: {
          type: 'string',
          enum: ['food', 'environment', 'learning', 'general'],
          description:
            'Filter preferences by category (optional) - not used currently as we focus on food subcategory',
        },
        userId: {
          type: 'string',
          description:
            'User ID to get preferences for (optional, defaults to current user). Use this to get preferences for family members or other people.',
        },
      },
      required: [],
    },
    examples: [
      {
        input: {},
        output: {
          preferences: [
            {
              id: 'uuid-123',
              label: 'Do you have any food allergies?: No known allergies',
              category: 'Physical Health',
              subcategory: 'Food',
              userId: 'user-uuid',
              createdAt: new Date(),
              question: 'Do you have any food allergies?',
              answer: 'No known allergies',
            },
          ],
          totalCount: 1,
          userId: 'user-uuid',
        },
        description: 'Get food-related preferences for comprehensive meal planning',
      },
    ],
  };

  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {
    super();
  }

  protected validateInput(input: unknown): GetUserPreferencesInput {
    return getUserPreferencesInputSchema.parse(input);
  }

  protected async executeInternal(
    context: ToolExecutionContext,
    input: GetUserPreferencesInput,
  ): Promise<GetUserPreferencesOutput> {
    // Determine which user's preferences to fetch
    // If userId provided in input, use that; otherwise use current user from context
    const targetUserId = input.userId || context.userId;

    if (!targetUserId) {
      throw new Error('No user ID available in context or input');
    }

    // Query for questions with subcategory = 'Food' (much more focused than all Personal Preferences)
    // Updated to use new schema: question_id, answer_id, answer_text
    const query = `
      SELECT 
        q.question_text as question,
        a.answer_text as answer,
        q.question_category as category,
        q.context_tags,
        a.user_id as "userId",
        q.created_at as "createdAt",
        a.answer_id as "answerId"
      FROM questions q
      JOIN answers a ON q.question_id = a.question_id  
      WHERE a.user_id = $1
        AND q.context_tags && ARRAY['Food']::text[]
        AND a.answer_text IS NOT NULL
      ORDER BY q.created_at
    `;

    const result = await this.dataSource.query(query, [targetUserId]);

    const preferences: UserPreference[] = result.map((row: any) => ({
      id: row.answerId,
      label: `${row.question}: ${row.answer}`,
      category: row.category,
      subcategory: row.context_tags?.find((tag: string) => tag === 'Food') || 'Food',
      userId: row.userId,
      createdAt: row.createdAt,
      question: row.question,
      answer: row.answer,
    }));

    return {
      preferences,
      totalCount: preferences.length,
      userId: targetUserId,
    };
  }

  protected sanitizeInputForLogging(input: unknown): any {
    // No sensitive data in preferences input
    return input;
  }
}
