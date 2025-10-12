import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { LoggerService } from '@ci/common/services';
import { RequestContext } from '@ci/common/types';

import { CommunicationEntity } from '../entities/CommunicationEntity';
import { ContentEntity } from '../entities/ContentEntity';
import { EventEntity } from '../entities/EventEntity';
import { GraphNodeEntity } from '../entities/GraphNodeEntity';
import { RelationshipEntity } from '../entities/RelationshipEntity';
import { Memory, MemoryLocation, MemoryResponse, MemorySearchParams } from '../types';

@Injectable()
export class MemoryService {
  private logger = new LoggerService(MemoryService.name);

  constructor(
    @InjectRepository(GraphNodeEntity)
    private entityRepo: Repository<GraphNodeEntity>,
    @InjectRepository(RelationshipEntity)
    private relationshipRepo: Repository<RelationshipEntity>,
    @InjectRepository(EventEntity)
    private eventRepo: Repository<EventEntity>,
    @InjectRepository(ContentEntity)
    private contentRepo: Repository<ContentEntity>,
    @InjectRepository(CommunicationEntity)
    private communicationRepo: Repository<CommunicationEntity>,
  ) {}

  async findAll(context: RequestContext, params: MemorySearchParams): Promise<MemoryResponse> {
    this.logger.debug('Finding memories from ALL tables', { userId: context.userId, params });

    const limit = params.limit || 100;
    const offset = params.offset || 0;

    if (!context.userId) {
      this.logger.warn('No userId in context');

      return { data: [], total: 0, limit, offset };
    }

    try {
      // Fetch from all data sources in parallel
      const [entitiesData, eventsData, contentData, communicationsData] = await Promise.all([
        this.fetchFromEntities(context.userId, params),
        this.fetchFromEvents(context.userId, params),
        this.fetchFromContent(context.userId, params),
        this.fetchFromCommunications(context.userId, params),
      ]);

      // Combine all memories
      const allMemories = [
        ...entitiesData.memories,
        ...eventsData.memories,
        ...contentData.memories,
        ...communicationsData.memories,
      ];

      this.logger.debug('Memory type breakdown', {
        entities: entitiesData.memories.map((m) => ({ type: m.type, category: m.category })),
        events: eventsData.memories.map((m) => ({ type: m.type, category: m.category })),
        content: contentData.memories.map((m) => ({ type: m.type, category: m.category })),
        communications: communicationsData.memories.map((m) => ({ type: m.type, category: m.category })),
      });

      // Sort by timestamp descending
      allMemories.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

      // Apply search filter if provided
      let filteredMemories = allMemories;
      if (params.query) {
        const searchQuery = params.query.toLowerCase();
        filteredMemories = allMemories.filter(
          (memory) =>
            memory.title.toLowerCase().includes(searchQuery) ||
            memory.description?.toLowerCase().includes(searchQuery) ||
            memory.tags.some((tag) => tag.toLowerCase().includes(searchQuery)),
        );
      }

      // Apply location filter if requested
      if (params.hasLocation !== undefined) {
        filteredMemories = filteredMemories.filter((memory) =>
          params.hasLocation ? !!memory.location : !memory.location,
        );
      }

      // Apply pagination
      const paginatedMemories = filteredMemories.slice(offset, offset + limit);
      const total = filteredMemories.length;

      const response = {
        data: paginatedMemories,
        total,
        limit,
        offset,
      };

      this.logger.debug('Returning aggregated memory response', {
        dataLength: response.data.length,
        total: response.total,
        sources: {
          entities: entitiesData.count,
          events: eventsData.count,
          content: contentData.count,
          communications: communicationsData.count,
        },
        memoriesWithLocation: response.data.filter((m) => m.location).length,
      });

      return response;
    } catch (error) {
      this.logger.error('Error in findAll', { error, userId: context.userId });
      throw error;
    }
  }

  // Fetch memories from entities table
  private async fetchFromEntities(
    userId: string,
    params: MemorySearchParams,
  ): Promise<{ memories: Memory[]; count: number }> {
    try {
      let queryBuilder = this.entityRepo
        .createQueryBuilder('entity')
        .where('entity.is_active = true')
        .andWhere('entity.is_archived = false')
        .andWhere('entity.owner_user_id = :userId', { userId });

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

      queryBuilder = queryBuilder.orderBy('entity.created_at', 'DESC').limit(200);

      const entities = await queryBuilder.getMany();
      this.logger.log('Fetched entities', {
        count: entities.length,
        userId,
        sampleEntities: entities
          .slice(0, 3)
          .map((e) => ({ id: e.entity_id, type: e.entity_type, name: e.name })),
      });
      const memories = await Promise.all(entities.map((entity) => this.entityToMemory(entity)));
      this.logger.log('Converted entities to memories', { count: memories.length });

      return { memories, count: memories.length };
    } catch (error) {
      this.logger.error('Error fetching from entities', { error, userId });

      return { memories: [], count: 0 };
    }
  }

