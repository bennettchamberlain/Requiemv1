import { UseGuards } from '@nestjs/common';
import { Query, Resolver, Args, Parent, ResolveField, ID } from '@nestjs/graphql';

import { Context } from '@ci/common/decorators';
import { GqlJwtAuthGuard } from '@ci/common/guards';
import { RequestContext } from '@ci/common/types';
import { MessageService, ThreadService } from '@ci/domains/conversations';

import { MessageConnection } from '../types/MessageConnection';
import { MessageEdge } from '../types/MessageEdge';
import { PageInfo } from '../types/PageInfo';
import { ThreadType } from '../types/ThreadType';

@UseGuards(GqlJwtAuthGuard)
@Resolver(() => ThreadType)
export class ThreadResolver {
  constructor(
    private readonly messageService: MessageService,
    private readonly threadService: ThreadService,
  ) {}

  @Query(() => [ThreadType])
  async threads(@Context() context: RequestContext): Promise<ThreadType[]> {
    const threads = await this.threadService.findAll(context);

    return threads.map((thread) => ThreadType.fromThread(thread));
  }

  @Query(() => ThreadType, { nullable: true })
  async thread(
    @Context() context: RequestContext,
    @Args('id', { type: () => ID }) id: string,
  ): Promise<ThreadType> {
    const thread = await this.threadService.findOne(context, id);

    return ThreadType.fromThread(thread);
  }

  @ResolveField(() => MessageConnection)
  async messages(
    @Parent() thread: ThreadType,
    @Context() context: RequestContext,
  ): Promise<MessageConnection> {
    const messages = await this.messageService.findByThread(context, thread.id);

    const edges: MessageEdge[] = messages.map((message) => ({
      cursor: Buffer.from(message.id).toString('base64'),
      node: {
        id: message.id,
        content: message.content,
        role: message.role,
        threadId: message.threadId ?? null,
      },
    }));

    const pageInfo: PageInfo = {
      hasNextPage: false,
      hasPreviousPage: false,
      startCursor: edges.length > 0 ? edges[0].cursor : null,
      endCursor: edges.length > 0 ? edges[edges.length - 1].cursor : null,
    };

    return {
      edges,
      pageInfo,
      totalCount: messages.length,
    };
  }
}
