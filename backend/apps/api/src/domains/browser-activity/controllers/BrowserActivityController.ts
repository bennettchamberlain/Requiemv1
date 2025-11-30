import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { QueryFailedError } from 'typeorm';

import { PgErrorCode } from '@ci/common/constants';
import { Context } from '@ci/common/decorators';
import { JwtAuthGuard } from '@ci/common/guards';
import { ValidationPipe } from '@ci/common/pipes';
import { RequestContext } from '@ci/common/types';
import { toServiceContext } from '@ci/common/utils';

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
    const serviceContext = toServiceContext(context);

    try {
      return await this.browserActivityService.create(serviceContext, input);
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
    const serviceContext = toServiceContext(context);

    return this.browserActivityService.findAll(serviceContext);
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id')
  async findById(
    @Context() context: RequestContext,
    @Param('id') id: string,
  ): Promise<BrowserActivity | null> {
    const serviceContext = toServiceContext(context);

    const result = await this.browserActivityService.findById(serviceContext, id);

    if (!result) {
      throw new NotFoundException();
    }

    return result;
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id')
  async update(
    @Context() context: RequestContext,
    @Param('id') id: string,
    @Body(new ValidationPipe(updateBrowserActivitySchema)) data: UpdateBrowserActivityDto,
  ): Promise<BrowserActivity | null> {
    const serviceContext = toServiceContext(context);

    const result = await this.browserActivityService.update(serviceContext, id, data);

    if (!result) {
      throw new NotFoundException();
    }

    return result;
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Context() context: RequestContext, @Param('id') id: string): Promise<void> {
    const serviceContext = toServiceContext(context);

    const removal = await this.browserActivityService.remove(serviceContext, id);

    if (!removal) {
      throw new NotFoundException();
    }
  }

  @UseGuards(JwtAuthGuard)
  @Get('range')
  async findByTimeRange(
    @Context() context: RequestContext,
    @Query('startTime') startTime: string,
    @Query('endTime') endTime: string,
  ): Promise<BrowserActivity[]> {
    const serviceContext = toServiceContext(context);

    return this.browserActivityService.findByTimeRange(serviceContext, startTime, endTime);
  }

  @UseGuards(JwtAuthGuard)
  @Get(':time/:deviceId')
  async findByTimeAndDevice(
    @Context() context: RequestContext,
    @Param('time') time: string,
    @Param('deviceId') deviceId: string,
  ): Promise<BrowserActivity | null> {
    const serviceContext = toServiceContext(context);

    return this.browserActivityService.findByTimeAndDevice(serviceContext, time, deviceId);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':time/:deviceId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeByTimeAndDate(
    @Context() context: RequestContext,
    @Param('time') time: string,
    @Param('deviceId') deviceId: string,
  ): Promise<void> {
    const serviceContext = toServiceContext(context);

    const activity = await this.browserActivityService.findByTimeAndDevice(serviceContext, time, deviceId);

    if (!activity) {
      throw new NotFoundException();
    }

    await this.browserActivityService.remove(serviceContext, activity.id);
  }
}
