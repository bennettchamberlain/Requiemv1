import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';

import { LoggerService } from '@ci/common/services';
import { RequestContext } from '@ci/common/types';

import { ContentEntity } from '../entities/ContentEntity';
import { EventEntity } from '../entities/EventEntity';
import { PersonEntity } from '../entities/PersonEntity';
import { PlaceEntity } from '../entities/PlaceEntity';
import { ThingEntity } from '../entities/ThingEntity';
import { Memory, MemoryLocation, MemoryResponse, MemorySearchParams } from '../types';

@Injectable()
export class MemoryService {
  private logger = new LoggerService(MemoryService.name);

  constructor(
    @InjectRepository(ContentEntity)
    private contentRepo: Repository<ContentEntity>,
    @InjectRepository(EventEntity)
    private eventRepo: Repository<EventEntity>,
    @InjectRepository(PersonEntity)
    private personRepo: Repository<PersonEntity>,
    @InjectRepository(PlaceEntity)
    private placeRepo: Repository<PlaceEntity>,
    @InjectRepository(ThingEntity)
    private thingRepo: Repository<ThingEntity>,
  ) {}

  async findAll(context: RequestContext, params: MemorySearchParams): Promise<MemoryResponse> {
    this.logger.debug('Finding memories', { userId: context.userId, params });

    const limit = params.limit || 50;
    const offset = params.offset || 0;

    // For now, let's focus on events and content as they're most likely to have temporal data
    const [events, eventsCount] = await this.findEvents(context, params);
    const [contents, contentsCount] = await this.findContents(context, params);

    // Convert entities to Memory objects
    const eventMemories = await Promise.all(events.map((e) => this.eventToMemory(e)));
    const contentMemories = await Promise.all(contents.map((c) => this.contentToMemory(c)));

    // Combine and sort by timestamp
    const allMemories = [...eventMemories, ...contentMemories]
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(offset, offset + limit);

    return {
      data: allMemories,
      total: eventsCount + contentsCount,
      limit,
      offset,
    };
  }

  async findOne(context: RequestContext, id: string): Promise<Memory> {
    // Try to find in each entity type
    const event = await this.eventRepo.findOne({
      where: { id, user: { id: context.userId } },
      relations: ['tags', 'user'],
    });
    if (event) return this.eventToMemory(event);

    const content = await this.contentRepo.findOne({
      where: { id, user: { id: context.userId } },
      relations: ['tags', 'user', 'event'],
    });
    if (content) return this.contentToMemory(content);

    throw new NotFoundException(`Memory with id ${id} not found`);
  }

  private async findEvents(
    context: RequestContext,
    params: MemorySearchParams,
  ): Promise<[EventEntity[], number]> {
    const query = this.eventRepo
      .createQueryBuilder('event')
      .leftJoinAndSelect('event.tags', 'tags')
      .leftJoinAndSelect('event.user', 'user')
      .where('event.user_id = :userId', { userId: context.userId });

    if (params.query) {
      query.andWhere(
        '(event.name ILIKE :query OR event.description ILIKE :query)',
        { query: `%${params.query}%` },
      );
    }

    if (params.startDate) {
      query.andWhere('event.start_time >= :startDate', { startDate: params.startDate });
    }

    if (params.endDate) {
      query.andWhere('event.start_time <= :endDate', { endDate: params.endDate });
    }

    return query.getManyAndCount();
  }

  private async findContents(
    context: RequestContext,
    params: MemorySearchParams,
  ): Promise<[ContentEntity[], number]> {
    const query = this.contentRepo
      .createQueryBuilder('content')
      .leftJoinAndSelect('content.tags', 'tags')
      .leftJoinAndSelect('content.user', 'user')
      .leftJoinAndSelect('content.event', 'event')
      .where('content.user_id = :userId', { userId: context.userId });

    if (params.query) {
      query.andWhere(
        '(content.title ILIKE :query OR content.text ILIKE :query)',
        { query: `%${params.query}%` },
      );
    }

    return query.getManyAndCount();
  }

  private async eventToMemory(event: EventEntity): Promise<Memory> {
    // Try to find associated places through source_data or other means
    let location: MemoryLocation | undefined;
    
    // Check if there's location data in source_data
    if (event.source_data && typeof event.source_data === 'object') {
      const sourceData = event.source_data as any;
      if (sourceData.location || sourceData.place) {
        const locData = sourceData.location || sourceData.place;
        if (locData.lat && locData.lng) {
          location = {
            id: event.id + '-loc',
            name: locData.name || event.name,
            lat: parseFloat(locData.lat),
            lng: parseFloat(locData.lng),
            address: locData.address,
          };
        }
      }
    }

    return {
      id: event.id,
      type: 'event',
      title: event.name || 'Untitled Event',
      description: event.description,
      timestamp: event.start_time || event.created_at,
      category: event.type || 'Event',
      location,
      tags: event.tags?.map((t) => t.label).filter(Boolean) as string[] || [],
      userId: event.user?.id || '',
      metadata: {
        endTime: event.end_time,
        externalId: event.external_id,
        sourceUrl: event.source_url,
      },
    };
  }

  private async contentToMemory(content: ContentEntity): Promise<Memory> {
    // Content might be associated with an event that has location
    let location: MemoryLocation | undefined;
    
    if (content.event) {
      const event = await this.eventRepo.findOne({
        where: { id: content.event.id },
      });
      
      if (event?.source_data && typeof event.source_data === 'object') {
        const sourceData = event.source_data as any;
        if (sourceData.location || sourceData.place) {
          const locData = sourceData.location || sourceData.place;
          if (locData.lat && locData.lng) {
            location = {
              id: content.id + '-loc',
              name: locData.name || content.title,
              lat: parseFloat(locData.lat),
              lng: parseFloat(locData.lng),
              address: locData.address,
            };
          }
        }
      }
    }

    return {
      id: content.id,
      type: 'content',
      title: content.title || 'Untitled Content',
      description: content.text,
      timestamp: content.created_at,
      category: content.type || 'Content',
      location,
      tags: content.tags?.map((t) => t.label).filter(Boolean) as string[] || [],
      userId: content.user?.id || '',
      metadata: {
        url: content.url,
        mimetype: content.mimetype,
        externalId: content.external_id,
        sourceUrl: content.source_url,
      },
    };
  }
}
