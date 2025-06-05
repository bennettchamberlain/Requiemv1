import { Controller, InternalServerErrorException, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

import { DelegationService } from '../services/DelegationService';

@Controller('jobs')
export class JobsController {
  constructor(private readonly delegationService: DelegationService) {}

  @UseGuards(AuthGuard('jwt'))
  @Post()
  async enqueue() {
    const result = await this.delegationService.sendEvent({
      foo: 'bar',
    });

    if (result == null) {
      throw new InternalServerErrorException('Failed to enqueue job');
    }

    return {
      id: result,
    };
  }
}
