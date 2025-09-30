/* eslint-disable @typescript-eslint/no-explicit-any */
import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { z } from 'zod';

import { BaseTool } from '../../core/BaseTool';
import type { ToolExecutionContext } from '../../core/types';

// Input schema for the tool
const getEntertainmentPreferencesInputSchema = z.object({
  category: z.enum(['movies', 'tv', 'streaming', 'general']).optional(),
  userId: z.string().optional(), // Optional - to query other users
});

type GetEntertainmentPreferencesInput = z.infer<typeof getEntertainmentPreferencesInputSchema>;

// Output interface
interface EntertainmentPreference {
  id: string;
  label: string;
  category?: string;
  subcategory?: string;
  userId: string;
  createdAt: Date;
  question?: string;
  answer?: string;
}

interface GetEntertainmentPreferencesOutput {
  preferences: EntertainmentPreference[];
  totalCount: number;
  userId: string;
}

/**
 * Tool to retrieve user entertainment preferences from the database
 * Focuses on movie, TV, and streaming preferences for recommendation systems
 *
 * FUTURE INTEGRATIONS PLANNED:
 * - Movie theater APIs (Fandango, AMC) for current showtimes
 * - TV guide APIs for current programming
 * - Review aggregation APIs (Rotten Tomatoes, Metacritic)
 *
 * This tool serves as the foundation for understanding user preferences
 * before querying external entertainment APIs for personalized recommendations.
 * *Meant to be used in conjunction with GetStreamingAvailabilityTool*
 */
@Injectable()
export class GetEntertainmentPreferencesTool extends BaseTool<
  GetEntertainmentPreferencesInput,
  GetEntertainmentPreferencesOutput
> {
  readonly schema = {
    name: 'getEntertainmentPreferences',
    description:
      "Get user entertainment preferences including movie genres, TV show types, streaming preferences, and viewing habits. Use this tool when recommending movies, TV shows, or planning entertainment. By default gets current user's preferences, but can query other users if userId is provided.",
    category: 'database',
    parameters: {
      type: 'object',
      properties: {
        category: {
          type: 'string',
          enum: ['movies', 'tv', 'streaming', 'general'],
          description: 'Filter preferences by entertainment category (optional)',
        },
        userId: {
          type: 'string',
          description:
            'User ID to get preferences for (optional, defaults to current user). Use this to get preferences for family members.',
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
              label: 'What movie genres do you enjoy?: I love sci-fi and thriller movies',
              category: 'Personal Preferences',
              subcategory: 'Entertainment',
              userId: 'user-uuid',
              createdAt: new Date(),
              question: 'What movie genres do you enjoy?',
              answer: 'I love sci-fi and thriller movies',
            },
          ],
          totalCount: 1,
          userId: 'user-uuid',
        },
        description: 'Get entertainment preferences for movie and TV recommendations',
      },
    ],
  };

  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {
    super();
  }

  protected validateInput(input: unknown): GetEntertainmentPreferencesInput {
    return getEntertainmentPreferencesInputSchema.parse(input);
  }

  protected async executeInternal(
    context: ToolExecutionContext,
    input: GetEntertainmentPreferencesInput,
  ): Promise<GetEntertainmentPreferencesOutput> {
    // Determine which user's preferences to fetch
    const targetUserId = input.userId || context.userId;

    if (!targetUserId) {
      throw new Error('No user ID available in context or input');
    }

    // Query for questions with subcategory = 'Entertainment'
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
        AND q.context_tags && ARRAY['Entertainment']::text[]
        AND a.answer_text IS NOT NULL
      ORDER BY q.created_at
    `;

    const result = await this.dataSource.query(query, [targetUserId]);

    const preferences: EntertainmentPreference[] = result.map((row: any) => ({
      id: row.answerId,
      label: `${row.question}: ${row.answer}`,
      category: row.category,
      subcategory: row.context_tags?.find((tag: string) => tag === 'Entertainment') || 'Entertainment',
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
    // No sensitive data in entertainment preferences input
    return input;
  }
}
