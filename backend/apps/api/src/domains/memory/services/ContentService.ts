import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DeleteResult, Repository } from 'typeorm';
import { v7 as uuidv7 } from 'uuid';

import config from '@ci/configuration';

import { ContentEntity } from '../entities/ContentEntity';
import { CreateContentDto, UpdateContentDto, Content } from '../types';

@Injectable()
export class ContentService {
  constructor(
    @InjectRepository(ContentEntity)
    private readonly contentRepository: Repository<ContentEntity>,
  ) {}

  async create(data: CreateContentDto): Promise<Content> {

    const content = this.contentRepository.create({
      ...data,
      id: uuidv7()
    });

    const contentResult = await this.contentRepository.save(content);

    return contentResult.toContent();
  }

  async findAll(): Promise<Content[]> {
    const result = await this.contentRepository.find();

    return result.map((entity) => entity.toContent());
  }

  async findOne(id: string): Promise<Content | null> {
    const result = await this.contentRepository.findOne({
      where: {
        id,
      },
    });

    return result?.toContent() ?? null;
  }

  async update(id: string, data: UpdateContentDto): Promise<Content | null> {
    await this.contentRepository.update(id, data);

    return this.findOne(id);
  }

  remove(id: string): Promise<DeleteResult> {
    return this.contentRepository.delete(id);
  }
}
