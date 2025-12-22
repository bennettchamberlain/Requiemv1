import { UseGuards } from '@nestjs/common';
import { Mutation, Query, Resolver, Args, ID } from '@nestjs/graphql';

import { Context, type RequestContext, toServiceContext } from '@ci/common/context';
import { JwtAuthGuard } from '@ci/common/guards';
import { EventService } from '@ci/domains/memory';

import { CreateEventInput } from '../types/CreateEventInput';
import { EventConnection } from '../types/EventConnection';
import { EventEdge } from '../types/EventEdge';
import { EventType } from '../types/EventType';
import { GlobalUID } from '../types/GlobalUID';
import { PaginationArgs } from '../types/PaginationArgs';
import { UpdateEventInput } from '../types/UpdateEventInput';
import { Paginator } from '../utils/Paginator';

@UseGuards(JwtAuthGuard)
@Resolver(() => EventType)
export class EventResolver {
  constructor(private readonly eventService: EventService) {}

  @Mutation(() => EventType)
  async createEvent(
    @Context() context: RequestContext,
    @Args('input') input: CreateEventInput,
  ): Promise<EventType> {
    const serviceContext = toServiceContext(context);

    const entity = await this.eventService.create(serviceContext, {
      title: input.title,
      description: input.description,
      event_type: input.eventType,
      category: input.category,
      start_time: input.startTime,
      end_time: input.endTime,
      duration_minutes: input.durationMinutes,
      location_name: input.locationName,
      location_coordinates: input.locationCoordinates,
      location_entity_id: input.locationEntityId,
      participant_entity_ids: input.participantEntityIds,
      organizer_entity_id: input.organizerEntityId,
      source_type: input.sourceType,
      source_id: input.sourceId,
      source_system: input.sourceSystem,
      confidence_score: input.confidenceScore,
      is_recurring: input.isRecurring,
      is_all_day: input.isAllDay,
      metadata: input.metadata,
      status: input.status,
    });

    return EventType.toType(entity[0]);
  }

  @Mutation(() => EventType, { nullable: true })
  async updateEvent(
    @Context() context: RequestContext,
    @Args('input') input: UpdateEventInput,
  ): Promise<EventType | null> {
    const serviceContext = toServiceContext(context);

    const entity = await this.eventService.update(serviceContext, input.id, {
      title: input.title,
      description: input.description,
      event_type: input.eventType,
      category: input.category,
      start_time: input.startTime,
      end_time: input.endTime,
      duration_minutes: input.durationMinutes,
      location_name: input.locationName,
      location_coordinates: input.locationCoordinates,
      location_entity_id: input.locationEntityId,
      participant_entity_ids: input.participantEntityIds,
      organizer_entity_id: input.organizerEntityId,
      source_type: input.sourceType,
      source_id: input.sourceId,
      source_system: input.sourceSystem,
      confidence_score: input.confidenceScore,
      is_recurring: input.isRecurring,
      is_all_day: input.isAllDay,
      metadata: input.metadata,
      status: input.status,
    });

    return entity ? EventType.toType(entity) : entity;
  }

  @Mutation(() => Boolean)
  async removeEvent(@Context() context: RequestContext, @Args('id') id: string): Promise<boolean> {
    const serviceContext = toServiceContext(context);

    return this.eventService.remove(serviceContext, id);
  }

  @Query(() => EventConnection)
  async events(
    @Context() context: RequestContext,
    @Args() pagination: PaginationArgs,
  ): Promise<EventConnection> {
    const serviceContext = toServiceContext(context);

    const entities = await this.eventService.findAll(serviceContext);

    const { slice, pageInfo, totalCount } = Paginator.paginate(entities, {
      ...pagination,
      getId: (entity) => GlobalUID.encode('event', entity.id),
    });

    const edges: EventEdge[] = slice.map((entity) => {
      const node = EventType.toType(entity);

      return {
        node,
        cursor: node.id,
      };
    });

    return {
      edges,
      pageInfo,
      totalCount,
    };
  }

  @Query(() => EventType, { nullable: true })
  async event(
    @Context() context: RequestContext,
    @Args('id', { type: () => ID }) gid: string,
  ): Promise<EventType | null> {
    const serviceContext = toServiceContext(context);

    const id = GlobalUID.parse('event', gid);

    const entity = await this.eventService.findById(serviceContext, id);

    return entity ? EventType.toType(entity) : null;
  }
}