  // Fetch memories from events table
  private async fetchFromEvents(
    userId: string,
    params: MemorySearchParams,
  ): Promise<{ memories: Memory[]; count: number }> {
    try {
      let queryBuilder = this.eventRepo
        .createQueryBuilder('event')
        .leftJoinAndSelect('event.user', 'user')
        .where('user.id = :userId', { userId });

      if (params.startDate) {
        queryBuilder = queryBuilder.andWhere('event.start_time >= :startDate', {
          startDate: params.startDate,
        });
      }

      if (params.endDate) {
        queryBuilder = queryBuilder.andWhere('event.start_time <= :endDate', {
          endDate: params.endDate,
        });
      }

      queryBuilder = queryBuilder.orderBy('event.start_time', 'DESC').limit(200);

      const events = await queryBuilder.getMany();
      this.logger.debug('Fetched events', { count: events.length, userId });
      const memories = events.map((event) => this.eventToMemory(event));

      return { memories, count: memories.length };
    } catch (error) {
      this.logger.error('Error fetching from events', { error, userId });

      return { memories: [], count: 0 };
    }
  }

  // Fetch memories from content table
  private async fetchFromContent(
    userId: string,
    params: MemorySearchParams,
  ): Promise<{ memories: Memory[]; count: number }> {
    try {
      let queryBuilder = this.contentRepo
        .createQueryBuilder('content')
        .leftJoinAndSelect('content.user', 'user')
        .where('user.id = :userId', { userId });

      if (params.startDate) {
        queryBuilder = queryBuilder.andWhere('content.created_at >= :startDate', {
          startDate: params.startDate,
        });
      }

      if (params.endDate) {
        queryBuilder = queryBuilder.andWhere('content.created_at <= :endDate', {
          endDate: params.endDate,
        });
      }

      queryBuilder = queryBuilder.orderBy('content.created_at', 'DESC').limit(200);

      const contentItems = await queryBuilder.getMany();
      this.logger.debug('Fetched content', { count: contentItems.length, userId });
      const memories = contentItems.map((content) => this.contentToMemory(content));

      return { memories, count: memories.length };
    } catch (error) {
      this.logger.error('Error fetching from content', { error, userId });

      return { memories: [], count: 0 };
    }
  }

  // Fetch memories from communications table
  private async fetchFromCommunications(
    userId: string,
    params: MemorySearchParams,
  ): Promise<{ memories: Memory[]; count: number }> {
    try {
      let queryBuilder = this.communicationRepo
        .createQueryBuilder('comm')
        .where('comm.user_id = :userId', { userId });

      if (params.startDate) {
        queryBuilder = queryBuilder.andWhere('comm.time >= :startDate', {
          startDate: params.startDate,
        });
      }

      if (params.endDate) {
        queryBuilder = queryBuilder.andWhere('comm.time <= :endDate', {
          endDate: params.endDate,
        });
      }

      queryBuilder = queryBuilder.orderBy('comm.time', 'DESC').limit(200);

      const communications = await queryBuilder.getMany();
      this.logger.log('Fetched communications', {
        count: communications.length,
        userId,
        sampleComms: communications
          .slice(0, 3)
          .map((c) => ({ type: c.communication_type, subject: c.subject, time: c.time })),
      });
      const memories = communications.map((comm) => this.communicationToMemory(comm));
      this.logger.log('Converted communications to memories', { count: memories.length });

      return { memories, count: memories.length };
    } catch (error) {
      this.logger.error('Error fetching from communications', { error, userId });

      return { memories: [], count: 0 };
    }
  }

  // Convert EventEntity to Memory
  private eventToMemory(event: EventEntity): Memory {
    return {
      id: event.id,
      type: 'event',
      title: event.title || 'Untitled Event',
      description: event.description,
      timestamp: event.start_time,
      category: event.category || 'Event',
      location: event.location_name
        ? {
            id: event.location_entity_id || `loc-${event.id}`,
            name: event.location_name,
            lat: 0, // TODO: Extract from location_coordinates if available
            lng: 0,
          }
        : undefined,
      tags: event.tags || [],
      userId: event.user?.id || '',
      metadata: {
        eventType: event.event_type ?? undefined,
        category: event.category ?? undefined,
        source: event.source_system ?? undefined,
        ...event.metadata,
      },
    };
  }

