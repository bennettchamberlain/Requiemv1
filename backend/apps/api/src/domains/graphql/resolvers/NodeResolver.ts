import { NotFoundException, UseGuards } from '@nestjs/common';
import { Query, Resolver, Args, ID } from '@nestjs/graphql';

import { Context } from '@ci/common/decorators';
import { JwtAuthGuard } from '@ci/common/guards';
import { RequestContext } from '@ci/common/types';
import { toServiceContext } from '@ci/common/utils';
import { MessageService, ThreadService } from '@ci/domains/conversations';
import { PersonService } from '@ci/domains/memory';

import { GlobalUID } from '../types/GlobalUID';
import { MessageType } from '../types/MessageType';
import { Node } from '../types/Node';
import { PersonType } from '../types/PersonType';
import { ThreadType } from '../types/ThreadType';

@UseGuards(JwtAuthGuard)
@Resolver(() => Node)
export class NodeResolver {
  constructor(
    private readonly threadService: ThreadService,
    private readonly personService: PersonService,
    private readonly messageService: MessageService,
  ) {}

  @Query(() => Node, { nullable: true })
  async node(
    @Context() context: RequestContext,
    @Args('id', { type: () => ID }) gid: string,
  ): Promise<Node | null> {
    const serviceContext = toServiceContext(context);
    const { type, id } = GlobalUID.decode(gid);

    switch (type) {
      case 'message': {
        const message = await this.messageService.findById(serviceContext, id);

        if (message == null) {
          throw new NotFoundException('Message not found');
        }

        return MessageType.fromEntity(message);
      }

      case 'person': {
        const person = await this.personService.findOne(context, id);

        if (person == null) {
          throw new NotFoundException('Person not found');
        }

        return PersonType.fromEntity(person);
      }

      case 'thread': {
        const thread = await this.threadService.findById(serviceContext, id);

        if (thread == null) {
          throw new NotFoundException('Thread not found');
        }

        return ThreadType.fromEntity(thread);
      }

      default:
        return null;
    }
  }
}
