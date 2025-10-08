/* eslint-disable @typescript-eslint/no-explicit-any */
import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { z } from 'zod';

import { BaseTool } from '../../core/BaseTool';
import type { ToolExecutionContext } from '../../core/types';

// Input schema
const getFamilyMembersInputSchema = z.object({
  relationshipType: z
    .enum(['family', 'romantic_partner', 'friend', 'colleague', 'all'])
    .optional()
    .default('all'),
  includePreferences: z.boolean().default(false),
});

type GetFamilyMembersInput = z.infer<typeof getFamilyMembersInputSchema>;

// Output interfaces
interface FamilyMember {
  id: string;
  name: string;
  relationshipType: string;
  relationshipSubtype?: string;
  closenessScore: number;
  interactionFrequency: string;
  preferences?: {
    likes: string[];
    dislikes: string[];
  };
}

interface GetFamilyMembersOutput {
  familyMembers: FamilyMember[];
  totalCount: number;
  userId: string;
}

/**
 * Tool to retrieve family members and social connections
 * Traverses the graph relationships table to find connected Person entities
 * Supports filtering by relationship type and optional preference loading
 */
@Injectable()
export class GetFamilyMembersTool extends BaseTool<GetFamilyMembersInput, GetFamilyMembersOutput> {
  readonly schema = {
    name: 'getFamilyMembers',
    description:
      'Get information about family members, friends, and social connections. ' +
      'Returns relationship details including closeness scores and interaction frequency. ' +
      'Can optionally include their preferences (likes/dislikes) for planning activities.',
    category: 'database',
    parameters: {
      type: 'object',
      properties: {
        relationshipType: {
          type: 'string',
          enum: ['family', 'romantic_partner', 'friend', 'colleague', 'all'],
          description: 'Filter by relationship type (default: all)',
          default: 'all',
        },
        includePreferences: {
          type: 'boolean',
          description: 'Whether to include likes and dislikes for each person',
          default: false,
        },
      },
      required: [],
    },
    examples: [
      {
        input: { relationshipType: 'family', includePreferences: true },
        output: {
          familyMembers: [
            {
              id: 'uuid',
              name: 'Sarah Smith',
              relationshipType: 'family',
              relationshipSubtype: 'spouse',
              closenessScore: 1.0,
              interactionFrequency: 'daily',
              preferences: {
                likes: ['Italian cuisine', 'Hiking', 'Jazz music'],
                dislikes: ['Horror movies', 'Seafood'],
              },
            },
          ],
          totalCount: 1,
          userId: 'user-uuid',
        },
        description: 'Get family members with their preferences',
      },
    ],
  };

  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {
    super();
  }

  protected validateInput(input: unknown): GetFamilyMembersInput {
    return getFamilyMembersInputSchema.parse(input);
  }

  protected async executeInternal(
    context: ToolExecutionContext,
    input: GetFamilyMembersInput,
  ): Promise<GetFamilyMembersOutput> {
    if (!context.userId) {
      throw new Error('User context is required to load family members');
    }

    const ownerUserId = context.userId;

    const userProfile = await this.loadUserGraphProfile(ownerUserId);

    if (!userProfile?.entityId) {
      return {
        familyMembers: [],
        totalCount: 0,
        userId: context.userId,
      };
    }

    const relationshipTypes = this.mapRelationshipFilter(input.relationshipType);

    const query = `
      SELECT
        CASE WHEN r.from_entity_id = $1 THEN r.to_entity_id ELSE r.from_entity_id END AS person_entity_id,
        e.name AS person_name,
        r.relationship_type,
        r.properties,
        r.strength,
        CASE WHEN r.from_entity_id = $1 THEN 'outbound' ELSE 'inbound' END AS direction
      FROM relationships r
      JOIN entities e ON e.entity_id = CASE WHEN r.from_entity_id = $1 THEN r.to_entity_id ELSE r.from_entity_id END
      WHERE (r.from_entity_id = $1 OR r.to_entity_id = $1)
        AND r.is_active = TRUE
        AND r.owner_user_id = $2
        AND e.is_active = TRUE
        AND e.entity_type = 'Person'
        AND e.owner_user_id = $2
        ${relationshipTypes.length ? 'AND r.relationship_type = ANY($3::text[])' : ''}
      ORDER BY r.strength DESC NULLS LAST, e.name ASC
    `;

    const params: unknown[] = relationshipTypes.length
      ? [userProfile.entityId, ownerUserId, relationshipTypes]
      : [userProfile.entityId, ownerUserId];
    const result = await this.dataSource.query(query, params);

    const memberMap = new Map<string, FamilyMember & { _strength: number }>();

    for (const row of result) {
      const classification = this.classifyRelationship(
        row.relationship_type,
        row.direction as 'outbound' | 'inbound',
      );
      if (!classification) {
        continue;
      }

      const rawStrength = row.strength != null ? Number(row.strength) : Number.NaN;
      const closeness = Number.isFinite(rawStrength) ? rawStrength : 0.5;
      const interactionFrequency =
        row.properties?.interaction_frequency ?? row.properties?.frequency ?? 'unknown';
      const relationshipSubtype =
        classification.subtype ??
        row.properties?.relationship_subtype ??
        row.properties?.relationship ??
        undefined;

      const existing = memberMap.get(row.person_entity_id);

      if (!existing) {
        memberMap.set(row.person_entity_id, {
          id: row.person_entity_id,
          name: row.person_name,
          relationshipType: classification.type,
          relationshipSubtype,
          closenessScore: closeness,
          interactionFrequency,
          _strength: closeness,
        });
      } else {
        if (!existing.relationshipSubtype && relationshipSubtype) {
          existing.relationshipSubtype = relationshipSubtype;
        }

        if (classification.type !== existing.relationshipType && input.relationshipType === 'all') {
          existing.relationshipType = classification.type;
        }

        if (closeness > existing._strength) {
          existing.closenessScore = closeness;
          existing._strength = closeness;
        }
      }
    }

    const familyMembers: FamilyMember[] = Array.from(memberMap.values()).map(
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      ({ _strength, ...member }) => member,
    );

    if (input.includePreferences) {
      await Promise.all(
        familyMembers.map(async (member) => {
          member.preferences = await this.loadPersonPreferences(member.id, ownerUserId);
        }),
      );
    }

    return {
      familyMembers,
      totalCount: familyMembers.length,
      userId: ownerUserId,
    };
  }