  // Convert ContentEntity to Memory
  private contentToMemory(content: ContentEntity): Memory {
    return {
      id: content.id,
      type: 'content',
      title: content.title || 'Untitled File',
      description: content.text,
      timestamp: content.created_at,
      category: 'File',
      tags: [],
      userId: content.user?.id || '',
      metadata: {
        contentType: content.type,
        mimetype: content.mimetype ?? undefined,
        url: content.url ?? undefined,
        externalId: content.external_id ?? undefined,
      },
    };
  }

  // Convert CommunicationEntity to Memory
  private communicationToMemory(comm: CommunicationEntity): Memory {
    return {
      id: `${comm.user_id}-${comm.time.getTime()}-${comm.communication_type}`,
      type: 'other',
      title: comm.subject || `${comm.communication_type} Communication`,
      description: comm.summary || comm.content.substring(0, 200) || null,
      timestamp: comm.time,
      category: comm.category || 'Communication',
      tags: comm.tags || [],
      userId: comm.user_id,
      metadata: {
        communicationType: comm.communication_type,
        direction: comm.direction,
        participantsMetadata: comm.participants_metadata,
        connectionId: comm.connection_id ?? undefined,
        threadId: comm.thread_id ?? undefined,
      },
    };
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

    // Extract connection info from properties
    const { connectionId, connectionName } = this.getEntityConnectionInfo(entity);

    // Get relationships for this entity
    const relationships = await this.getEntityRelationships(entity);

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
      connectionId,
      connectionName,
      metadata: {
        entityType: entity.entity_type,
        linkedTable: entity.linked_table,
        linkedId: entity.linked_id,
        properties: entity.properties,
        relationships, // Include relationship information
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
      Object: 'thing',
      Contact: 'contact',
      Place: 'place',
      Location: 'place',
      Concept: 'concept',
      Goal: 'other',
    };

    return typeMap[entityType] || 'other';
  }

  private async getEntityRelationships(entity: GraphNodeEntity): Promise<
    Array<{
      type: string;
      targetId: string;
      targetName: string;
      targetType: string;
      direction: 'outgoing' | 'incoming';
    }>
  > {
    try {
      // Get outgoing relationships
      const outgoing = await this.relationshipRepo
        .createQueryBuilder('rel')
        .leftJoinAndSelect('rel.to_entity', 'target')
        .where('rel.from_entity_id = :entityId', { entityId: entity.entity_id })
        .andWhere('rel.is_active = true')
        .limit(20) // Limit to avoid too much data
        .getMany();

      // Get incoming relationships
      const incoming = await this.relationshipRepo
        .createQueryBuilder('rel')
        .leftJoinAndSelect('rel.from_entity', 'source')
        .where('rel.to_entity_id = :entityId', { entityId: entity.entity_id })
        .andWhere('rel.is_active = true')
        .limit(20) // Limit to avoid too much data
        .getMany();

      const relationships = [
        ...outgoing.map((rel) => ({
          type: rel.relationship_type,
          targetId: rel.to_entity?.entity_id || '',
          targetName: rel.to_entity?.name || 'Unknown',
          targetType: rel.to_entity?.entity_type || 'Unknown',
          direction: 'outgoing' as const,
        })),
        ...incoming.map((rel) => ({
          type: rel.relationship_type,
          targetId: rel.from_entity?.entity_id || '',
          targetName: rel.from_entity?.name || 'Unknown',
          targetType: rel.from_entity?.entity_type || 'Unknown',
          direction: 'incoming' as const,
        })),
      ];

      return relationships;
    } catch (error) {
      this.logger.error('Error getting entity relationships', { error, entityId: entity.entity_id });

      return [];
    }
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
    // First, try the owner_user_id column
    if (entity.owner_user_id) {
      return entity.owner_user_id;
    }

    // Fallback: Try to get user ID from properties
    if (entity.properties && typeof entity.properties === 'object') {
      const props = entity.properties as Record<string, unknown>;
      const userId = props.user_id || props.userId;
      if (userId && typeof userId === 'string') {
        return userId;
      }
    }

    // Return empty string if no user ID found
    return '';
  }

  private getEntityConnectionInfo(entity: GraphNodeEntity): {
    connectionId?: string;
    connectionName?: string;
  } {
    if (entity.properties && typeof entity.properties === 'object') {
      const props = entity.properties as Record<string, unknown>;

      return {
        connectionId: props.connection_id
          ? String(props.connection_id)
          : props.connectionId
            ? String(props.connectionId)
            : undefined,
        connectionName: props.connection_name
          ? String(props.connection_name)
          : props.connectionName
            ? String(props.connectionName)
            : undefined,
      };
    }

    return {};
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
