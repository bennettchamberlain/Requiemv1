import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, LessThan, Repository } from 'typeorm';
import { v7 as uuidv7 } from 'uuid';

import { SYSTEM_USER, UserServiceContext, type ServiceContext } from '@ci/common/context';
import { LoggerService } from '@ci/common/logging';
import { EventService } from '@ci/domains/events';

import { type Note, NoteEntity } from '../entities/NoteEntity';
import { NoteCreatedEvent, NoteUpdatedEvent, NoteRemovedEvent } from '../events';
import type { CreateNoteDto, UpdateNoteDto } from '../types';

@Injectable()
export class NoteService {
  constructor(
    @InjectRepository(NoteEntity)
    private readonly noteRepository: Repository<NoteEntity>,
    private readonly eventService: EventService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(NoteService.name);
  }

  async create(context: UserServiceContext, data: CreateNoteDto): Promise<Note | null> {
    const record = this.noteRepository.create({
      id: data.id || uuidv7(),
      ...data,
      userId: context.userId,
    });

    const entity = await this.noteRepository.save(record);

    await this.eventService.send(NoteCreatedEvent, {
      noteId: entity.id,
    });

    return NoteEntity.toEgressType(entity);
  }

  async findById(context: ServiceContext, id: string): Promise<Note | null> {
    const entity = await this.noteRepository.findOne({
      where: {
        id,
        ...(context.userId !== SYSTEM_USER && {
          userId: context.userId,
        }),
      },
    });

    return entity ? NoteEntity.toEgressType(entity) : null;
  }

  async findByIds(context: ServiceContext, ids: string[]): Promise<(Note | null)[]> {
    const results = await this.noteRepository.find({
      where: {
        id: In(ids),
        ...(context.userId !== SYSTEM_USER && {
          userId: context.userId,
        }),
      },
    });

    const map = new Map(results.map((entity) => [entity.id, NoteEntity.toEgressType(entity)]));

    return ids.map((id) => map.get(id) ?? null);
  }

  async findAll(context: ServiceContext, options?: { take?: number }): Promise<Note[]> {
    const results = await this.noteRepository.find({
      where: {
        ...(context.userId !== SYSTEM_USER && {
          userId: context.userId,
        }),
      },
      order: {
        updatedAt: 'DESC',
      },
      ...(options?.take && { take: options.take }),
    });

    return results.map((entity) => NoteEntity.toEgressType(entity));
  }

  async update(context: ServiceContext, id: string, data: UpdateNoteDto): Promise<Note | null> {
    const record = await this.noteRepository.findOne({
      where: {
        id,
        ...(context.userId !== SYSTEM_USER && {
          userId: context.userId,
        }),
      },
    });

    if (record == null) {
      return null;
    }

    Object.assign(record, data);

    const updatedEntity = await this.noteRepository.save(record);

    await this.eventService.send(NoteUpdatedEvent, {
      noteId: updatedEntity.id,
    });

    return NoteEntity.toEgressType(updatedEntity);
  }

  /**
   * Returns unprocessed note fragments (processedAt IS NULL) older than the
   * minimum age threshold, ordered oldest-first.  Pass SYSTEM_USER context to
   * query across all users (used by the memory compaction cron).
   */
  async findUnprocessed(
    context: ServiceContext,
    options: { limit?: number; minAgeMinutes?: number } = {},
  ): Promise<Note[]> {
    const { limit = 50, minAgeMinutes = 2 } = options;
    const cutoff = new Date(Date.now() - minAgeMinutes * 60 * 1000);

    const results = await this.noteRepository.find({
      where: {
        ...(context.userId !== SYSTEM_USER && { userId: context.userId }),
        processedAt: IsNull(),
        createdAt: LessThan(cutoff),
      },
      order: { createdAt: 'ASC' },
      take: limit,
    });

    return results.map((entity) => NoteEntity.toEgressType(entity));
  }

  /**
   * Stamps processed_at = NOW() on a batch of note IDs.
   * Scoped to the context's userId (use SYSTEM_USER to mark across all users).
   */
  async markProcessed(context: ServiceContext, ids: string[]): Promise<void> {
    if (ids.length === 0) {
      return;
    }

    await this.noteRepository.update(
      {
        id: In(ids),
        ...(context.userId !== SYSTEM_USER && { userId: context.userId }),
      },
      { processedAt: new Date() },
    );
  }

  async remove(context: ServiceContext, id: string): Promise<boolean> {
    const result = await this.noteRepository.delete({
      id,
      ...(context.userId !== SYSTEM_USER && {
        userId: context.userId,
      }),
    });

    if (result.affected != null && result.affected > 0) {
      await this.eventService.send(NoteRemovedEvent, {
        noteId: id,
      });

      return true;
    }

    return false;
  }
}
