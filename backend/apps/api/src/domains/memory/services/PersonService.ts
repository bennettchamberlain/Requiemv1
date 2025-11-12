import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v7 as uuid7 } from 'uuid';

import { LoggerService } from '@ci/common/services';
import { RequestContext } from '@ci/common/types';
import { EventService, Events } from '@ci/domains/events';
import { UserService, User } from '@ci/domains/user';

import { PersonEntity } from '../entities/PersonEntity';
import { CreatePersonDto, UpdatePersonDto } from '../types';

interface ParticipantInfo {
  email: string;
  name: string;
  type?: string; // 'organizer', 'attendee', 'from', 'to', 'cc', 'bcc'
  responseStatus?: string;
}

@Injectable()
export class PersonService {
  private logger = new LoggerService(PersonService.name);

  constructor(
    @InjectRepository(PersonEntity)
    private readonly personRepository: Repository<PersonEntity>,
    private readonly userService: UserService,
    private readonly eventService: EventService,
  ) {}

  async create(context: RequestContext, data: CreatePersonDto): Promise<PersonEntity> {
    const entity = await this.personRepository.create({
      id: data.id || uuid7(),
      name: data.name,
      description: data.description,
      linked_table: data.linkedTable,
      linked_id: data.linkedId,
      entity_type: 'Person',
      user: {
        id: context.userId,
      },
      search_content: data.searchContent || this.buildPersonSearchContent(data.name, data.properties),
      last_accessed: data.lastAccessed,
      properties: data.properties || [],
    });

    return this.personRepository.save(entity);
  }

  async findOne(context: RequestContext, id: string): Promise<PersonEntity | null> {
    return this.personRepository.findOne({
      where: {
        id,
        user: {
          id: context.userId,
        },
      },
    });
  }

  async findAll(context: RequestContext): Promise<PersonEntity[]> {
    return this.personRepository.find({
      where: {
        user: {
          id: context.userId,
        },
      },
    });
  }

  async update(context: RequestContext, id: string, data: UpdatePersonDto): Promise<PersonEntity> {
    const existingEntity = await this.findOne(context, id);
    if (!existingEntity) {
      throw new NotFoundException();
    }

    const updatedEntity = {
      ...existingEntity,
      name: data.name,
      description: data.description,
      search_content: data.searchContent,
      linked_id: data.linkedId,
      linked_table: data.linkedTable,
      last_accessed: data.lastAccessed,
      properties: data.properties,
      user: {
        id: context.userId,
      },
    };

    return this.personRepository.save(updatedEntity!);
  }

  async delete(context: RequestContext, id: string): Promise<boolean> {
    const result = await this.personRepository.delete({
      id,
      user: {
        id: context.userId,
      },
    });

    if (result.affected === 0) {
      throw new NotFoundException();
    }

    return true;
  }

  async search(context: RequestContext, query: UpdatePersonDto): Promise<PersonEntity[]> {
    return this.personRepository.find({
      where: {
        user: {
          id: context.userId,
        },
        ...query,
      },
    });
  }

