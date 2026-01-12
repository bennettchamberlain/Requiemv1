import { UseGuards } from '@nestjs/common';
import { Mutation, Query, Resolver, Args, ID } from '@nestjs/graphql';

import { Context, type RequestContext, toServiceContext } from '@ci/common/context';
import { JwtAuthGuard } from '@ci/common/guards';
import { SavedSearchService } from '@ci/domains/files';

import { SavedSearchConnection } from '../types/SavedSearchConnection';
import { SavedSearchEdge } from '../types/SavedSearchEdge';
import { SavedSearchType } from '../types/SavedSearchType';
import { CreateSavedSearchInput } from '../types/CreateSavedSearchInput';
import { GlobalUID } from '../types/GlobalUID';
import { PaginationArgs } from '../types/PaginationArgs';
import { UpdateSavedSearchInput } from '../types/UpdateSavedSearchInput';
import { Paginator } from '../utils/Paginator';

@UseGuards(JwtAuthGuard)
@Resolver(() => SavedSearchType)
export class SavedSearchResolver {
  constructor(
    private readonly savedSearchService: SavedSearchService,
  ) {}

  @Mutation(() => SavedSearchType)
  async createSavedSearch(
    @Context() context: RequestContext,
    @Args('input') input: CreateSavedSearchInput,
  ): Promise<SavedSearchType> {
    const serviceContext = toServiceContext(context);

    const entity = await this.savedSearchService.create(serviceContext, {
      name: input.name,
      description: input.description,
      query: input.query,
      entityTypes: input.entityTypes,
      tags: input.tags,
    });

    return SavedSearchType.toType(entity);
  }

  @Mutation(() => SavedSearchType, { nullable: true })
  async updateSavedSearch(
    @Context() context: RequestContext,
    @Args('input') input: UpdateSavedSearchInput,
  ): Promise<SavedSearchType | null> {
    const serviceContext = toServiceContext(context);

    const entity = await this.savedSearchService.update(serviceContext, input.id, {
      name: input.name,
      description: input.description,
      query: input.query,
      entityTypes: input.entityTypes,
      tags: input.tags,
    });

    return entity ? SavedSearchType.toType(entity) : entity;
  }

  @Mutation(() => Boolean)
  async removeSavedSearch(@Context() context: RequestContext, @Args('id') id: string): Promise<boolean> {
    const serviceContext = toServiceContext(context);

    return this.savedSearchService.remove(serviceContext, id);
  }

  @Query(() => SavedSearchConnection)
  async savedSearchs(
    @Context() context: RequestContext,
    @Args() pagination: PaginationArgs,
  ): Promise<SavedSearchConnection> {
    const serviceContext = toServiceContext(context);

    const entities = await this.savedSearchService.findAll(serviceContext);

    const { slice, pageInfo, totalCount } = Paginator.paginate(entities, {
      ...pagination,
      getId: (entity) => GlobalUID.encode('savedSearch', entity.id),
    });

    const edges: SavedSearchEdge[] = slice.map((entity) => {
      const node = SavedSearchType.toType(entity);

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

  @Query(() => SavedSearchType, { nullable: true })
  async savedSearch(
    @Context() context: RequestContext,
    @Args('id', { type: () => ID }) gid: string,
  ): Promise<SavedSearchType | null> {
    const serviceContext = toServiceContext(context);

    const id = GlobalUID.parse('savedSearch', gid);

    const entity = await this.savedSearchService.findById(serviceContext, id);

    return entity ? SavedSearchType.toType(entity) : null;
  }
}
