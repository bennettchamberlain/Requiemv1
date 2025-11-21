import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v7 as uuid7 } from 'uuid';

import { LoggerService } from '@ci/common/services';
import { RequestContext } from '@ci/common/types';
import { EventService } from '@ci/domains/events';
import { UserService } from '@ci/domains/user';

import { PersonEntity } from '../entities/PersonEntity';
import { CreatePersonDto, UpdatePersonDto } from '../types';

@Injectable()
export class PersonService {
  private logger = new LoggerService(PersonService.name);

  constructor(
    @InjectRepository(PersonEntity)
    private readonly personRepository: Repository<PersonEntity>,
    private readonly userService: UserService,
    private readonly eventService: EventService,
  ) {}

  async create(context: RequestContext, data: CreatePersonDto): Promise<PersonEntity> {
    const entity = await this.personRepository.create({
      id: data.id || uuid7(),
      name: data.name,
      description: data.description,
      linked_table: data.linkedTable,
      linked_id: data.linkedId,
      entity_type: 'Person',
      search_content: data.searchContent,
      last_accessed: data.lastAccessed,
      user: {
        id: context.userId,
      },
      properties: data.properties || [],
    });

    return this.personRepository.save(entity);
  }

  async findOne(context: RequestContext, id: string): Promise<PersonEntity | null> {
    return this.personRepository.findOne({
      where: {
        id,
        user: {
          id: context.userId,
        },
      },
    });
  }

  async findAll(context: RequestContext): Promise<PersonEntity[]> {
    return this.personRepository.find({
      where: {
        entity_type: 'Person',
        user: {
          id: context.userId,
        },
      },
    });
  }

  async update(context: RequestContext, id: string, data: UpdatePersonDto): Promise<PersonEntity> {
    const existingEntity = await this.findOne(context, id);
    if (!existingEntity) {
      throw new NotFoundException();
    }

    const updatedEntity = {
      ...existingEntity,
      name: data.name,
      description: data.description,
      search_content: data.searchContent,
      linked_id: data.linkedId,
      linked_table: data.linkedTable,
      last_accessed: data.lastAccessed,
      properties: data.properties,
      user: {
        id: context.userId,
      },
    };

    return this.personRepository.save(updatedEntity!);
  }

  async delete(context: RequestContext, id: string): Promise<boolean> {
    const result = await this.personRepository.delete({
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

  async search(context: RequestContext, query: UpdatePersonDto): Promise<PersonEntity[]> {
    let executable = this.personRepository
      .createQueryBuilder('entity')
      .where('owner_user_id = :userId', { userId: context.userId });

    if (query.name) {
      executable = executable.andWhere('name = :name', { name: query.name });
    }

    if (query.description) {
      executable = executable.andWhere('description = :description', { description: query.description });
    }

    if (query.linkedId) {
      executable = executable.andWhere('linked_id = :linkedId', { linkedId: query.linkedId });
    }

    if (query.linkedTable) {
      executable = executable.andWhere('linked_table = :linkedTable', { linkedTable: query.linkedTable });
    }

    if (query.properties) {
      for (const [key, val] of Object.entries(query.properties)) {
        executable = executable.andWhere(`entity.properties->>'${key}' = :${key}`, { [key]: val });
      }
    }

    return executable.getMany();
  }
}
