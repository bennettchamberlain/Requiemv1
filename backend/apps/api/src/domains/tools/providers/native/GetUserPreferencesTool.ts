/* eslint-disable @typescript-eslint/no-explicit-any */
import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { z } from 'zod';

import { BaseTool } from '../../core/BaseTool';
import type { ToolExecutionContext } from '../../core/types';

// Input schema for the tool
const getUserPreferencesInputSchema = z.object({
  category: z
    .enum(['food', 'entertainment', 'activity', 'beverage', 'music', 'all'])
    .optional()
    .default('all'),
  personName: z.string().optional(),
  includeContext: z.boolean().default(true),
});

type GetUserPreferencesInput = z.infer<typeof getUserPreferencesInputSchema>;

// Output interfaces
interface PreferenceNode {
  id: string;
  type: string;
  name: string;
  strength: number;
  relationship: 'PREFERS' | 'DISLIKES';
  properties?: Record<string, any>;
}

interface GetUserPreferencesOutput {
  preferences: PreferenceNode[];
  dislikes: PreferenceNode[];
  totalPreferences: number;
  totalDislikes: number;
  personId: string;
  personName: string;
  debugInfo?: {
    userId: string;
    entityLookupMethod: string;
    queryInfo: string;
  };
}

/**
 * Tool to retrieve user preferences from the graph database
 * Uses the entity-relationship graph to fetch PREFERS and DISLIKES relationships
 * Supports querying for current user or family members (e.g., "my wife")
 */
