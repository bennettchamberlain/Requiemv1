import { Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';

import { LoggerService } from '@ci/common/services';
import { RequestContext } from '@ci/common/types';
import { GraphQueryService } from '@ci/domains/graph';

import { Memory, MemoryLocation, MemoryResponse, MemorySearchParams } from '../types';

type GraphNodeLike = {
  entity_id: string;
  entity_type: string;
  name: string | null;
  description: string | null;
  properties?: Record<string, unknown> | null;
  linked_table?: string | null;
  linked_id?: string | null;
  created_at: Date;
  updated_at: Date;
  owner_user_id?: string | null;
};

@Injectable()
export class MemoryService {
  private logger = new LoggerService(MemoryService.name);

  constructor(private readonly graphQuery: GraphQueryService) {}

  async findAll(context: RequestContext, params: MemorySearchParams): Promise<MemoryResponse> {
    const userId = this.requireUserId(context);

    this.logger.debug('Finding memories from graph', { userId, params });

    const limit = params.limit || 50;
    const offset = params.offset || 0;

    try {
      // Build query for entities that represent memory objects
      const defaultIncludedTypes = ['Person', 'Location', 'Event', 'Contact', 'Content', 'Place'];
      const allowedTypes =
        params.categories && params.categories.length > 0 ? params.categories : defaultIncludedTypes;

      const nodes = await this.graphQuery.getNodes(userId, {
        limit,
        offset,
        nameContains: params.query,
      });

      const filteredNodes = nodes.filter((node) => allowedTypes.includes(node.entity_type));

      const memories = await Promise.all(filteredNodes.map((entity) => this.entityToMemory(entity, userId)));

      const filteredMemories =
        params.hasLocation === undefined
          ? memories
          : memories.filter((memory) => (params.hasLocation ? !!memory.location : !memory.location));

      const response = {
        data: filteredMemories,
        total: filteredMemories.length,
        limit,
        offset,
      };

      this.logger.debug('Returning memory response', {
        dataLength: response.data.length,
        total: response.total,
        memoriesWithLocation: response.data.filter((m) => m.location).length,
      });

      return response;
    } catch (error) {
      this.logger.error('Error in findAll', { error, userId: context.userId });
      throw error;
    }
  }

  async findOne(context: RequestContext, id: string): Promise<Memory> {
    const userId = this.requireUserId(context);

    this.logger.debug('Finding memory by id', { id, userId });

    const entity = await this.graphQuery.getNode(userId, id);

    if (!entity) {
      throw new NotFoundException(`Memory with id ${id} not found`);
    }

    return this.entityToMemory(entity, userId);
  }

  private requireUserId(context: RequestContext): string {
    if (!context.userId) {
      throw new UnauthorizedException('MemoryService requires an authenticated user context');
    }

    return context.userId;
  }

  private async entityToMemory(entity: GraphNodeLike, ownerId: string): Promise<Memory> {
    // Map entity types to memory types
    const memoryType = this.mapEntityTypeToMemoryType(entity.entity_type);

    // Get location if entity has location relationships
    let location = this.extractLocationFromProperties(entity);
    if (!location) {
      location = await this.getEntityLocation(entity.entity_id, ownerId);
    }

    // Extract tags from properties or relationships
    const tags = await this.getEntityTags(entity.entity_id, ownerId, entity.properties ?? null);

    // Get timestamp - prefer event time from properties, fallback to created_at
    const timestamp = this.getEntityTimestamp(entity);

    // Extract user ID from properties or linked data
    const userId = this.getEntityUserId(entity);

    const memory: Memory = {
      id: entity.entity_id,
      type: memoryType,
      title: entity.name || 'Untitled',
      description: entity.description,
      timestamp,
      category: entity.entity_type,
      location,
      tags,
      userId,
      metadata: {
        entityType: entity.entity_type,
        linkedTable: entity.linked_table,
        linkedId: entity.linked_id,
        properties: entity.properties,
      },
    };

    return memory;
  }

  private mapEntityTypeToMemoryType(entityType: string): Memory['type'] {
    const typeMap: Record<string, Memory['type']> = {
      Person: 'person',
      Event: 'event',
      Content: 'content',
      Thing: 'thing',
      Contact: 'contact',
      Place: 'other',
      Location: 'other',
      Concept: 'other',
      Object: 'thing',
    };

    return typeMap[entityType] || 'other';
  }

  private async getEntityLocation(entityId: string, ownerId: string): Promise<MemoryLocation | undefined> {
    try {
      const relationships = await this.graphQuery.getRelationships(ownerId, {
        entityIds: [entityId],
        relationshipTypes: ['LOCATED_AT', 'HAPPENED_AT', 'AT_LOCATION'],
        direction: 'outbound',
      });

      if (relationships.length > 0) {
        const targetIds = relationships.map((rel) => rel.to_entity_id);
        const [locationEntity] = await this.graphQuery.getNodesByIds(ownerId, targetIds);

        if (locationEntity?.properties) {
          const props = locationEntity.properties as Record<string, unknown>;
          const lat = props.lat || props.latitude;
          const lng = props.lng || props.lon || props.longitude;

          if (lat && lng && typeof lat === 'number' && typeof lng === 'number') {
            return {
              id: locationEntity.entity_id,
              name: locationEntity.name,
              lat,
              lng,
              address: props.address as string | undefined,
            };
          }
        }
      }
    } catch (error) {
      this.logger.error('Error getting entity location', { error, entityId });
    }

    return undefined;
  }

  private async getEntityTags(
    entityId: string,
    ownerId: string,
    properties: Record<string, unknown> | null | undefined,
  ): Promise<string[]> {
    try {
      const tagRelationships = await this.graphQuery.getRelationships(ownerId, {
        entityIds: [entityId],
        relationshipTypes: ['TAGGED_WITH'],
        direction: 'outbound',
      });

      let relationshipTags: string[] = [];
      if (tagRelationships.length > 0) {
        const tagIds = tagRelationships.map((rel) => rel.to_entity_id);
        const tagNodes = await this.graphQuery.getNodesByIds(ownerId, tagIds);
        relationshipTags = tagNodes
          .map((node) => node.name)
          .filter((name): name is string => typeof name === 'string' && name.trim().length > 0);
      }

      // Also check properties for tags
      const propertyTags: string[] = [];
      if (properties && typeof properties === 'object') {
        const props = properties;
        if (Array.isArray(props.tags)) {
          propertyTags.push(...props.tags.filter((tag): tag is string => typeof tag === 'string'));
        }
      }

      // Combine and deduplicate
      return [...new Set([...relationshipTags, ...propertyTags])];
    } catch (error) {
      this.logger.error('Error getting entity tags', { error, entityId });

      return [];
    }
  }

  private getEntityTimestamp(entity: GraphNodeLike): Date {
    // Try to get timestamp from properties first
    if (entity.properties && typeof entity.properties === 'object') {
      const props = entity.properties as Record<string, unknown>;

      // Try different timestamp field names
      const timeFields = ['start_time', 'timestamp', 'date', 'created_date'];
      for (const field of timeFields) {
        const timeValue = props[field];
        if (timeValue && typeof timeValue === 'string') {
          const parsed = new Date(timeValue);
          if (!isNaN(parsed.getTime())) {
            return parsed;
          }
        }
      }
    }

    // Fallback to entity created_at
    return entity.created_at;
  }

  private getEntityUserId(entity: GraphNodeLike): string {
    // Try to get user ID from properties
    if (entity.properties && typeof entity.properties === 'object') {
      const props = entity.properties as Record<string, unknown>;
      const userId = props.user_id || props.userId;
      if (userId && typeof userId === 'string') {
        return userId;
      }
    }

    // For now, return empty string if no user ID found
    // In a real implementation, you might want to link entities to users via relationships
    return '';
  }

  // Debug and utility methods (maintaining compatibility)
  async getDebugInfo(context: RequestContext) {
    try {
      if (!context.userId) {
        return {
          counts: {
            totalEntities: 0,
            totalRelationships: 0,
            entitiesByType: [],
            relationshipsByType: [],
          },
        };
      }

      const nodes = await this.graphQuery.getNodes(context.userId, { limit: 1000 });
      const nodeCounts = nodes.reduce<Record<string, number>>((acc, node) => {
        acc[node.entity_type] = (acc[node.entity_type] ?? 0) + 1;

        return acc;
      }, {});

      const relationships = await this.graphQuery.getRelationships(context.userId, {});
      const relationshipCounts = relationships.reduce<Record<string, number>>((acc, rel) => {
        acc[rel.relationship_type] = (acc[rel.relationship_type] ?? 0) + 1;

        return acc;
      }, {});

      return {
        counts: {
          totalEntities: nodes.length,
          totalRelationships: relationships.length,
          entitiesByType: Object.entries(nodeCounts).map(([type, count]) => ({
            entity_type: type,
            count,
          })),
          relationshipsByType: Object.entries(relationshipCounts).map(([type, count]) => ({
            relationship_type: type,
            count,
          })),
        },
      };
    } catch (error) {
      this.logger.error('Error getting debug info', { error, userId: context.userId });
      throw error;
    }
  }

  private extractLocationFromProperties(entity: GraphNodeLike): MemoryLocation | undefined {
    if (!entity.properties || typeof entity.properties !== 'object') {
      return undefined;
    }

    const props = entity.properties as Record<string, unknown>;
    const lat = props.lat || props.latitude;
    const lng = props.lng || props.lon || props.longitude;

    if (lat && lng && typeof lat === 'number' && typeof lng === 'number') {
      return {
        id: `loc-${entity.entity_id}`,
        name: entity.name,
        lat,
        lng,
        address: props.address as string | undefined,
      };
    }

    return undefined;
  }
}
