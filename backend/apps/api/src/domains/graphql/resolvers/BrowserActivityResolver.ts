import { UseGuards } from '@nestjs/common';
import { Query, Resolver, Args, ID } from '@nestjs/graphql';

import { Context, type RequestContext, toServiceContext } from '@ci/common/context';
import { JwtAuthGuard } from '@ci/common/guards';
import { BrowserActivityService } from '@ci/domains/browser-activity';

import { BrowserActivityConnection } from '../types/BrowserActivityConnection';
import { BrowserActivityEdge } from '../types/BrowserActivityEdge';
import { BrowserActivityType } from '../types/BrowserActivityType';
import { GlobalUID } from '../types/GlobalUID';
import { PaginationArgs } from '../types/PaginationArgs';
import { Paginator } from '../utils/Paginator';

@UseGuards(JwtAuthGuard)
@Resolver(() => BrowserActivityType)
export class BrowserActivityResolver {
  constructor(private readonly browserActivityService: BrowserActivityService) {}

  @Query(() => BrowserActivityConnection)
  async browserActivities(
    @Context() context: RequestContext,
    @Args() pagination: PaginationArgs,
  ): Promise<BrowserActivityConnection> {
    const serviceContext = toServiceContext(context);

    const entities = await this.browserActivityService.findAll(serviceContext);

    const { slice, pageInfo, totalCount } = Paginator.paginate(entities, {
      ...pagination,
      getId: (entity) => GlobalUID.encode('browser-activity', entity.id),
    });

    const edges: BrowserActivityEdge[] = slice.map((entity) => {
      const node = BrowserActivityType.toType(entity);

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

  @Query(() => BrowserActivityType, { nullable: true })
  async browserActivity(
    @Context() context: RequestContext,
    @Args('id', { type: () => ID }) gid: string,
  ): Promise<BrowserActivityType | null> {
    const serviceContext = toServiceContext(context);

    const id = GlobalUID.parse('browser-activity', gid);

    const entity = await this.browserActivityService.findById(serviceContext, id);

    return entity ? BrowserActivityType.toType(entity) : null;
  }
}
