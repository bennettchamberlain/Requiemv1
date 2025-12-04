import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DeleteResult, Repository, In } from 'typeorm';
import { v7 as uuidv7 } from 'uuid';

import type { ServiceContext, UserServiceContext } from '@ci/common/types';

import { ContentEntity, Content } from '../entities/ContentEntity';
import { CreateContentDto, UpdateContentDto } from '../types';
import {SYSTEM_USER} from "@ci/common/types";

@Injectable()
export class ContentService {
  constructor(
    @InjectRepository(ContentEntity)
    private readonly contentRepository: Repository<ContentEntity>,
  ) {}

  async create(context: UserServiceContext, data: CreateContentDto | CreateContentDto[]): Promise<Content[]> {
    const isSingle = !Array.isArray(data);
    const dataArray: CreateContentDto[] = isSingle ? [data] : data;

    // TODO: Some of these can fail, we need to return partial success here?
    return Promise.all(
      dataArray.map(async (item) => {
        const content = await this.contentRepository.create({
          ...item,
          id: uuidv7(),
          user: {
            id: context.userId,
          },
        });

        const contentResult = await this.contentRepository.save(content);

        await this.contentRepository.update(contentResult.id, {
          externalId: `content_${contentResult.id}`,
        });

        return ContentEntity.toEgressType(contentResult);
      }),
    );
  }

  async findAll(context: UserServiceContext): Promise<Content[]> {
    const result = await this.contentRepository.find({
      where: {
        user: {
          id: context.userId,
        },
      },
    });

    return result.map((entity) => ContentEntity.toEgressType(entity));
  }

  async findById(context: ServiceContext, id: string): Promise<Content | null> {
    const result = await this.contentRepository.findOne({
      where: {
        id,
        ...(context.userId !== SYSTEM_USER && {
          user_id: context.userId,
        }),
      },
    });

    return result ? ContentEntity.toEgressType(result) : null;
  }

  async findByIds(context: ServiceContext, ids: string[]) {
    const result = await this.contentRepository.find({
      where: {
        id: In(ids),
        ...(context.userId !== SYSTEM_USER && {
          user_id: context.userId,
        }),
      },
    });

    return result.map(content => ContentEntity.toEgressType(content));
  }

  async update(context: ServiceContext, id: string, data: UpdateContentDto): Promise<Content | null> {
    await this.contentRepository.update(id, data);

    return this.findById(context, id);
  }

  remove(context: ServiceContext, id: string): Promise<DeleteResult> {
    return this.contentRepository.delete(id);
  }
}
