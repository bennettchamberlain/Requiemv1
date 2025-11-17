import { UseGuards } from '@nestjs/common';
import { Query, Resolver, Args, Parent, ResolveField, ID } from '@nestjs/graphql';

import { Context } from '@ci/common/decorators';
import { GqlJwtAuthGuard } from '@ci/common/guards';
import { RequestContext } from '@ci/common/types';
import { MessageService, ThreadService } from '@ci/domains/conversations';

import { GlobalUID } from '../types/GlobalUID';
import { MessageConnection } from '../types/MessageConnection';
import { MessageEdge } from '../types/MessageEdge';
import { PaginationArgs } from '../types/PaginationArgs';
import { ThreadConnection } from '../types/ThreadConnection';
import { ThreadEdge } from '../types/ThreadEdge';
import { ThreadType } from '../types/ThreadType';
import { Paginator } from '../utils/Paginator';

@UseGuards(GqlJwtAuthGuard)
@Resolver(() => ThreadType)
export class ThreadResolver {
  constructor(
    private readonly messageService: MessageService,
    private readonly threadService: ThreadService,
  ) {}

  @Query(() => ThreadConnection)
  async threads(
    @Context() context: RequestContext,
    @Args() pagination: PaginationArgs,
  ): Promise<ThreadConnection> {
    const threads = await this.threadService.findAll(context);

    const { slice, pageInfo } = Paginator.paginate(threads, {
      ...pagination,
      getId: (thread) => GlobalUID.toGUID('thread', thread.id),
    });

    const edges: ThreadEdge[] = slice.map((thread) => {
      const gid = GlobalUID.toGUID('thread', thread.id);

      return {
        cursor: gid,
        node: {
          id: gid,
          name: thread.name,
          model: thread.model,
          description: thread.description,
        },
      };
    });

    return {
      edges,
      pageInfo,
      totalCount: edges.length,
    };
  }

  @Query(() => ThreadType, { nullable: true })
  async thread(
    @Context() context: RequestContext,
    @Args('id', { type: () => ID }) id: string,
  ): Promise<ThreadType> {
    const threadId = GlobalUID.fromGUID('thread', id);

    const thread = await this.threadService.findOne(context, threadId);

    return {
      id: GlobalUID.toGUID('thread', thread.id),
      name: thread.name,
      model: thread.model,
      description: thread.description,
    };
  }

  @ResolveField(() => MessageConnection)
  async messages(
    @Context() context: RequestContext,
    @Parent() thread: ThreadType,
    @Args() pagination: PaginationArgs,
  ): Promise<MessageConnection> {
    const threadId = GlobalUID.fromGUID('thread', thread.id);

    const messages = await this.messageService.findByThread(context, threadId);

    const { slice, pageInfo } = Paginator.paginate(messages, {
      ...pagination,
      getId: (message) => GlobalUID.toGUID('message', message.id),
    });

    const edges: MessageEdge[] = slice.map((message) => {
      const gid = GlobalUID.toGUID('message', message.id);

      return {
        cursor: gid,
        node: {
          id: gid,
          content: message.content,
          role: message.role,
          threadId: message.threadId ?? null,
        },
      };
    });

    return {
      edges,
      pageInfo,
      totalCount: messages.length,
    };
  }
}