  /**
   * Create or update a person entity from a participant
   * Every entity created will have at least one relationship to the user
   */
  async createOrUpdatePersonFromParticipant(
    participant: ParticipantInfo,
    userId: string,
    connectionId: string,
    source: 'calendar' | 'email' | 'drive',
    relationshipType: 'MET_WITH' | 'EMAILED' | 'RECEIVED_EMAIL_FROM' | 'ORGANIZED_EVENT_WITH' | 'EDITED_WITH',
  ): Promise<string> {
    try {
      // Get user entity and user entity ID
      const user = await this.userService.findOne(userId);
      if (!user) {
        throw new Error(`User not found: ${userId}`);
      }

      // Skip if participant is the user themselves (avoid self-references)
      if (participant.email.toLowerCase() === user.email.toLowerCase()) {
        const userEntityId = await this.getUserEntityId(userId);
        this.logger.log('Skipping self-reference participant', {
          email: participant.email,
          userId,
        });

        return userEntityId;
      }

      const userEntityId = await this.getUserEntityId(userId);

      // Check if person entity already exists by email in properties
      const existingEntities = await this.search(
        { userId },
        {
          properties: {
            email: participant.email,
            owner_user_id: userId,
          },
        },
      );

      let entityId: string;
      let searchContent: string | null = null;

      if (existingEntities.length === 0) {
        // Create new person entity
        entityId = uuid7();
        const nameParts = participant.name.trim().split(/\s+/).filter(Boolean);
        const [firstName, ...restName] = nameParts;
        const lastName = restName.length > 0 ? restName.join(' ') : null;

        const properties: Record<string, unknown> = {
          email: participant.email,
          first_name: firstName || participant.name,
          last_name: lastName,
          contact_type: source,
          owner_user_id: userId,
          connection_id: connectionId,
          sources: [source],
          [`${source}_data`]: {
            participant_type: participant.type,
            response_status: participant.responseStatus,
            last_seen: new Date().toISOString(),
          },
        };

        searchContent = this.buildPersonSearchContent(participant.name, properties);

        await this.create(
          { userId },
          {
            id: entityId,
            name: participant.name,
            description: `Contact from ${source}`,
            properties,
            searchContent: searchContent || undefined,
          },
        );

        this.logger.log('Created new person entity', {
          entityId,
          name: participant.name,
          email: participant.email,
          source,
        });
      } else {
        const existingEntity = existingEntities[0];
        // Update existing entity with new source data
        entityId = existingEntity.id;
        const currentProperties = (existingEntity.properties as Record<string, unknown>) ?? {};
        const sources = (currentProperties.sources || []) as string[];
        let propertiesForSearch = currentProperties;

        if (!sources.includes(source)) {
          sources.push(source);
          propertiesForSearch = {
            ...currentProperties,
            sources,
            [`${source}_data`]: {
              participant_type: participant.type,
              response_status: participant.responseStatus,
              last_seen: new Date().toISOString(),
            },
          };

          await this.update({ userId }, existingEntity.id, {
            properties: propertiesForSearch,
            lastAccessed: new Date(),
          });

          this.logger.log('Updated existing person entity', {
            entityId,
            sources,
          });
        }

        searchContent = this.buildPersonSearchContent(existingEntity.name, propertiesForSearch);
      }

      await this.enqueuePersonEmbedding(userId, entityId, searchContent);

      // Create or update relationship between user and this person
      // This ensures every entity has at least one relationship
      await this.eventService.send(Events.GRAPH_PERSON_CREATED, {
        ownerId: userId,
        person: {
          entityId,
          entityType: 'Person',
          name: participant.name,
        },
        relationships: [
          {
            fromEntityId: userEntityId,
            toEntityId: entityId,
            relationshipType,
            properties: {
              source,
              connection_id: connectionId,
              participant_type: participant.type,
              last_interaction: new Date().toISOString(),
            },
          },
        ],
      });

      return entityId;
    } catch (error) {
      this.logger.error('Failed to create/update person entity', {
        participant,
        source,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  private async enqueuePersonEmbedding(ownerId: string, entityId: string, searchContent: string | null) {
    if (!searchContent || searchContent.trim().length === 0) {
      return;
    }

    try {
      await this.eventService.send(Events.SEARCH_EMBED_ENTITY, {
        ownerId,
        entityId,
        entityType: 'Person',
        searchContent,
      });
    } catch (error) {
      this.logger.error('Failed to enqueue person embedding', {
        ownerId,
        entityId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private buildPersonSearchContent(
    name: string | null | undefined,
    properties?: Record<string, unknown>,
  ): string | null {
    const parts = new Set<string>();
    const push = (value: unknown) => {
      if (typeof value !== 'string') {
        return;
      }

      const normalized = value.trim();
      if (normalized.length === 0) {
        return;
      }

      parts.add(normalized);
    };

    push(name ?? null);

    const props: Record<string, unknown> = properties ?? {};
    const candidateKeys = ['first_name', 'last_name', 'email', 'occupation', 'bio', 'phone'];
    for (const key of candidateKeys) {
      push(props[key]);
    }

    const aliases = props['aliases'];
    if (Array.isArray(aliases)) {
      for (const alias of aliases) {
        push(alias);
      }
    }

    if (parts.size === 0) {
      return null;
    }

    return Array.from(parts).join(' ');
  }

  /**
   * Process multiple participants and create entities with relationships
   */
  async processParticipants(
    participants: ParticipantInfo[],
    userId: string,
    connectionId: string,
    source: 'calendar' | 'email' | 'drive',
    relationshipType: 'MET_WITH' | 'EMAILED' | 'RECEIVED_EMAIL_FROM' | 'ORGANIZED_EVENT_WITH' | 'EDITED_WITH',
  ): Promise<string[]> {
    this.logger.log(`Processing ${participants.length} participants from ${source}`, {
      userId,
      connectionId,
      source,
    });

    const entityIds: string[] = [];

    for (const participant of participants) {
      try {
        const entityId = await this.createOrUpdatePersonFromParticipant(
          participant,
          userId,
          connectionId,
          source,
          relationshipType,
        );
        entityIds.push(entityId);
      } catch (error) {
        // Log error but continue processing other participants
        this.logger.error('Failed to process participant', {
          participant,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    this.logger.log(`Completed processing participants from ${source}`, {
      userId,
      connectionId,
      processedCount: entityIds.length,
    });

    return entityIds;
  }

  /**
   * Get or create a user's entity ID
   * Handles user lookup and entity creation in one call
   */
  async getUserEntityId(userId: string): Promise<string> {
    const user = await this.userService.findOne(userId);
    if (!user) {
      throw new Error(`User not found: ${userId}`);
    }

    if (user.id) {
      return user.id;
    }

    return this.ensureUserHasEntity(user);
  }

  /**
   * Ensure a user has an entity in the graph
   * Creates one if it doesn't exist (for legacy users)
   */
  async ensureUserHasEntity(user: User): Promise<string> {
    const entityId = uuid7();
    const nameParts = (user.name ?? '').trim().split(/\s+/).filter(Boolean);
    const [firstName, ...restName] = nameParts;

    const properties: Record<string, unknown> = {
      email: user.email,
      owner_user_id: user.id,
    };

    if (firstName) {
      properties.first_name = firstName;
    }

    if (restName.length > 0) {
      properties.last_name = restName.join(' ');
    }

    const searchContent = this.buildPersonSearchContent(user.name ?? user.email ?? null, properties);

    const existingEntities = await this.search(
      { userId: user.id },
      {
        properties: {
          email: properties.email as string,
          owner_user_id: user.id,
        },
      },
    );
    if (existingEntities.length === 0) {
      await this.create(
        { userId: user.id },
        {
          id: entityId,
          name: user.name || user.email,
          description: `User: ${user.name || user.email}`,
          properties,
          searchContent: searchContent || undefined,
          linkedTable: 'users',
          linkedId: user.id,
        },
      );

      await this.enqueuePersonEmbedding(user.id, entityId, searchContent);

      // Update the user record with the new entity ID
      await this.userService.update(user.id, { entityId });
    }

    this.logger.log('Created entity for legacy user', {
      userId: user.id,
      entityId,
    });

    return entityId;
  }
}
