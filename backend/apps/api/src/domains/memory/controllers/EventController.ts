import {
  ConflictException,
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Req,
  UseGuards,
  UnauthorizedException,
} from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { z } from 'zod';

import { PgErrorCode } from '@ci/common/constants';
import { Context } from '@ci/common/decorators';
import { JwtAuthGuard } from '@ci/common/guards';
import { ValidationPipe } from '@ci/common/pipes';
import { RequestContext } from '@ci/common/types';

import { ContentService } from '../services/ContentService';
import { EventService } from '../services/EventService';
import { CreateEventDto, UpdateEventDto } from '../types';
import { Content } from '../entities/ContentEntity'

import { createContentSchema } from './ContentController';
import {toServiceContext} from "@ci/common/utils";

const createEventSchemaRoot = z.object({
  title: z.string(),
  description: z.string().optional(),
  event_type: z.string().optional(),
  category: z.string().optional(),
  start_time: z.string().datetime(),
  end_time: z.string().datetime().optional(),
  location_name: z.string().optional(),
  location_coordinates: z
    .object({
      type: z.string(),
      coordinates: z.array(z.number()),
    })
    .optional(),
  event_entity_id: z.string().optional(),
  location_entity_id: z.string().optional(),
  participant_entity_ids: z.array(z.string()).optional(),
  organizer_entity_id: z.string().optional(),
  source_type: z.string().optional(),
  source_system: z.string().optional(),
  source_id: z.string().optional(),
  confidence_score: z.number().optional(),
  is_recurring: z.boolean().optional(),
  recurrence_pattern: z.record(z.unknown()).optional(),
  is_all_day: z.boolean().optional(),
  is_private: z.boolean().optional(),
  priority: z.number().optional(),
  metadata: z.record(z.unknown()).optional(),
  is_predicted: z.boolean().optional(),
  is_inferred: z.boolean().optional(),
  prediction_model: z.string().optional(),
  inference_sources: z.record(z.unknown()).optional(),
  tags: z.array(z.string()).optional(),
  sentiment_score: z.number().optional(),
  energy_level: z.number().optional(),
  productivity_impact: z.number().optional(),
  status: z.string().optional(),
  is_deleted: z.boolean().optional(),
  external_sync_status: z.string().optional(),
  last_synced_at: z.string().datetime().optional(),
  parent_event_id: z.string().optional(),
  related_event_ids: z.array(z.string()).optional(),
  supersedes_event_id: z.string().optional(),
  created_by: z.string().optional(),
  content: z.array(createContentSchema).optional(),
});

const createEventSchema = z.union([createEventSchemaRoot, z.array(createEventSchemaRoot)]);

const updateEventSchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  event_type: z.string().optional(),
  category: z.string().optional(),
  start_time: z.string().datetime().optional(),
  end_time: z.string().datetime().optional(),
  location_name: z.string().optional(),
  event_entity_id: z.string().optional(),
  location_entity_id: z.string().optional(),
  location_coordinates: z
    .object({
      type: z.string(),
      coordinates: z.array(z.number()),
    })
    .optional(),
  participant_entity_ids: z.array(z.string()).optional(),
  organizer_entity_id: z.string().optional(),
  source_type: z.string().optional(),
  source_system: z.string().optional(),
  source_id: z.string().optional(),
  confidence_score: z.number().optional(),
  is_recurring: z.boolean().optional(),
  recurrence_pattern: z.record(z.unknown()).optional(),
  is_all_day: z.boolean().optional(),
  is_private: z.boolean().optional(),
  priority: z.number().optional(),
  metadata: z.record(z.unknown()).optional(),
  is_predicted: z.boolean().optional(),
  is_inferred: z.boolean().optional(),
  prediction_model: z.string().optional(),
  inference_sources: z.record(z.unknown()).optional(),
  tags: z.array(z.string()).optional(),
  sentiment_score: z.number().optional(),
  energy_level: z.number().optional(),
  productivity_impact: z.number().optional(),
  status: z.string().optional(),
  is_deleted: z.boolean().optional(),
  external_sync_status: z.string().optional(),
  last_synced_at: z.string().datetime().optional(),
  parent_event_id: z.string().optional(),
  related_event_ids: z.array(z.string()).optional(),
  supersedes_event_id: z.string().optional(),
  created_by: z.string().optional(),
  content: z.array(createContentSchema).optional(),
});

@Controller('events')
export class EventController {
  constructor(
    private readonly eventService: EventService,
    private readonly contentService: ContentService,
  ) {}

  @UseGuards(JwtAuthGuard)
  @Post()
  async create(
    @Req() req: Request,
    @Context() context: RequestContext,
    @Body(new ValidationPipe(createEventSchema)) input: CreateEventDto | CreateEventDto[],
  ) {
    const serviceContext = toServiceContext(context);

    if (!context.userId) {
      throw new UnauthorizedException();
    }

    try {
      const isSingle = !Array.isArray(input);
      let dataArray: CreateEventDto[] = isSingle ? [input] : input;

      dataArray = dataArray.map((item) => {
        item.user = { id: context.userId! };

        return item;
      });

      const returned = await Promise.all(
        dataArray.map(async (item) => {
          const { content: contentInput, ...event } = item;
          const newEvent = (await this.eventService.create(context, event))[0];

          if (contentInput) {
            const contentInputForEvent = contentInput.map((input) => ({
              ...input,
              event: { id: newEvent.id },
            }));

            const contentArray = (await this.contentService.create(
              serviceContext,
              contentInputForEvent,
            )) as Content[];

            return this.eventService.update(context, newEvent.id, {
              metadata: {
                ...newEvent.metadata,
                related_objects: contentArray.map((content) => `content_${content.id}`),
              },
            });
          } else {
            return newEvent;
          }
        }),
      );

      return isSingle ? returned[0] : returned;
    } catch (error) {
      if (error instanceof QueryFailedError && error.driverError?.code === PgErrorCode.UNIQUE_VIOLATION) {
        // TODO: Obfuscate this error message? We're revealing DB details here.
        throw new ConflictException(error.message);
      }

      throw error;
    }
  }

  @UseGuards(JwtAuthGuard)
  @Get()
  findAll(@Context() context: RequestContext) {
    return this.eventService.findAll(context);
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id')
  findOne(@Param('id') id: string, @Context() context: RequestContext) {
    return this.eventService.findOne(context, id);
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body(new ValidationPipe(updateEventSchema)) input: UpdateEventDto,
    @Context() context: RequestContext,
  ) {
    try {
      return await this.eventService.update(context, id, input);
    } catch (error) {
      if (error instanceof QueryFailedError && error.driverError?.code === PgErrorCode.UNIQUE_VIOLATION) {
        // TODO: Obfuscate this error message? We're revealing DB details here.
        throw new ConflictException(error.message);
      }

      throw error;
    }
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.eventService.remove(id);
  }
}