@Injectable()
export class GetUserPreferencesTool extends BaseTool<GetUserPreferencesInput, GetUserPreferencesOutput> {
  readonly schema = {
    name: 'getUserPreferences',
    description:
      'Get user preferences including likes and dislikes for food, entertainment, activities, music, and beverages. ' +
      'Can query preferences for the current user or family members (e.g., "my wife", "John"). ' +
      'Returns detailed information about each preference including strength and rich context.',
    category: 'database',
    parameters: {
      type: 'object',
      properties: {
        category: {
          type: 'string',
          enum: ['food', 'entertainment', 'activity', 'beverage', 'music', 'all'],
          description: 'Filter preferences by category (default: all)',
          default: 'all',
        },
        personName: {
          type: 'string',
          description:
            'Name of the person to get preferences for (e.g., "my wife", "Sarah", "John Smith"). If not provided, returns current user preferences.',
        },
        includeContext: {
          type: 'boolean',
          description:
            'Include detailed properties about each preference (cuisine style, movie themes, etc.)',
          default: true,
        },
      },
      required: [],
    },
    examples: [
      {
        input: { category: 'food' },
        output: {
          preferences: [
            {
              id: 'uuid-123',
              type: 'cuisine',
              name: 'Italian',
              strength: 0.9,
              relationship: 'PREFERS',
              properties: {
                description: 'Mediterranean cuisine from Italy',
                signature_dishes: ['pasta', 'pizza', 'risotto'],
                regional_styles: ['Northern Italian', 'Southern Italian'],
              },
            },
          ],
          dislikes: [
            {
              id: 'uuid-456',
              type: 'food',
              name: 'Seafood',
              strength: 0.7,
              relationship: 'DISLIKES',
              properties: {
                category: 'protein',
                description: 'Fish and shellfish',
              },
            },
          ],
          totalPreferences: 1,
          totalDislikes: 1,
          personId: 'user-uuid',
          personName: 'Current User',
        },
        description: 'Get food preferences including likes and dislikes with rich context',
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
    let targetPersonId: string | null = null;
    let targetPersonName: string = 'Current User';
    const debugInfo: any = {
      userId: context.userId || 'none',
      entityLookupMethod: '',
      queryInfo: '',
    };

    if (!context.userId) {
      return {
        preferences: [],
        dislikes: [],
        totalPreferences: 0,
        totalDislikes: 0,
        personId: '',
        personName: 'No user context',
        debugInfo: {
          ...debugInfo,
          queryInfo: 'No userId in context',
        },
      };
    }

    if (input.personName) {
      debugInfo.entityLookupMethod = 'personName resolution';
      targetPersonId = await this.resolvePersonEntity(context.userId, input.personName);
      if (!targetPersonId) {
        debugInfo.queryInfo = `Person '${input.personName}' not found in graph relationships`;

        return {
          preferences: [],
          dislikes: [],
          totalPreferences: 0,
          totalDislikes: 0,
          personId: '',
          personName: input.personName + ' (not found)',
          debugInfo,
        };
      }

      targetPersonName = input.personName;
    } else {
      debugInfo.entityLookupMethod = 'current user entity_id';
      const userQuery = `
        SELECT entity_id, username
        FROM users
        WHERE id = $1
      `;
      const userResult = await this.dataSource.query(userQuery, [context.userId]);

      if (userResult.length === 0) {
        debugInfo.queryInfo = `User ${context.userId} not found in users table`;

        return {
          preferences: [],
          dislikes: [],
          totalPreferences: 0,
          totalDislikes: 0,
          personId: '',
          personName: 'User not found',
          debugInfo,
        };
      }

      if (!userResult[0].entity_id) {
        debugInfo.queryInfo = `User ${context.userId} has no entity_id set. User needs to be linked to a Person entity.`;

        return {
          preferences: [],
          dislikes: [],
          totalPreferences: 0,
          totalDislikes: 0,
          personId: '',
          personName: userResult[0].username || 'Current User',
          debugInfo,
        };
      }

      targetPersonId = userResult[0].entity_id;
      targetPersonName = userResult[0].username || 'Current User';
    }

    const categoryFilter = this.buildCategoryFilter(input.category);
    debugInfo.queryInfo = `Querying entity ${targetPersonId} with category filter: ${input.category}`;

    // Query for PREFERS relationships
    // NOTE: Filter by properties->>'type' because all preferences have entity_type='Concept'
    const prefersQuery = `
      SELECT 
        e.entity_id,
        e.properties->>'type' as type,
        e.name,
        e.properties,
        r.strength,
        'PREFERS' as relationship
      FROM relationships r
      JOIN entities e ON r.to_entity_id = e.entity_id
      WHERE r.from_entity_id = $1
        AND r.relationship_type = 'PREFERS'
        AND r.is_active = TRUE
        ${categoryFilter}
      ORDER BY r.strength DESC, e.name ASC
    `;

    // Query for DISLIKES relationships
    const dislikesQuery = `
      SELECT 
        e.entity_id,
        e.properties->>'type' as type,
        e.name,
        e.properties,
        r.strength,
        'DISLIKES' as relationship
      FROM relationships r
      JOIN entities e ON r.to_entity_id = e.entity_id
      WHERE r.from_entity_id = $1
        AND r.relationship_type = 'DISLIKES'
        AND r.is_active = TRUE
        ${categoryFilter}
      ORDER BY r.strength DESC, e.name ASC
    `;

    const [prefersResult, dislikesResult] = await Promise.all([
      this.dataSource.query(prefersQuery, [targetPersonId]),
      this.dataSource.query(dislikesQuery, [targetPersonId]),
    ]);

    const preferences: PreferenceNode[] = prefersResult.map((row: any) => ({
      id: row.entity_id,
      type: row.type || 'unknown',
      name: row.name,
      strength: parseFloat(row.strength),
      relationship: 'PREFERS' as const,
      properties: input.includeContext ? row.properties : undefined,
    }));

    const dislikes: PreferenceNode[] = dislikesResult.map((row: any) => ({
      id: row.entity_id,
      type: row.type || 'unknown',
      name: row.name,
      strength: parseFloat(row.strength),
      relationship: 'DISLIKES' as const,
      properties: input.includeContext ? row.properties : undefined,
    }));

    if (preferences.length === 0 && dislikes.length === 0) {
      debugInfo.queryInfo += ` | No PREFERS or DISLIKES relationships found for this entity.`;
    }

    return {
      preferences,
      dislikes,
      totalPreferences: preferences.length,
      totalDislikes: dislikes.length,
      personId: targetPersonId!,
      personName: targetPersonName,
      debugInfo,
    };
  }

  /**
   * Resolve a person name to an entity ID
   * Uses the graph relationships table to find family members
   */
  private async resolvePersonEntity(userId: string, personName: string): Promise<string | null> {
    const lowerName = personName.toLowerCase().trim();

    // First, get the user's entity_id
    const userQuery = `
      SELECT entity_id FROM users WHERE id = $1
    `;
    const userResult = await this.dataSource.query(userQuery, [userId]);
    if (userResult.length === 0 || !userResult[0].entity_id) {
      return null;
    }

    const userEntityId = userResult[0].entity_id;

    // Check for relationship descriptors and map to graph relationship types
    const relationshipPatterns: Record<string, { keywords: string[]; relTypes: string[] }> = {
      spouse: {
        keywords: ['wife', 'husband', 'spouse', 'partner'],
        relTypes: ['SPOUSE'],
      },
      parent: {
        keywords: ['mother', 'mom', 'father', 'dad'],
        relTypes: ['PARENT_OF'], // User is child, looking for parent
      },
      child: {
        keywords: ['son', 'daughter', 'child'],
        relTypes: ['CHILD_OF'], // User is parent, looking for child
      },
      sibling: {
        keywords: ['brother', 'sister', 'sibling'],
        relTypes: ['SIBLING_OF'],
      },
    };

    // Check if query matches a relationship descriptor
    for (const config of Object.values(relationshipPatterns)) {
      if (config.keywords.some((keyword) => lowerName.includes(keyword))) {
        // Search in relationships table for this type of relationship
        const relTypeList = config.relTypes.map((t) => `'${t}'`).join(',');

        const query = `
          SELECT e.entity_id, e.name
          FROM relationships r
          JOIN entities e ON e.entity_id = r.to_entity_id
          WHERE r.from_entity_id = $1
            AND r.relationship_type IN (${relTypeList})
            AND r.is_active = TRUE
            AND e.entity_type = 'Person'
          LIMIT 1
        `;

        const result = await this.dataSource.query(query, [userEntityId]);
        if (result.length > 0) {
          return result[0].entity_id ?? null;
        }
      }
    }

    // If no relationship descriptor matched, search by name in entities
    const nameQuery = `
      SELECT entity_id, name
      FROM entities
      WHERE entity_type = 'Person'
        AND (
          LOWER(name) = $1
          OR LOWER(name) LIKE $2
        )
      LIMIT 1
    `;
    const nameResult = await this.dataSource.query(nameQuery, [lowerName, `%${lowerName}%`]);
    if (nameResult.length > 0) {
      return nameResult[0].entity_id ?? null;
    }

    return null;
  }

  /**
   * Build SQL WHERE clause for category filtering
   * NOTE: Filters by properties->>'type' because all preferences have entity_type='Concept'
   */
  private buildCategoryFilter(category: string): string {
    if (category === 'all') {
      return '';
    }

    const categoryMap: Record<string, string[]> = {
      food: ['food', 'cuisine', 'dietary_preference', 'food_category'],
      entertainment: ['movie_genre', 'tv_genre', 'book_genre'],
      activity: ['activity', 'sport', 'hobby'],
      beverage: ['beverage', 'drink'],
      music: ['music_genre', 'music_style'],
    };

    const types = categoryMap[category] || [];
    if (types.length === 0) {
      return '';
    }

    const typeList = types.map((t) => `'${t}'`).join(', ');

    return `AND e.properties->>'type' IN (${typeList})`;
  }

  protected sanitizeInputForLogging(input: unknown): any {
    return input;
  }
}
