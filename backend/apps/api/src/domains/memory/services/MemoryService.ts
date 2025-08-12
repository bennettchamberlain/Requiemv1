import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';

import { LoggerService } from '@ci/common/services';
import { RequestContext } from '@ci/common/types';

import { ContentEntity } from '../entities/ContentEntity';
import { EventEntity } from '../entities/EventEntity';
import { LocationEntity } from '../entities/LocationEntity';
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
    @InjectRepository(LocationEntity)
    private locationRepo: Repository<LocationEntity>,
    @InjectRepository(PersonEntity)
    private personRepo: Repository<PersonEntity>,
    @InjectRepository(PlaceEntity)
    private placeRepo: Repository<PlaceEntity>,
    @InjectRepository(ThingEntity)
    private thingRepo: Repository<ThingEntity>,
  ) {}

  async findAll(context: RequestContext, params: MemorySearchParams): Promise<MemoryResponse> {
    this.logger.warn('DEBUGGING: Finding memories START', { userId: context.userId, params });

    const limit = params.limit || 50;
    const offset = params.offset || 0;

    try {
      // Fetch events with related places
      this.logger.warn('DEBUGGING: About to call findEvents');
      const [events, eventsCount] = await this.findEvents(context, params);
      
      this.logger.warn('DEBUGGING: About to call findContents');
      const [contents, contentsCount] = await this.findContents(context, params);
      
      this.logger.warn('DEBUGGING: About to call findPeople');
      const [people, peopleCount] = await this.findPeople(context, params);
      
      this.logger.warn('DEBUGGING: About to call findThings');
      const [things, thingsCount] = await this.findThings(context, params);

      this.logger.warn('DEBUGGING: Found entities', { 
        eventsCount, 
        contentsCount,
        peopleCount,
        thingsCount,
        eventsLength: events.length,
        contentsLength: contents.length,
        peopleLength: people.length,
        thingsLength: things.length,
        userId: context.userId 
      });

      // Convert entities to Memory objects
      const eventMemories = await Promise.all(events.map((e) => this.eventToMemory(e)));
      const contentMemories = await Promise.all(contents.map((c) => this.contentToMemory(c)));
      const personMemories = await Promise.all(people.map((p) => this.personToMemory(p)));
      const thingMemories = await Promise.all(things.map((t) => this.thingToMemory(t)));

      // Combine and sort by timestamp
      const allMemories = [...eventMemories, ...contentMemories, ...personMemories, ...thingMemories]
        .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
        .slice(offset, offset + limit);

      const response = {
        data: allMemories,
        total: eventsCount + contentsCount + peopleCount + thingsCount,
        limit,
        offset,
      };

      this.logger.warn('DEBUGGING: Returning memory response', { 
        dataLength: response.data.length,
        total: response.total,
        limit: response.limit,
        offset: response.offset,
        memoriesWithLocation: response.data.filter(m => m.location).length,
        eventMemoriesCount: eventMemories.length,
        contentMemoriesCount: contentMemories.length,
        personMemoriesCount: personMemories.length,
        thingMemoriesCount: thingMemories.length
      });

      return response;
    } catch (error) {
      this.logger.error('DEBUGGING: Error in findAll', { error, userId: context.userId });
      throw error;
    }
  }

  async findOne(context: RequestContext, id: string): Promise<Memory> {
    // Try to find in each entity type
    // TEMPORARILY DISABLED: User filtering
    const event = await this.eventRepo.findOne({
      where: { id },
      relations: ['tags', 'user'],
    });
    if (event) return this.eventToMemory(event);

    const content = await this.contentRepo.findOne({
      where: { id },
      relations: ['tags', 'user', 'event'],
    });
    if (content) return this.contentToMemory(content);

    throw new NotFoundException(`Memory with id ${id} not found`);
  }

  private async findEvents(
    context: RequestContext,
    params: MemorySearchParams,
  ): Promise<[EventEntity[], number]> {
    // First, let's check if there are any events at all
    const totalEventsInDb = await this.eventRepo.count();
    this.logger.warn('DEBUGGING: Total events in database', { totalEventsInDb });
    
    // Let's try the simplest possible query first
    try {
      const simpleFind = await this.eventRepo.find({ take: 5 });
      this.logger.warn('DEBUGGING: Simple find() result', { 
        count: simpleFind.length,
        firstEvent: simpleFind[0] || 'NO EVENTS FOUND'
      });
    } catch (error) {
      this.logger.error('DEBUGGING: Error in simple find', { error });
    }

    // Try raw SQL query
    try {
      const rawQuery = await this.eventRepo.query('SELECT COUNT(*) as count FROM events');
      this.logger.warn('DEBUGGING: Raw SQL count', { rawQuery });
      
      const rawEvents = await this.eventRepo.query('SELECT id, name, type, start_time FROM events LIMIT 5');
      this.logger.warn('DEBUGGING: Raw SQL events', { rawEvents });
    } catch (error) {
      this.logger.error('DEBUGGING: Error in raw SQL', { error });
    }

    const query = this.eventRepo
      .createQueryBuilder('event')
      .leftJoinAndSelect('event.tags', 'tags')
      .leftJoinAndSelect('event.user', 'user');

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

    const sql = query.getSql();
    const parameters = query.getParameters();
    this.logger.warn('DEBUGGING: Event query details', { 
      sql, 
      parameters,
      userId: context.userId 
    });

    try {
      const result = await query.getManyAndCount();
      
      // Log sample event if we have any
      if (result[0].length > 0) {
        this.logger.warn('DEBUGGING: Sample event from query', { 
          event: result[0][0],
          userId: context.userId 
        });
      } else {
        this.logger.error('DEBUGGING: NO EVENTS RETURNED FROM QUERY');
      }
      
      this.logger.warn('DEBUGGING: Event query result', { 
        count: result[1], 
        returnedCount: result[0].length,
        userId: context.userId 
      });

      return result;
    } catch (error) {
      this.logger.error('DEBUGGING: Error executing event query', { error, sql });
      throw error;
    }
  }

  private async findContents(
    context: RequestContext,
    params: MemorySearchParams,
  ): Promise<[ContentEntity[], number]> {
    const query = this.contentRepo
      .createQueryBuilder('content')
      .leftJoinAndSelect('content.tags', 'tags')
      .leftJoinAndSelect('content.user', 'user')
      .leftJoinAndSelect('content.event', 'event');
      // TEMPORARILY DISABLED: User filtering
      // .where('content.user_id = :userId', { userId: context.userId });

    if (params.query) {
      query.andWhere(
        '(content.title ILIKE :query OR content.text ILIKE :query)',
        { query: `%${params.query}%` },
      );
    }

    const sql = query.getSql();
    this.logger.debug('Content query SQL', { sql, userId: context.userId });

    const result = await query.getManyAndCount();
    this.logger.debug('Content query result', { count: result[1], userId: context.userId });

    return result;
  }

  private async findPeople(
    context: RequestContext,
    params: MemorySearchParams,
  ): Promise<[PersonEntity[], number]> {
    const query = this.personRepo
      .createQueryBuilder('person')
      .leftJoinAndSelect('person.tags', 'tags')
      .leftJoinAndSelect('person.user', 'user');
      // TEMPORARILY DISABLED: User filtering
      // .where('person.user_id = :userId', { userId: context.userId });

    if (params.query) {
      query.andWhere(
        '(person.first_name ILIKE :query OR person.last_name ILIKE :query)',
        { query: `%${params.query}%` },
      );
    }

    return query.getManyAndCount();
  }

  private async findThings(
    context: RequestContext,
    params: MemorySearchParams,
  ): Promise<[ThingEntity[], number]> {
    const query = this.thingRepo
      .createQueryBuilder('thing')
      .leftJoinAndSelect('thing.tags', 'tags')
      .leftJoinAndSelect('thing.user', 'user')
      .leftJoinAndSelect('thing.event', 'event');
      // TEMPORARILY DISABLED: User filtering
      // .where('thing.user_id = :userId', { userId: context.userId });

    if (params.query) {
      query.andWhere(
        '(thing.name ILIKE :query OR thing.description ILIKE :query)',
        { query: `%${params.query}%` },
      );
    }

    return query.getManyAndCount();
  }

  private async eventToMemory(event: EventEntity): Promise<Memory> {
    let location: MemoryLocation | undefined;
    
    // Log the event we're converting
    this.logger.debug('Converting event to memory', {
      eventId: event.id,
      eventName: event.name,
      eventType: event.type,
      hasStartTime: !!event.start_time,
      startTime: event.start_time,
      hasUser: !!event.user,
      userId: event.user?.id
    });
    
    // First, try to find associated locations through the locations table
    if (event.user?.id && event.start_time) {
      const eventLocations = await this.locationRepo.find({
        where: { 
          user: { id: event.user.id },
          datetime: event.start_time
        },
        relations: ['place'],
        take: 1
      });

      if (eventLocations.length > 0) {
        const loc = eventLocations[0];
        if (loc.geolocation && typeof loc.geolocation === 'object') {
          const geo = loc.geolocation as any;
          if (geo.lat && geo.lng) {
            location = {
              id: loc.id,
              name: loc.place?.name || null,
              lat: parseFloat(geo.lat),
              lng: parseFloat(geo.lng),
              address: loc.place?.name || undefined,
            };
          } else if (geo.latitude && geo.longitude) {
            location = {
              id: loc.id,
              name: loc.place?.name || null,
              lat: parseFloat(geo.latitude),
              lng: parseFloat(geo.longitude),
              address: loc.place?.name || undefined,
            };
          }
        }
      }
    }

    // If no location found, check source_data as fallback
    if (!location && event.source_data && typeof event.source_data === 'object') {
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

    this.logger.debug('Event location data', { 
      eventId: event.id, 
      hasLocation: !!location,
      locationData: location 
    });

    const memory: Memory = {
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

    this.logger.debug('Created memory from event', {
      memoryId: memory.id,
      memoryTitle: memory.title,
      memoryTimestamp: memory.timestamp
    });

    return memory;
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

  private async personToMemory(person: PersonEntity): Promise<Memory> {
    let location: MemoryLocation | undefined;
    
    // Check if person has address data that can be geocoded
    if (person.city && person.country) {
      // For now, we'll just note that the person has location data
      // In a real implementation, you might geocode the address
      this.logger.debug('Person has address', { 
        personId: person.id,
        city: person.city,
        country: person.country 
      });
    }

    const fullName = [person.first_name, person.last_name].filter(Boolean).join(' ') || 'Unknown Person';

    return {
      id: person.id,
      type: 'person',
      title: fullName,
      description: person.address || [person.city, person.region, person.country].filter(Boolean).join(', ') || null,
      timestamp: person.created_at,
      category: person.type || 'Person',
      location,
      tags: person.tags?.map((t) => t.label).filter(Boolean) as string[] || [],
      userId: person.user?.id || '',
      metadata: {
        gender: person.gender,
        avatarUrl: person.avatar_url,
        externalId: person.external_id,
        sourceUrl: person.source_url,
      },
    };
  }

  private async thingToMemory(thing: ThingEntity): Promise<Memory> {
    let location: MemoryLocation | undefined;
    
    // Things might have location through their associated event
    if (thing.event) {
      const eventMemory = await this.eventToMemory(thing.event);
      location = eventMemory.location;
    }

    return {
      id: thing.id,
      type: 'thing',
      title: thing.name || 'Untitled Thing',
      description: thing.description,
      timestamp: thing.created_at,
      category: thing.type || 'Thing',
      location,
      tags: thing.tags?.map((t) => t.label).filter(Boolean) as string[] || [],
      userId: thing.user?.id || '',
      metadata: {
        externalId: thing.external_id,
        sourceUrl: thing.source_url,
        eventId: thing.event?.id,
      },
    };
  }

  async getDebugInfo(context: RequestContext) {
    // TEMPORARILY DISABLED: User filtering
    const [locations, locCount] = await this.locationRepo.findAndCount({
      take: 5
    });
    
    const [places, placeCount] = await this.placeRepo.findAndCount({
      take: 5
    });

    // Also get event count
    const eventCount = await this.eventRepo.count();

    const contentCount = await this.contentRepo.count();

    const personCount = await this.personRepo.count();

    const thingCount = await this.thingRepo.count();

    return {
      counts: {
        events: eventCount,
        contents: contentCount,
        people: personCount,
        things: thingCount,
        locations: locCount,
        places: placeCount
      },
      sampleLocations: locations.map(l => ({
        id: l.id,
        datetime: l.datetime,
        geolocation: l.geolocation,
        placeId: l.place?.id
      })),
      samplePlaces: places.map(p => ({
        id: p.id,
        name: p.name,
        geolocation: p.geolocation
      }))
    };
  }

  async getRawEvents() {
    // Get all events without any filtering to see what's in the database
    const events = await this.eventRepo
      .createQueryBuilder('event')
      .leftJoinAndSelect('event.user', 'user')
      .leftJoinAndSelect('event.tags', 'tags')
      .limit(10)
      .getMany();

    this.logger.debug('Raw events query result', {
      count: events.length,
      firstEvent: events[0] || null
    });

    // Also check if there are any events without users
    const eventsWithoutUser = await this.eventRepo
      .createQueryBuilder('event')
      .where('event.user_id IS NULL')
      .limit(5)
      .getMany();

    this.logger.debug('Events without user', {
      count: eventsWithoutUser.length
    });

    // Get distinct user IDs from events
    const userIds = await this.eventRepo
      .createQueryBuilder('event')
      .select('DISTINCT event.user_id', 'userId')
      .where('event.user_id IS NOT NULL')
      .getRawMany();

    this.logger.debug('Distinct user IDs in events', {
      userIds: userIds.map(u => u.userId)
    });

    return events.map(event => ({
      id: event.id,
      name: event.name,
      type: event.type,
      userId: event.user?.id,
      userIdDirect: (event as any).user_id, // Check if user_id is set directly
      startTime: event.start_time,
      endTime: event.end_time,
      hasUser: !!event.user,
      tagCount: event.tags?.length || 0,
      createdAt: event.created_at
    }));
  }

  async findAllDebug(): Promise<MemoryResponse> {
    this.logger.debug('Finding all memories without user filter');

    const limit = 50;
    const offset = 0;

    try {
      // Get events without user filter
      const events = await this.eventRepo.find({
        relations: ['user', 'tags'],
        take: 10
      });

      const contents = await this.contentRepo.find({
        relations: ['user', 'tags', 'event'],
        take: 10
      });

      const people = await this.personRepo.find({
        relations: ['user', 'tags'],
        take: 10
      });

      const things = await this.thingRepo.find({
        relations: ['user', 'tags', 'event'],
        take: 10
      });

      this.logger.debug('Found entities without filter', { 
        eventsCount: events.length,
        contentsCount: contents.length,
        peopleCount: people.length,
        thingsCount: things.length
      });

      // Convert entities to Memory objects
      const eventMemories = await Promise.all(events.map((e) => this.eventToMemory(e)));
      const contentMemories = await Promise.all(contents.map((c) => this.contentToMemory(c)));
      const personMemories = await Promise.all(people.map((p) => this.personToMemory(p)));
      const thingMemories = await Promise.all(things.map((t) => this.thingToMemory(t)));

      // Combine and sort by timestamp
      const allMemories = [...eventMemories, ...contentMemories, ...personMemories, ...thingMemories]
        .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

      const response = {
        data: allMemories,
        total: allMemories.length,
        limit,
        offset,
      };

      this.logger.debug('Returning debug memory response', { 
        dataLength: response.data.length,
        memoriesWithLocation: response.data.filter(m => m.location).length
      });

      return response;
    } catch (error) {
      this.logger.error('Error in findAllDebug', { error });
      throw error;
    }
  }

  async directDatabaseTest() {
    this.logger.warn('DEBUGGING: Direct database test');
    
    const results: any = {};
    
    try {
      // Test raw SQL queries
      const eventCount = await this.eventRepo.query('SELECT COUNT(*) FROM events');
      results.eventCountRaw = eventCount;
      
      const eventSample = await this.eventRepo.query('SELECT * FROM events LIMIT 5');
      results.eventSampleRaw = eventSample;
      
      // Test TypeORM count
      const eventCountTypeorm = await this.eventRepo.count();
      results.eventCountTypeorm = eventCountTypeorm;
      
      // Test simple find
      const eventFindSimple = await this.eventRepo.find({ take: 5 });
      results.eventFindSimple = eventFindSimple;
      
      // Check table existence
      const tables = await this.eventRepo.query(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name IN ('events', 'content', 'people', 'things', 'places', 'locations')
      `);
      results.existingTables = tables;
      
      // Check event table structure
      const eventColumns = await this.eventRepo.query(`
        SELECT column_name, data_type 
        FROM information_schema.columns 
        WHERE table_name = 'events'
      `);
      results.eventColumns = eventColumns;
      
    } catch (error) {
      results.error = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error('DEBUGGING: Direct database test error', { error });
    }
    
    return results;
  }
}
