import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { v7 as uuidv7 } from 'uuid';

import { SYSTEM_USER, UserServiceContext, type ServiceContext } from '@ci/common/context';

import { type Relationship, RelationshipEntity } from '../entities/RelationshipEntity';
import type { CreateRelationshipDto, UpdateRelationshipDto } from '../types';

import { NodeService } from './NodeService';

@Injectable()
export class RelationshipService {
  constructor(
    @InjectRepository(RelationshipEntity)
    private readonly relationshipRepository: Repository<RelationshipEntity>,
    private readonly nodeService: NodeService,
  ) {}

  async create(context: UserServiceContext, data: CreateRelationshipDto): Promise<Relationship> {
    const [fromNode, toNode] = await this.nodeService.findByIds(context, [data.fromNodeId, data.toNodeId]);

    if (fromNode == null) {
      throw new Error(`Node with id ${data.fromNodeId} not found`);
    }

    if (toNode == null) {
      throw new Error(`Node with id ${data.toNodeId} not found`);
    }

    const record = this.relationshipRepository.create({
      id: uuidv7(),
      ...data,
      userId: context.userId,
    });

    const entity = await this.relationshipRepository.save(record);

    return RelationshipEntity.toEgressType(entity);
  }

  // There are some relationships where multiple identical relationships should
  // not exist. For example, a user should not have multiple "FRIENDS_WITH"
  // relationships to the same person. This upsert method checks for existing
  // relationships by type, and start and end node ids before creating a new
  // one.
  //
  // Note that there are some cases where a start date should only be updated if
  // the new date is earlier than the existing one, or an end date should only
  // be updated if the new date is later than the existing one. This logic is
  // not implemented here, but could be added in the future if needed. E.g. is
  // discovering friends from different social media sources.
  async upsert(context: UserServiceContext, data: CreateRelationshipDto): Promise<Relationship> {
    const [fromNode, toNode] = await this.nodeService.findByIds(context, [data.fromNodeId, data.toNodeId]);

    if (fromNode == null) {
      throw new Error(`Node with id ${data.fromNodeId} not found`);
    }

    if (toNode == null) {
      throw new Error(`Node with id ${data.toNodeId} not found`);
    }

    let record = await this.relationshipRepository.findOne({
      where: {
        fromNodeId: data.fromNodeId,
        toNodeId: data.toNodeId,
        type: data.type,
        userId: context.userId,
      },
    });

    if (record == null) {
      record = this.relationshipRepository.create({
        id: uuidv7(),
        ...data,
        userId: context.userId,
      });
    } else {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { id, properties, type, toNodeId, fromNodeId, ...updateData } = data;

      Object.assign(record, updateData);

      // TODO: Merge properties instead of ignoring them.
    }

    const entity = await this.relationshipRepository.save(record);

    return RelationshipEntity.toEgressType(entity);
  }

  async findById(context: ServiceContext, id: string): Promise<Relationship | null> {
    const entity = await this.relationshipRepository.findOne({
      where: {
        id,
        ...(context.userId !== SYSTEM_USER && {
          userId: context.userId,
        }),
      },
    });

    return entity ? RelationshipEntity.toEgressType(entity) : null;
  }

  async findByIds(context: ServiceContext, ids: string[]): Promise<(Relationship | null)[]> {
    const results = await this.relationshipRepository.find({
      where: {
        id: In(ids),
        ...(context.userId !== SYSTEM_USER && {
          userId: context.userId,
        }),
      },
    });

    const map = new Map(results.map((entity) => [entity.id, RelationshipEntity.toEgressType(entity)]));

    return ids.map((id) => map.get(id) ?? null);
  }

  async update(
    context: ServiceContext,
    id: string,
    data: UpdateRelationshipDto,
  ): Promise<Relationship | null> {
    const record = await this.relationshipRepository.findOne({
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

    const updatedEntity = await this.relationshipRepository.save(record);

    return RelationshipEntity.toEgressType(updatedEntity);
  }

  async delete(context: ServiceContext, id: string): Promise<boolean> {
    const result = await this.relationshipRepository.delete({
      id,
      ...(context.userId !== SYSTEM_USER && {
        userId: context.userId,
      }),
    });

    return result.affected != null && result.affected > 0;
  }
}
