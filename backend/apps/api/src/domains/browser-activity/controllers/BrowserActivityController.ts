import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  UseGuards,
  UnauthorizedException,
  ConflictException,
} from '@nestjs/common';
import { QueryFailedError } from 'typeorm';

import { PgErrorCode } from '@ci/common/constants';
import { Context } from '@ci/common/decorators';
import { JwtAuthGuard } from '@ci/common/guards';
import { ValidationPipe } from '@ci/common/pipes';
import { RequestContext } from '@ci/common/types';

import { BrowserActivityService } from '../services/BrowserActivityService';
import {
  CreateBrowserActivityDto,
  UpdateBrowserActivityDto,
  BrowserActivity,
  createBrowserActivitySchema,
  updateBrowserActivitySchema,
} from '../types';

@Controller('browser-activity')
export class BrowserActivityController {
  constructor(private readonly browserActivityService: BrowserActivityService) {}

  @UseGuards(JwtAuthGuard)
  @Post()
  async create(
    @Context() context: RequestContext,
    @Body(new ValidationPipe(createBrowserActivitySchema))
    input: CreateBrowserActivityDto | CreateBrowserActivityDto[],
  ): Promise<BrowserActivity | BrowserActivity[]> {
    if (!context.userId) {
      throw new UnauthorizedException('User must be authenticated to create browser activity');
    }

    try {
      return await this.browserActivityService.create(context, input);
    } catch (error) {
      if (error instanceof QueryFailedError && error.driverError?.code === PgErrorCode.UNIQUE_VIOLATION) {
        throw new ConflictException('Browser activity record already exists for this time and device');
      }

      throw error;
    }
  }

  @UseGuards(JwtAuthGuard)
  @Get()
  async findAll(@Context() context: RequestContext): Promise<BrowserActivity[]> {
    if (!context.userId) {
      throw new UnauthorizedException('User must be authenticated to view browser activity');
    }

    return this.browserActivityService.findAll(context);
  }

  @UseGuards(JwtAuthGuard)
  @Get(':time/:deviceId')
  async findOne(
    @Context() context: RequestContext,
    @Param('time') time: string,
    @Param('deviceId') deviceId: string,
  ): Promise<BrowserActivity | null> {
    if (!context.userId) {
      throw new UnauthorizedException('User must be authenticated to view browser activity');
    }

    return this.browserActivityService.findOne(context, time, deviceId);
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':time/:deviceId')
  async update(
    @Context() context: RequestContext,
    @Param('time') time: string,
    @Param('deviceId') deviceId: string,
    @Body(new ValidationPipe(updateBrowserActivitySchema)) data: UpdateBrowserActivityDto,
  ): Promise<BrowserActivity | null> {
    if (!context.userId) {
      throw new UnauthorizedException('User must be authenticated to update browser activity');
    }

    return this.browserActivityService.update(context, time, deviceId, data);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':time/:deviceId')
  async remove(
    @Context() context: RequestContext,
    @Param('time') time: string,
    @Param('deviceId') deviceId: string,
  ): Promise<void> {
    if (!context.userId) {
      throw new UnauthorizedException('User must be authenticated to delete browser activity');
    }

    return this.browserActivityService.remove(context, time, deviceId);
  }
}
