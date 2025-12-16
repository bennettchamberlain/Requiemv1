import { UseGuards } from '@nestjs/common';
import { Query, Resolver } from '@nestjs/graphql';

import { Context, type RequestContext, toServiceContext } from '@ci/common/context';
import { JwtAuthGuard } from '@ci/common/guards';
import { UserService } from '@ci/domains/user';

import { UserType } from '../types/UserType';

@UseGuards(JwtAuthGuard)
@Resolver(() => UserType)
export class UserResolver {
  constructor(private readonly userService: UserService) {}

  @Query(() => UserType, { nullable: true })
  async me(@Context() context: RequestContext): Promise<UserType | null> {
    const serviceContext = toServiceContext(context);

    const user = await this.userService.findById(serviceContext, context.userId!);

    return user ? UserType.toType(user) : null;
  }
}
