import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DeleteResult, Repository } from 'typeorm';
import { v7 as uuidv7 } from 'uuid';

import { RequestContext } from '@ci/common/types';
import { ContentService } from '@ci/domains/memory/services/ContentService';

import { EventEntity } from '../entities/EventEntity';
import { CreateEventDto, UpdateEventDto, Event, Content } from '../types';

@Injectable()
export class EventService {
  constructor(
    @InjectRepository(EventEntity)
    private readonly eventRepository: Repository<EventEntity>,
    @Inject(ContentService)
    private readonly contentService: ContentService,
  ) {}

  async create(context: RequestContext, data: CreateEventDto | CreateEventDto[]): Promise<Event | Event[]> {
    const isSingle = !Array.isArray(data);
    const dataArray: CreateEventDto[] = isSingle ? [data] : data;

    const returned = await Promise.all(
      dataArray.map(async (item) => {
        let newContent;
        if (item.content) {
          newContent = (await Promise.all(
            item.content.map(async (content) => {
              return this.contentService.create(context, {
                ...content,
                id: uuidv7(),
                user: item.user,
              });
            }),
          )) as Content[];

          item.source_data = {
            related_objects: newContent.map((content) => `content_${content.id}`),
          };
        }

        const event = await this.eventRepository.create({
          ...item,
          id: uuidv7(),
        });

        const eventResult = await this.eventRepository.save(event);
        if (newContent) {
          await Promise.all(
            newContent.map(async (content) => {
              console.log('Calling contentService.update', context, content);

              return await this.contentService.update(context, content.id, {
                event: {
                  id: eventResult.id,
                },
              });
            }),
          );
        }

        return eventResult.toEvent();
      }),
    );

    return isSingle ? returned[0] : returned;
  }

  async findAll(context: RequestContext): Promise<Event[]> {
    const result = await this.eventRepository.find({
      where: {
        user: {
          id: context.userId,
        },
      },
    });

    return result.map((entity) => entity.toEvent());
  }

  async findOne(context: RequestContext, id: string): Promise<Event | null> {
    const result = await this.eventRepository.findOne({
      where: {
        id,
        user: {
          id: context.userId,
        },
      },
    });

    return result?.toEvent() ?? null;
  }

  async update(context: RequestContext, id: string, data: UpdateEventDto): Promise<Event | null> {
    await this.eventRepository.update(id, data);

    return this.findOne(context, id);
  }

  remove(id: string): Promise<DeleteResult> {
    return this.eventRepository.delete(id);
  }
}
