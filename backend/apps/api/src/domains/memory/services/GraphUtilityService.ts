import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { LoggerService } from '@ci/common/services';

import { GraphNodeEntity } from '../entities/GraphNodeEntity';
import { RelationshipEntity } from '../entities/RelationshipEntity';

/**
 * GraphUtilityService - Helper service for common graph operations
 *
 * This service provides reusable graph traversal and entity management utilities
 * that can be used across different domains. It's designed to be extended
 * in Phase 2 with a proper graph query builder.
 */
@Injectable()
export class GraphUtilityService {
  private logger = new LoggerService(GraphUtilityService.name);

  constructor(
    @InjectRepository(GraphNodeEntity)
    private entityRepo: Repository<GraphNodeEntity>,
    @InjectRepository(RelationshipEntity)
    private relationshipRepo: Repository<RelationshipEntity>,
  ) {}

  /**
   * Find all entities connected to a given entity via specific relationship types
   */
  async findConnectedEntities(
    entityId: string,
    relationshipTypes: string[],
    direction: 'outbound' | 'inbound' | 'both' = 'both',
  ): Promise<GraphNodeEntity[]> {
    let query = this.relationshipRepo
      .createQueryBuilder('rel')
      .leftJoinAndSelect('rel.to_entity', 'to_entity')
      .leftJoinAndSelect('rel.from_entity', 'from_entity')
      .where('rel.is_active = true')
      .andWhere('rel.relationship_type IN (:...types)', { types: relationshipTypes });

    if (direction === 'outbound') {
      query = query.andWhere('rel.from_entity_id = :entityId', { entityId });
    } else if (direction === 'inbound') {
      query = query.andWhere('rel.to_entity_id = :entityId', { entityId });
    } else {
      query = query.andWhere('(rel.from_entity_id = :entityId OR rel.to_entity_id = :entityId)', {
        entityId,
      });
    }

    const relationships = await query.getMany();

    // Extract connected entities
    const connectedEntities: GraphNodeEntity[] = [];
    for (const rel of relationships) {
      if (direction === 'outbound' && rel.to_entity) {
        connectedEntities.push(rel.to_entity);
      } else if (direction === 'inbound' && rel.from_entity) {
        connectedEntities.push(rel.from_entity);
      } else if (direction === 'both') {
        if (rel.from_entity_id === entityId && rel.to_entity) {
          connectedEntities.push(rel.to_entity);
        } else if (rel.to_entity_id === entityId && rel.from_entity) {
          connectedEntities.push(rel.from_entity);
        }
      }
    }

    return connectedEntities;
  }

  /**
   * Create a relationship between two entities
   */
  async createRelationship(
    fromEntityId: string,
    toEntityId: string,
    relationshipType: string,
    properties: Record<string, unknown> = {},
    strength = 1.0,
  ): Promise<RelationshipEntity> {
    const relationship = this.relationshipRepo.create({
      relationship_id: crypto.randomUUID(),
      from_entity_id: fromEntityId,
      to_entity_id: toEntityId,
      relationship_type: relationshipType,
      strength,
      properties,
      is_active: true,
    });

    return this.relationshipRepo.save(relationship);
  }

  /**
   * Create a new graph node
   */
  async createGraphNode(data: {
    entityId: string;
    entityType: string;
    name: string;
    description?: string;
    properties?: Record<string, unknown>;
    searchContent?: string;
    linkedTable?: string;
    linkedId?: string;
  }): Promise<GraphNodeEntity> {
    const node = this.entityRepo.create({
      entity_id: data.entityId,
      entity_type: data.entityType,
      name: data.name,
      description: data.description ?? data.name,
      properties: data.properties ?? {},
      search_content: data.searchContent ?? data.name,
      linked_table: data.linkedTable,
      linked_id: data.linkedId,
      is_active: true,
      is_archived: false,
    });

    return this.entityRepo.save(node);
  }

  /**
   * Find entities by type with optional property filters
   */
  async findEntitiesByType(
    entityType: string,
    propertyFilters: Record<string, unknown> = {},
    limit = 100,
  ): Promise<GraphNodeEntity[]> {
    let query = this.entityRepo
      .createQueryBuilder('entity')
      .where('entity.entity_type = :entityType', { entityType })
      .andWhere('entity.is_active = true')
      .limit(limit);

    // Add property filters using JSONB operators
    Object.entries(propertyFilters).forEach(([key, value], index) => {
      query = query.andWhere(`entity.properties->>'${key}' = :propValue${index}`, {
        [`propValue${index}`]: value,
      });
    });

    return query.getMany();
  }

  /**
   * Get relationship statistics for debugging
   */
  async getRelationshipStats(): Promise<{
    totalRelationships: number;
    relationshipsByType: Array<{ type: string; count: number }>;
    entitiesByType: Array<{ type: string; count: number }>;
  }> {
    const [relationshipStats, entityStats, totalRelationships] = await Promise.all([
      this.relationshipRepo
        .createQueryBuilder('rel')
        .select('rel.relationship_type as type, COUNT(*) as count')
        .where('rel.is_active = true')
        .groupBy('rel.relationship_type')
        .getRawMany(),

      this.entityRepo
        .createQueryBuilder('entity')
        .select('entity.entity_type as type, COUNT(*) as count')
        .where('entity.is_active = true')
        .groupBy('entity.entity_type')
        .getRawMany(),

      this.relationshipRepo.count({ where: { is_active: true } }),
    ]);

    return {
      totalRelationships,
      relationshipsByType: relationshipStats.map((stat) => ({
        type: stat.type,
        count: parseInt(stat.count, 10),
      })),
      entitiesByType: entityStats.map((stat) => ({
        type: stat.type,
        count: parseInt(stat.count, 10),
      })),
    };
  }
}
