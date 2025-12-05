import { UseGuards } from '@nestjs/common';
import { Query, Resolver, Args, ID } from '@nestjs/graphql';

import { Context } from '@ci/common/decorators';
import { JwtAuthGuard } from '@ci/common/guards';
import { RequestContext } from '@ci/common/types';
import { toServiceContext } from '@ci/common/utils';
import { ItemService } from '@ci/domains/memory';

import { GlobalUID } from '../types/GlobalUID';
import { ItemConnection } from '../types/ItemConnection';
import { ItemEdge } from '../types/ItemEdge';
import { ItemType } from '../types/ItemType';
import { PaginationArgs } from '../types/PaginationArgs';
import { Paginator } from '../utils/Paginator';

@UseGuards(JwtAuthGuard)
@Resolver(() => ItemType)
export class ItemResolver {
  constructor(private readonly itemService: ItemService) {}

  @Query(() => ItemConnection)
  async items(
    @Context() context: RequestContext,
    @Args() pagination: PaginationArgs,
  ): Promise<ItemConnection> {
    const serviceContext = toServiceContext(context);

    const entities = await this.itemService.findAll(serviceContext);

    const { slice, pageInfo, totalCount } = Paginator.paginate(entities, {
      ...pagination,
      getId: (entity) => GlobalUID.encode('item', entity.id),
    });

    const edges: ItemEdge[] = slice.map((entity) => {
      const node = ItemType.toType(entity);

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

  @Query(() => ItemType, { nullable: true })
  async item(
    @Context() context: RequestContext,
    @Args('id', { type: () => ID }) gid: string,
  ): Promise<ItemType | null> {
    const serviceContext = toServiceContext(context);

    const id = GlobalUID.parse('item', gid);

    const entity = await this.itemService.findById(serviceContext, id);

    return entity ? ItemType.toType(entity) : null;
  }
}
