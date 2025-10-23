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
  NotFoundException,
} from '@nestjs/common';
import { QueryFailedError } from 'typeorm';

import { PgErrorCode } from '@ci/common/constants';
import { Context } from '@ci/common/decorators';
import { JwtAuthGuard } from '@ci/common/guards';
import { ValidationPipe } from '@ci/common/pipes';
import { RequestContext } from '@ci/common/types';

import { DeviceService } from '../services/DeviceService';
import { CreateDeviceDto, UpdateDeviceDto, Device, createDeviceSchema, updateDeviceSchema } from '../types';

@Controller('devices')
export class DeviceController {
  constructor(private readonly deviceService: DeviceService) {}

  @UseGuards(JwtAuthGuard)
  @Post()
  async create(
    @Context() context: RequestContext,
    @Body(new ValidationPipe(createDeviceSchema)) input: CreateDeviceDto | CreateDeviceDto[],
  ): Promise<Device | Device[]> {
    if (!context.userId) {
      throw new UnauthorizedException('User must be authenticated to create devices');
    }

    try {
      return await this.deviceService.create(context, input);
    } catch (error) {
      if (error instanceof QueryFailedError && error.driverError?.code === PgErrorCode.UNIQUE_VIOLATION) {
        throw new ConflictException('Device record already exists');
      }

      throw error;
    }
  }

  @UseGuards(JwtAuthGuard)
  @Get()
  async findAll(@Context() context: RequestContext): Promise<Device[]> {
    if (!context.userId) {
      throw new UnauthorizedException('User must be authenticated to view devices');
    }

    return this.deviceService.findAll(context);
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id')
  async findOne(@Context() context: RequestContext, @Param('id') deviceId: string): Promise<Device | null> {
    if (!context.userId) {
      throw new UnauthorizedException('User must be authenticated to view devices');
    }

    const device = await this.deviceService.findOne(context, deviceId);
    if (!device) {
      throw new NotFoundException('Device not found');
    }

    return device;
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id')
  async update(
    @Context() context: RequestContext,
    @Param('id') deviceId: string,
    @Body(new ValidationPipe(updateDeviceSchema)) data: UpdateDeviceDto,
  ): Promise<Device | null> {
    if (!context.userId) {
      throw new UnauthorizedException('User must be authenticated to update devices');
    }

    const device = await this.deviceService.update(context, deviceId, data);
    if (!device) {
      throw new NotFoundException('Device not found');
    }

    return device;
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  async remove(@Context() context: RequestContext, @Param('id') deviceId: string): Promise<void> {
    if (!context.userId) {
      throw new UnauthorizedException('User must be authenticated to delete devices');
    }

    const device = await this.deviceService.findOne(context, deviceId);
    if (!device) {
      throw new NotFoundException('Device not found');
    }

    return this.deviceService.remove(context, deviceId);
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id/primary')
  async setPrimary(
    @Context() context: RequestContext,
    @Param('id') deviceId: string,
  ): Promise<Device | null> {
    if (!context.userId) {
      throw new UnauthorizedException('User must be authenticated to set primary device');
    }

    const device = await this.deviceService.setPrimary(context, deviceId);
    if (!device) {
      throw new NotFoundException('Device not found');
    }

    return device;
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id/last-seen')
  async updateLastSeen(
    @Context() context: RequestContext,
    @Param('id') deviceId: string,
  ): Promise<Device | null> {
    if (!context.userId) {
      throw new UnauthorizedException('User must be authenticated to update device last seen');
    }

    const device = await this.deviceService.updateLastSeen(context, deviceId);
    if (!device) {
      throw new NotFoundException('Device not found');
    }

    return device;
  }
}
