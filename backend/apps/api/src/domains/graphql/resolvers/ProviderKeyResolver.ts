import { UseGuards } from '@nestjs/common';
import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';

import { Context, type RequestContext, toServiceContext } from '@ci/common/context';
import { JwtAuthGuard } from '@ci/common/guards';
import { ProviderKeyService } from '@ci/domains/connections';

import { CreateProviderKeyInput } from '../inputs/CreateProviderKeyInput';
import { UpdateProviderKeyInput } from '../inputs/UpdateProviderKeyInput';
import { GlobalUID } from '../types/GlobalUID';
import { PaginationArgs } from '../types/PaginationArgs';
import { ProviderKeyConnection } from '../types/ProviderKeyConnection';
import { ProviderKeyEdge } from '../types/ProviderKeyEdge';
import { ProviderKeyType } from '../types/ProviderKeyType';
import { Paginator } from '../utils/Paginator';

@UseGuards(JwtAuthGuard)
@Resolver()
export class ProviderKeyResolver {
  constructor(private readonly providerKeyService: ProviderKeyService) {}

  @Query(() => ProviderKeyConnection)
  async providerKeys(
    @Context() context: RequestContext,
    @Args() pagination: PaginationArgs,
  ): Promise<ProviderKeyConnection> {
    const serviceContext = toServiceContext(context);

    const entities = await this.providerKeyService.findAll(serviceContext);

    const { slice, pageInfo, totalCount } = Paginator.paginate(entities, {
      ...pagination,
      getId: (entity) => GlobalUID.encode('provider-key', entity.id),
    });

    const edges: ProviderKeyEdge[] = slice.map((entity) => {
      const node = ProviderKeyType.toType(entity);

      return {
        node,
        cursor: node.id,
      };
    });

    return {
      edges,
      pageInfo,
      totalCount,
    };
  }

  @Query(() => ProviderKeyType, { nullable: true })
  async providerKey(
    @Context() context: RequestContext,
    @Args('id', { type: () => ID }) id: string,
  ): Promise<ProviderKeyType | null> {
    const serviceContext = toServiceContext(context);
    const { id: decodedId } = GlobalUID.decode(id);

    const entity = await this.providerKeyService.findById(serviceContext, decodedId);

    return entity ? ProviderKeyType.toType(entity) : null;
  }

  @Mutation(() => ProviderKeyType)
  async createProviderKey(
    @Context() context: RequestContext,
    @Args('input') input: CreateProviderKeyInput,
  ): Promise<ProviderKeyType> {
    const serviceContext = toServiceContext(context);
    const { id: providerId } = GlobalUID.decode(input.providerId);

    const entity = await this.providerKeyService.create(serviceContext, {
      providerId,
      clientId: input.clientId,
      clientSecret: input.clientSecret,
    });

    return ProviderKeyType.toType(entity);
  }

  @Mutation(() => ProviderKeyType, { nullable: true })
  async updateProviderKey(
    @Context() context: RequestContext,
    @Args('id', { type: () => ID }) id: string,
    @Args('input') input: UpdateProviderKeyInput,
  ): Promise<ProviderKeyType | null> {
    const serviceContext = toServiceContext(context);
    const { id: decodedId } = GlobalUID.decode(id);

    const entity = await this.providerKeyService.update(serviceContext, decodedId, input);

    return entity ? ProviderKeyType.toType(entity) : null;
  }

  @Mutation(() => Boolean)
  async deleteProviderKey(
    @Context() context: RequestContext,
    @Args('id', { type: () => ID }) id: string,
  ): Promise<boolean> {
    const serviceContext = toServiceContext(context);
    const { id: decodedId } = GlobalUID.decode(id);

    return this.providerKeyService.delete(serviceContext, decodedId);
  }
}
