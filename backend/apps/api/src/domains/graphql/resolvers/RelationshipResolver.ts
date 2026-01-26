import { UseGuards } from '@nestjs/common';
import { Mutation, Query, Resolver, Args, ID } from '@nestjs/graphql';

import { Context, type RequestContext, toServiceContext } from '@ci/common/context';
import { JwtAuthGuard } from '@ci/common/guards';
import { RelationshipService } from '@ci/domains/graph';
import { CreateRelationshipPayload } from '@ci/domains/graphql/types/CreateRelationshipPayload';
import { DeleteByIdInput } from '@ci/domains/graphql/types/DeleteByIdInput';
import { DeleteByIdPayload } from '@ci/domains/graphql/types/DeleteByIdPayload';
import { UpdateRelationshipPayload } from '@ci/domains/graphql/types/UpdateRelationshipPayload';

import { CreateRelationshipInput } from '../types/CreateRelationshipInput';
import { GlobalUID } from '../types/GlobalUID';
import { RelationshipType } from '../types/RelationshipType';
import { UpdateRelationshipInput } from '../types/UpdateRelationshipInput';

@UseGuards(JwtAuthGuard)
@Resolver(() => RelationshipType)
export class RelationshipResolver {
  constructor(private readonly relationshipService: RelationshipService) {}

  @Mutation(() => CreateRelationshipPayload)
  async createRelationship(
    @Context() context: RequestContext,
    @Args('input') input: CreateRelationshipInput,
  ): Promise<CreateRelationshipPayload> {
    const serviceContext = toServiceContext(context);

    const entity = await this.relationshipService.create(serviceContext, {
      fromNodeId: input.fromNodeId,
      toNodeId: input.toNodeId,
      type: input.type,
      strength: input.strength || 1,
      properties: input.properties || {},
      isBidirectional: input.isBidirectional || false,
      startDate: input.startDate,
      endDate: input.endDate,
    });

    if (entity == null) {
      return {
        success: false,
      };
    }

    return {
      success: true,
      relationship: entity ? RelationshipType.toType(entity) : undefined,
    };
  }

  @Mutation(() => UpdateRelationshipPayload)
  async updateRelationship(
    @Context() context: RequestContext,
    @Args('input') input: UpdateRelationshipInput,
  ): Promise<UpdateRelationshipPayload> {
    const serviceContext = toServiceContext(context);

    const id = GlobalUID.parse('relationship', input.id);

    const entity = await this.relationshipService.update(serviceContext, id, {
      strength: input.strength,
      properties: input.properties,
      isBidirectional: input.isBidirectional,
      startDate: input.startDate,
      endDate: input.endDate,
    });

    if (entity == null) {
      return {
        success: false,
      };
    }

    return {
      success: true,
      relationship: entity ? RelationshipType.toType(entity) : undefined,
    };
  }

  @Mutation(() => DeleteByIdPayload)
  async deleteRelationship(
    @Context() context: RequestContext,
    @Args('input') input: DeleteByIdInput,
  ): Promise<DeleteByIdPayload> {
    const serviceContext = toServiceContext(context);

    const id = GlobalUID.parse('relationship', input.id);

    const success = await this.relationshipService.delete(serviceContext, id);

    if (!success) {
      return {
        success: false,
      };
    }

    return {
      success,
      deletedId: input.id,
    };
  }

  @Query(() => RelationshipType, { nullable: true })
  async relationship(
    @Context() context: RequestContext,
    @Args('id', { type: () => ID }) gid: string,
  ): Promise<RelationshipType | null> {
    const serviceContext = toServiceContext(context);

    const id = GlobalUID.parse('relationship', gid);

    const entity = await this.relationshipService.findById(serviceContext, id);

    return entity ? RelationshipType.toType(entity) : null;
  }
}
