import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';

import { AuthGuard } from '@nestjs/passport';

import { Context } from '@ci/common/decorators';
import type { RequestContext } from '@ci/common/types';

import { Events, type EventPayloads, EventService, OnEvent } from '@ci/domains/events';
import { LoggerService } from '@ci/common/services';
import { ConnectorsService } from '../services/ConnectorsService';

@Controller('connectors')
export class ConnectorsController {
  private logger = new LoggerService(ConnectorsController.name);

  constructor(private readonly connectorsService: ConnectorsService) {}

  //@UseGuards(AuthGuard('jwt'))
  @Get()
  connect(@Context() context: RequestContext) {
    return this.connectorsService.connect(context);
  }

  @Get('callback')
  callback(@Context() context: RequestContext) {
    return this.connectorsService.callback(context);
  }

}







