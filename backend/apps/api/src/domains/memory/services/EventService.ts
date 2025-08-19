import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DeleteResult, Repository } from 'typeorm';
import { v7 as uuidv7 } from 'uuid';

import config from '@ci/configuration';

import { EventEntity } from '../entities/EventEntity';
import { CreateEventDto, UpdateEventDto, Event } from '../types';

@Injectable()
export class EventService {
  constructor(
    @InjectRepository(EventEntity)
    private readonly eventRepository: Repository<EventEntity>,
  ) {}

  async create(data: CreateEventDto): Promise<Event> {
    const event = this.eventRepository.create({
      ...data,
      id: uuidv7()
    });

    const eventResult = await this.eventRepository.save(event);

    return eventResult.toEvent();
  }

  async findAll(): Promise<Event[]> {
    const result = await this.eventRepository.find();

    return result.map((entity) => entity.toEvent());
  }

  async findOne(id: string): Promise<Event | null> {
    const result = await this.eventRepository.findOne({
      where: {
        id,
      },
    });

    return result?.toEvent() ?? null;
  }

  async update(id: string, data: UpdateEventDto): Promise<Event | null> {
    await this.eventRepository.update(id, data);

    return this.findOne(id);
  }

  remove(id: string): Promise<DeleteResult> {
    return this.eventRepository.delete(id);
  }
}
