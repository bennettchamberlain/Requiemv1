/* eslint-disable @typescript-eslint/no-explicit-any */
import { Injectable } from '@nestjs/common';
import { z } from 'zod';

import { GraphNodeEntity, GraphQueryService } from '@ci/domains/graph';

import { BaseTool } from '../../core/BaseTool';
import type { ToolExecutionContext } from '../../core/types';

const FAMILY_RELATIONSHIP_TYPES = [
  'SPOUSE',
  'PARTNER',
  'ROMANTIC_PARTNER',
  'PARENT_OF',
  'CHILD_OF',
  'SIBLING_OF',
  'FAMILY_MEMBER',
];

// Input schema
const getFamilyMembersInputSchema = z.object({
  relationshipType: z.enum(['family', 'romantic_partner', 'all']).optional().default('all'),
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
          enum: ['family', 'romantic_partner', 'all'],
          description: 'Filter by relationship subtype (default: all family relationships)',
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

  constructor(private readonly graphQuery: GraphQueryService) {
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
    const userProfile = await this.resolveUserProfile(ownerUserId);

    if (!userProfile?.entityId) {
      return {
        familyMembers: [],
        totalCount: 0,
        userId: ownerUserId,
      };
    }

    const relationshipTypes = this.mapRelationshipFilter(input.relationshipType);
    const effectiveRelationshipTypes =
      relationshipTypes.length > 0 ? relationshipTypes : FAMILY_RELATIONSHIP_TYPES;

    const relationships = await this.graphQuery.getRelationships(ownerUserId, {
      entityIds: [userProfile.entityId],
      relationshipTypes: effectiveRelationshipTypes,
      direction: 'both',
    });

    if (relationships.length === 0) {
      return {
        familyMembers: [],
        totalCount: 0,
        userId: ownerUserId,
      };
    }

    const otherEntityIds = Array.from(
      new Set(
        relationships.map((rel) =>
          rel.from_entity_id === userProfile.entityId ? rel.to_entity_id : rel.from_entity_id,
        ),
      ),
    );

    const nodes = await this.graphQuery.getNodesByIds(ownerUserId, otherEntityIds);
    const nodeMap = new Map<string, GraphNodeEntity>(nodes.map((node) => [node.entity_id, node]));

    const memberMap = new Map<
      string,
      FamilyMember & {
        _strength: number;
      }
    >();

    for (const rel of relationships) {
      const otherId = rel.from_entity_id === userProfile.entityId ? rel.to_entity_id : rel.from_entity_id;
      const otherNode = nodeMap.get(otherId);
      if (!otherNode || otherNode.entity_type !== 'Person') {
        continue;
      }

      const direction = rel.from_entity_id === userProfile.entityId ? 'outbound' : 'inbound';
      const classification = this.classifyRelationship(rel.relationship_type, direction);
      if (!classification) {
        continue;
      }

      const closeness = typeof rel.strength === 'number' ? rel.strength : 0.5;
      const interactionFrequency =
        (rel.properties?.interaction_frequency as string | undefined) ??
        (rel.properties?.frequency as string | undefined) ??
        'unknown';

      const relationshipSubtype =
        classification.subtype ??
        (rel.properties?.relationship_subtype as string | undefined) ??
        (rel.properties?.relationship as string | undefined) ??
        undefined;

      const existing = memberMap.get(otherId);

      if (!existing) {
        memberMap.set(otherId, {
          id: otherId,
          name: otherNode.name ?? this.extractDisplayName(otherNode),
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

  private async resolveUserProfile(
    ownerUserId: string,
  ): Promise<{ entityId: string | null; username: string | null }> {
    const node = await this.graphQuery.getUserEntity(ownerUserId);
    if (!node) {
      return { entityId: null, username: null };
    }

    return {
      entityId: node.entity_id,
      username: node.name ?? null,
    };
  }

  private mapRelationshipFilter(filter: string): string[] {
    const mapping: Record<string, string[]> = {
      romantic_partner: ['SPOUSE', 'PARTNER', 'ROMANTIC_PARTNER'],
      family: FAMILY_RELATIONSHIP_TYPES,
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
      default: {
        if (graphRelationshipType?.startsWith('FAMILY')) {
          return { type: 'family' };
        }

        return null;
      }
    }
  }

  private async loadPersonPreferences(
    personEntityId: string,
    ownerUserId: string,
  ): Promise<{ likes: string[]; dislikes: string[] }> {
    const relationships = await this.graphQuery.getRelationships(ownerUserId, {
      entityIds: [personEntityId],
      relationshipTypes: ['PREFERS', 'DISLIKES'],
      direction: 'outbound',
    });

    if (relationships.length === 0) {
      return { likes: [], dislikes: [] };
    }

    const filtered = relationships.filter((rel) => (rel.strength ?? 0) >= 0.5);
    filtered.sort((a, b) => (b.strength ?? 0) - (a.strength ?? 0));

    const likes = filtered.filter((rel) => rel.relationship_type === 'PREFERS').slice(0, 10);
    const dislikes = filtered.filter((rel) => rel.relationship_type === 'DISLIKES').slice(0, 10);

    const conceptIds = Array.from(new Set([...likes, ...dislikes].map((rel) => rel.to_entity_id)));
    const conceptNodes = await this.graphQuery.getNodesByIds(ownerUserId, conceptIds);
    const conceptMap = new Map<string, GraphNodeEntity>(conceptNodes.map((node) => [node.entity_id, node]));

    return {
      likes: likes
        .map((rel) => conceptMap.get(rel.to_entity_id))
        .filter((node): node is GraphNodeEntity => !!node)
        .map((node) => node.name ?? this.extractDisplayName(node)),
      dislikes: dislikes
        .map((rel) => conceptMap.get(rel.to_entity_id))
        .filter((node): node is GraphNodeEntity => !!node)
        .map((node) => node.name ?? this.extractDisplayName(node)),
    };
  }

  private extractDisplayName(node: GraphNodeEntity): string {
    const first = node.properties?.first_name;
    const last = node.properties?.last_name;

    if (typeof first === 'string' || typeof last === 'string') {
      return [first, last]
        .filter((value) => typeof value === 'string')
        .join(' ')
        .trim();
    }

    return node.name ?? 'Unknown';
  }

  protected sanitizeInputForLogging(input: unknown): any {
    return input;
  }
}
