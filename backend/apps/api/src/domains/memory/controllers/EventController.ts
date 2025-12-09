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
  NotFoundException,
  HttpStatus,
  HttpCode,
} from '@nestjs/common';
import { QueryFailedError } from 'typeorm';

import { PgErrorCode } from '@ci/common/constants';
import { Context } from '@ci/common/decorators';
import { JwtAuthGuard } from '@ci/common/guards';
import { ValidationPipe } from '@ci/common/pipes';
import { RequestContext } from '@ci/common/types';
import { toServiceContext } from '@ci/common/utils';

import { Content } from '../entities/ContentEntity';
import { ContentService } from '../services/ContentService';
import { EventService } from '../services/EventService';
import { CreateEventDto, UpdateEventDto, createEventSchema, updateEventSchema } from '../types';

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
          const newEvent = (await this.eventService.create(serviceContext, event))[0];

          if (contentInput) {
            const contentInputForEvent = contentInput.map((input) => ({
              ...input,
              event: { id: newEvent.id },
            }));

            const contentArray = (await this.contentService.create(
              serviceContext,
              contentInputForEvent,
            )) as Content[];

            return this.eventService.update(serviceContext, newEvent.id, {
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
  async findAll(@Context() context: RequestContext) {
    const serviceContext = toServiceContext(context);

    return this.eventService.findAll(serviceContext);
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id')
  async findById(@Param('id') id: string, @Context() context: RequestContext) {
    const serviceContext = toServiceContext(context);

    const result = await this.eventService.findById(serviceContext, id);

    if (!result) {
      throw new NotFoundException('Event not found');
    }

    return result;
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body(new ValidationPipe(updateEventSchema)) input: UpdateEventDto,
    @Context() context: RequestContext,
  ) {
    const serviceContext = toServiceContext(context);

    const result = await this.eventService.update(serviceContext, id, input);

    if (!result) {
      throw new NotFoundException('Event not found');
    }

    return result;
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Context() context: RequestContext, @Param('id') id: string) {
    const serviceContext = toServiceContext(context);

    const event = await this.eventService.findById(serviceContext, id);

    if (!event) {
      throw new NotFoundException('Event not found');
    }

    const removal = await this.eventService.remove(serviceContext, id);

    if (!removal) {
      throw new NotFoundException('Event not found');
    }
  }
}
