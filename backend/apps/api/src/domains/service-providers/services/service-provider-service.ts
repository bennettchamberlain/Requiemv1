import { Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v4 as uuidv4, v7 as uuidv7 } from 'uuid';

import config from '@ci/config';
import { LoggerService } from '@ci/common/services';
import { RequestContext } from '@ci/common/types';
import { EventService, Events, type EventPayloads } from '@ci/domains/events';

@Injectable()
export class ServiceProviderService implements OnModuleInit {
  private logger = new LoggerService(ServiceProviderService.name);

  constructor(
  ) {}

  async onModuleInit() {
  }

  async findAll(context: RequestContext): Promise<[]> {
    return []
  }

  async findOne(context: RequestContext, id: string): Promise<any> {
    return {}
  }

}
