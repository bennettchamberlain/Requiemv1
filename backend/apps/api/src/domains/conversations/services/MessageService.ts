import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { v7 as uuid7 } from 'uuid';

import { RequestContext } from '@ci/common/types';
import { FileService } from '@ci/domains/files';

import { MessageEntity } from '../entities/MessageEntity';
import type { CreateMessageDto, Message, UpdateMessageDto } from '../types';

@Injectable()
export class MessageService {
  constructor(
    @InjectRepository(MessageEntity)
    private readonly messsageRepository: Repository<MessageEntity>,
    private readonly fileService: FileService,
  ) {}

  async create(context: RequestContext, data: CreateMessageDto): Promise<Message> {
    const { threadId, content, toolCalls, promptMessageId, fileIds, ...rest } = data;

    const instance = this.messsageRepository.create({
      ...rest,
      id: uuid7(),
      content,
      tool_calls: toolCalls,
      user: {
        id: context.userId,
      },
      thread: {
        id: threadId,
      },
      promptMessage: {
        id: promptMessageId,
      },
    });

    const entity = await this.messsageRepository.save(instance);

    // Link files to this message if provided
    if (fileIds && fileIds.length > 0) {
      const files = await this.fileService.findByIds(context, fileIds);

      if (files.length > 0) {
        await this.messsageRepository
          .createQueryBuilder()
          .relation(MessageEntity, 'files')
          .of(entity.id)
          .add(files.map((file) => file.id));
      }
    }

    return entity.toMessage();
  }

  exists(context: RequestContext, id: string): Promise<boolean> {
    return this.messsageRepository.exists({
      where: {
        id,
        user: {
          id: context.userId,
        },
        canceled: false,
      },
    });
  }

  async findOne(context: RequestContext, id: string): Promise<Message> {
    const entity = await this.messsageRepository.findOne({
      where: {
        id,
        user: {
          id: context.userId,
        },
        canceled: false,
      },
      relations: ['files'],
    });

    if (entity == null) {
      throw new NotFoundException();
    }

    return entity.toMessage();
  }

  async findAll(context: RequestContext): Promise<Message[]> {
    const entities = await this.messsageRepository.find({
      where: {
        user: {
          id: context.userId,
        },
        canceled: false,
      },
      relations: ['files'],
    });

    return entities.map((entity) => entity.toMessage());
  }

  async findByThread(context: RequestContext, threadId: string): Promise<Message[]> {
    const entities = await this.messsageRepository.find({
      where: {
        user: {
          id: context.userId,
        },
        thread: {
          id: threadId,
        },
        canceled: false,
      },
      relations: ['files'],
      order: {
        id: 'asc',
      },
    });

    return entities.map((entity) => entity.toMessage());
  }

  async findByThreads(context: RequestContext, threadIds: string[]): Promise<Map<string, Message[]>> {
    if (threadIds.length === 0) {
      return new Map();
    }

    const entities = await this.messsageRepository.find({
      where: {
        user: {
          id: context.userId,
        },
        thread: {
          id: In(threadIds),
        },
        canceled: false,
      },
    });

    const messagesByThread = new Map<string, Message[]>();

    threadIds.forEach((threadId) => {
      messagesByThread.set(threadId, []);
    });

    entities.forEach((entity) => {
      const threadId = entity.threadId;

      if (threadId) {
        const messages = messagesByThread.get(threadId) || [];

        messages.push(entity.toMessage());

        messagesByThread.set(threadId, messages);
      }
    });

    return messagesByThread;
  }

  async update(context: RequestContext, id: string, data: UpdateMessageDto): Promise<boolean> {
    const result = await this.messsageRepository.update(
      {
        id,
        user: {
          id: context.userId,
        },
        canceled: false,
      },
      data,
    );

    if (result.affected === 0) {
      throw new NotFoundException();
    }

    return true;
  }

  async softDelete(context: RequestContext, id: string): Promise<boolean> {
    const exists = await this.exists(context, id);

    if (!exists) {
      throw new NotFoundException();
    }

    const result = await this.messsageRepository.update(
      {
        id,
        user: {
          id: context.userId,
        },
      },
      {
        canceled: true,
      },
    );

    // The likelihood of this triggering is essentially 0%,
    // but we're still coding defensively.
    if (result.affected === 0) {
      throw new NotFoundException();
    }

    return true;
  }

  async delete(context: RequestContext, id: string): Promise<boolean> {
    const result = await this.messsageRepository.delete({
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
}
