import { UseGuards } from '@nestjs/common';
import { Query, Resolver, Args } from '@nestjs/graphql';

import { Context } from '@ci/common/decorators';
import { GqlJwtAuthGuard } from '@ci/common/guards';
import { RequestContext } from '@ci/common/types';
import { ThreadService } from '@ci/domains/conversations';

import { ThreadType } from '../types/ThreadType';

@UseGuards(GqlJwtAuthGuard)
@Resolver(() => ThreadType)
export class ThreadResolver {
  constructor(private readonly threadService: ThreadService) {}

  @Query(() => [ThreadType])
  async threads(@Context() context: RequestContext): Promise<ThreadType[]> {
    const threads = await this.threadService.findAll(context);

    return threads.map((thread) => ThreadType.fromThread(thread));
  }

  @Query(() => ThreadType, { nullable: true })
  async thread(
    @Context() context: RequestContext,
    @Args('id', { type: () => String }) id: string,
  ): Promise<ThreadType> {
    const thread = await this.threadService.findOne(context, id);

    return ThreadType.fromThread(thread);
  }
}
