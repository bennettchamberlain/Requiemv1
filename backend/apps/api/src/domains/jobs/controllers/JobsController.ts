import { Controller, InternalServerErrorException, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

import { Events, type EventPayloads, EventService, OnEvent } from '@ci/domains/events';
import { LoggerService } from '@ci/common/services';

@Controller('jobs')
export class JobsController {
  private logger = new LoggerService(JobsController.name);

  constructor(private readonly eventService: EventService) {}

  @UseGuards(AuthGuard('jwt'))
  @Post()
  async enqueue() {
    const result = await this.eventService.send(Events.API_ENQUEUE, {
      foo: 'test',
      bar: 'test',
    });

    if (result == null) {
      throw new InternalServerErrorException('Failed to enqueue job');
    }

    return {
      id: result,
    };
  }

  @OnEvent(Events.API_ENQUEUE)
  handleOrderCreatedEvent(payload: EventPayloads[Events.API_ENQUEUE]) {
    this.logger.log('Processed event test from listener', payload);
  }
}
