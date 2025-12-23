import { UseGuards } from '@nestjs/common';
import { Args, ID, Parent, Query, Resolver, ResolveField } from '@nestjs/graphql';

import { Context, type RequestContext, toServiceContext } from '@ci/common/context';
import { JwtAuthGuard } from '@ci/common/guards';
import { ContentService } from '@ci/domains/memory';

import { ContentConnection } from '../types/ContentConnection';
import { TagLoader } from '../loaders/TagLoader';
import { ContentEdge } from '../types/ContentEdge';
import { ContentType } from '../types/ContentType';
import { GlobalUID } from '../types/GlobalUID';
import { PaginationArgs } from '../types/PaginationArgs';
import { Paginator } from '../utils/Paginator';
import { EntityTagType } from '../types/EntityTagType'

@UseGuards(JwtAuthGuard)
@Resolver(() => ContentType)
export class ContentResolver {
  constructor(
    private readonly contentService: ContentService,
    private readonly tagLoader: TagLoader,
  ) {}

  @Query(() => ContentConnection)
  async contents(
    @Context() context: RequestContext,
    @Args() pagination: PaginationArgs,
  ): Promise<ContentConnection> {
    const serviceContext = toServiceContext(context);

    const entities = await this.contentService.findAll(serviceContext);

    const { slice, pageInfo, totalCount } = Paginator.paginate(entities, {
      ...pagination,
      getId: (entity) => GlobalUID.encode('content', entity.id),
    });

    const edges: ContentEdge[] = slice.map((entity) => {
      const node = ContentType.toType(entity);

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

  @Query(() => ContentType, { nullable: true })
  async content(
    @Context() context: RequestContext,
    @Args('id', { type: () => ID }) gid: string,
  ): Promise<ContentType | null> {
    const serviceContext = toServiceContext(context);

    const id = GlobalUID.parse('content', gid);

    const entity = await this.contentService.findById(serviceContext, id);

    return entity ? ContentType.toType(entity) : null;
  }

  @ResolveField(() => [EntityTagType])
  async tags(@Context() context: RequestContext, @Parent() parent: ContentType): Promise<EntityTagType[]> {
    const serviceContext = toServiceContext(context);

    const tags = await this.tagLoader.load(serviceContext, {
      type: 'action',
      id: parent.__source.id,
    });

    return tags.map((tag) => EntityTagType.toType(tag));
  }
}
