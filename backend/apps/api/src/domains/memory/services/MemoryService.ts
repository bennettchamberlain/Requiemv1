import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { LoggerService } from '@ci/common/services';
import { RequestContext } from '@ci/common/types';
import { GraphNodeEntity } from '@ci/domains/graph/entities/GraphNodeEntity';
import { RelationshipEntity } from '@ci/domains/graph/entities/RelationshipEntity';

import { Memory, MemoryLocation, MemoryResponse, MemorySearchParams } from '../types';

@Injectable()
export class MemoryService {
  private logger = new LoggerService(MemoryService.name);

  constructor(
    @InjectRepository(GraphNodeEntity)
    private entityRepo: Repository<GraphNodeEntity>,
    @InjectRepository(RelationshipEntity)
    private relationshipRepo: Repository<RelationshipEntity>,
  ) {}

  async findAll(context: RequestContext, params: MemorySearchParams): Promise<MemoryResponse> {
    this.logger.debug('Finding memories from graph', { userId: context.userId, params });

    const limit = params.limit || 50;
    const offset = params.offset || 0;

    try {
      // Build query for entities that represent memory objects
      let queryBuilder = this.entityRepo
        .createQueryBuilder('entity')
        .where('entity.is_active = true')
        .andWhere('entity.is_archived = false');

      // Default: Include Person, Location, Event, Contact, Content
      // Exclude: Object, Concept
      const defaultIncludedTypes = ['Person', 'Location', 'Event', 'Contact', 'Content', 'Place'];

      // If categories are specified, use those; otherwise use defaults
      if (params.categories && params.categories.length > 0) {
        queryBuilder = queryBuilder.andWhere('entity.entity_type IN (:...categories)', {
          categories: params.categories,
        });
      } else {
        queryBuilder = queryBuilder.andWhere('entity.entity_type IN (:...defaultTypes)', {
          defaultTypes: defaultIncludedTypes,
        });
      }

      // Apply filters
      if (params.query) {
        queryBuilder = queryBuilder.andWhere(
          '(entity.name ILIKE :query OR entity.description ILIKE :query OR entity.search_content ILIKE :query)',
          { query: `%${params.query}%` },
        );
      }

      // Apply date filtering based on created_at for now
      if (params.startDate) {
        queryBuilder = queryBuilder.andWhere('entity.created_at >= :startDate', {
          startDate: params.startDate,
        });
      }

      if (params.endDate) {
        queryBuilder = queryBuilder.andWhere('entity.created_at <= :endDate', {
          endDate: params.endDate,
        });
      }

      // Order by most recent
      queryBuilder = queryBuilder.orderBy('entity.created_at', 'DESC').limit(limit).offset(offset);

      const [entities, total] = await queryBuilder.getManyAndCount();

      this.logger.debug('Found entities', {
        entitiesCount: entities.length,
        total,
        userId: context.userId,
      });

      // Convert entities to Memory objects
      const memories = await Promise.all(entities.map((entity) => this.entityToMemory(entity)));

      // Filter by location if requested
      let filteredMemories = memories;
      if (params.hasLocation !== undefined) {
        filteredMemories = memories.filter((memory) =>
          params.hasLocation ? !!memory.location : !memory.location,
        );
      }

      const response = {
        data: filteredMemories,
        total,
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
    this.logger.debug('Finding memory by id', { id, userId: context.userId });

    const entity = await this.entityRepo.findOne({
      where: { entity_id: id, is_active: true },
    });

    if (!entity) {
      throw new NotFoundException(`Memory with id ${id} not found`);
    }

    return this.entityToMemory(entity);
  }

  private async entityToMemory(entity: GraphNodeEntity): Promise<Memory> {
    // Map entity types to memory types
    const memoryType = this.mapEntityTypeToMemoryType(entity.entity_type);

    // Get location if entity has location relationships
    const location = await this.getEntityLocation(entity);

    // Extract tags from properties or relationships
    const tags = await this.getEntityTags(entity);

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

  private async getEntityLocation(entity: GraphNodeEntity): Promise<MemoryLocation | undefined> {
    try {
      // Look for location relationships
      const locationRels = await this.relationshipRepo
        .createQueryBuilder('rel')
        .leftJoinAndSelect('rel.to_entity', 'location')
        .where('rel.from_entity_id = :entityId', { entityId: entity.entity_id })
        .andWhere('rel.relationship_type IN (:...types)', {
          types: ['LOCATED_AT', 'HAPPENED_AT', 'AT_LOCATION'],
        })
        .andWhere('rel.is_active = true')
        .andWhere('location.entity_type IN (:...locationTypes)', {
          locationTypes: ['Location', 'Place'],
        })
        .getMany();

      if (locationRels.length > 0) {
        const locationEntity = locationRels[0].to_entity;
        if (locationEntity?.properties) {
          const props = locationEntity.properties as Record<string, unknown>;

          // Try different coordinate field names
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

      // Check if entity itself has location properties
      if (entity.properties) {
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
      }
    } catch (error) {
      this.logger.error('Error getting entity location', { error, entityId: entity.entity_id });
    }

    return undefined;
  }

  private async getEntityTags(entity: GraphNodeEntity): Promise<string[]> {
    try {
      // Look for tag relationships
      const tagRels = await this.relationshipRepo
        .createQueryBuilder('rel')
        .leftJoinAndSelect('rel.to_entity', 'tag')
        .where('rel.from_entity_id = :entityId', { entityId: entity.entity_id })
        .andWhere('rel.relationship_type = :type', { type: 'TAGGED_WITH' })
        .andWhere('rel.is_active = true')
        .andWhere('tag.entity_type = :tagType', { tagType: 'Tag' })
        .getMany();

      const relationshipTags = tagRels
        .map((rel) => rel.to_entity?.name)
        .filter((name): name is string => !!name);

      // Also check properties for tags
      const propertyTags: string[] = [];
      if (entity.properties && typeof entity.properties === 'object') {
        const props = entity.properties as Record<string, unknown>;
        if (Array.isArray(props.tags)) {
          propertyTags.push(...props.tags.filter((tag): tag is string => typeof tag === 'string'));
        }
      }

      // Combine and deduplicate
      return [...new Set([...relationshipTags, ...propertyTags])];
    } catch (error) {
      this.logger.error('Error getting entity tags', { error, entityId: entity.entity_id });

      return [];
    }
  }

  private getEntityTimestamp(entity: GraphNodeEntity): Date {
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

  private getEntityUserId(entity: GraphNodeEntity): string {
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
      const entityCounts = await this.entityRepo
        .createQueryBuilder('entity')
        .select('entity.entity_type, COUNT(*) as count')
        .where('entity.is_active = true')
        .groupBy('entity.entity_type')
        .getRawMany();

      const relationshipCounts = await this.relationshipRepo
        .createQueryBuilder('rel')
        .select('rel.relationship_type, COUNT(*) as count')
        .where('rel.is_active = true')
        .groupBy('rel.relationship_type')
        .getRawMany();

      const totalEntities = await this.entityRepo.count({ where: { is_active: true } });
      const totalRelationships = await this.relationshipRepo.count({ where: { is_active: true } });

      return {
        counts: {
          totalEntities,
          totalRelationships,
          entitiesByType: entityCounts,
          relationshipsByType: relationshipCounts,
        },
      };
    } catch (error) {
      this.logger.error('Error getting debug info', { error, userId: context.userId });
      throw error;
    }
  }
}
