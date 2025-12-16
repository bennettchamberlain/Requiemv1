import { Controller, Get, NotFoundException, UseGuards } from '@nestjs/common';

import { Context, RequestContext } from '@ci/common/context';
import { JwtAuthGuard } from '@ci/common/guards';

import { UserService } from '../services/UserService';

@Controller('users')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @UseGuards(JwtAuthGuard)
  @Get('me')
  async selfProfile(@Context() context: RequestContext) {
    const userId = context.userId;

    if (userId == null) {
      throw new NotFoundException();
    }

    return this.userService.findById({ userId }, userId);
  }
}