  /**
   * Load preferences (PREFERS and DISLIKES) for a person entity
   */
  private async loadUserGraphProfile(
    userId: string,
  ): Promise<{ entityId: string | null; username: string | null } | null> {
    const query = `
      SELECT entity_id, COALESCE(username, name) AS display_name
      FROM users
      WHERE id = $1
    `;

    const result = await this.dataSource.query(query, [userId]);

    if (result.length === 0) {
      return null;
    }

    let entityId: string | null = result[0].entity_id ?? null;

    if (!entityId) {
      const linkedQuery = `
        SELECT entity_id
        FROM entities
        WHERE linked_table = 'users'
          AND linked_id = $1
          AND is_active = TRUE
          AND owner_user_id = $2
        LIMIT 1
      `;

      const linkedResult = await this.dataSource.query(linkedQuery, [userId, userId]);
      if (linkedResult.length > 0) {
        entityId = linkedResult[0].entity_id;

        await this.dataSource.query(`UPDATE users SET entity_id = $2 WHERE id = $1`, [userId, entityId]);
      }
    }

    return {
      entityId,
      username: result[0].display_name ?? null,
    };
  }

  private mapRelationshipFilter(filter: string): string[] {
    const mapping: Record<string, string[]> = {
      romantic_partner: ['SPOUSE', 'PARTNER', 'ROMANTIC_PARTNER'],
      family: ['SPOUSE', 'PARENT_OF', 'CHILD_OF', 'SIBLING_OF', 'FAMILY_MEMBER'],
      friend: ['FRIEND', 'KNOWS'],
      colleague: ['WORKS_WITH', 'COLLEAGUE'],
    };

    if (!filter || filter === 'all') {
      return [];
    }

    return mapping[filter] ?? [];
  }

  private classifyRelationship(
    graphRelationshipType: string,
    direction: 'outbound' | 'inbound',
  ): { type: string; subtype?: string } | null {
    switch (graphRelationshipType) {
      case 'SPOUSE':
      case 'PARTNER':
      case 'ROMANTIC_PARTNER':
        return { type: 'romantic_partner', subtype: 'spouse' };
      case 'PARENT_OF':
        return { type: 'family', subtype: direction === 'outbound' ? 'child' : 'parent' };
      case 'CHILD_OF':
        return { type: 'family', subtype: direction === 'outbound' ? 'parent' : 'child' };
      case 'SIBLING_OF':
        return { type: 'family', subtype: 'sibling' };
      case 'FAMILY_MEMBER':
        return { type: 'family' };
      case 'FRIEND':
      case 'KNOWS':
        return { type: 'friend' };
      case 'WORKS_WITH':
      case 'COLLEAGUE':
        return { type: 'colleague' };
      default: {
        if (graphRelationshipType?.startsWith('FAMILY')) {
          return { type: 'family' };
        }

        if (graphRelationshipType?.includes('FRIEND')) {
          return { type: 'friend' };
        }

        if (graphRelationshipType?.includes('WORK')) {
          return { type: 'colleague' };
        }

        return null;
      }
    }
  }

  private async loadPersonPreferences(
    personEntityId: string,
    ownerUserId: string,
  ): Promise<{ likes: string[]; dislikes: string[] }> {
    // Query for PREFERS relationships
    const prefersQuery = `
      SELECT e.name
      FROM relationships r
      JOIN entities e ON r.to_entity_id = e.entity_id
      WHERE r.from_entity_id = $1
        AND r.relationship_type = 'PREFERS'
        AND r.is_active = TRUE
        AND r.owner_user_id = $2
        AND e.owner_user_id = $2
        AND r.strength >= 0.5
      ORDER BY r.strength DESC
      LIMIT 10
    `;

    // Query for DISLIKES relationships
    const dislikesQuery = `
      SELECT e.name
      FROM relationships r
      JOIN entities e ON r.to_entity_id = e.entity_id
      WHERE r.from_entity_id = $1
        AND r.relationship_type = 'DISLIKES'
        AND r.is_active = TRUE
        AND r.owner_user_id = $2
        AND e.owner_user_id = $2
        AND r.strength >= 0.5
      ORDER BY r.strength DESC
      LIMIT 10
    `;

    const [likesResult, dislikesResult] = await Promise.all([
      this.dataSource.query(prefersQuery, [personEntityId, ownerUserId]),
      this.dataSource.query(dislikesQuery, [personEntityId, ownerUserId]),
    ]);

    return {
      likes: likesResult.map((row: any) => row.name),
      dislikes: dislikesResult.map((row: any) => row.name),
    };
  }

  protected sanitizeInputForLogging(input: unknown): any {
    return input;
  }
}
