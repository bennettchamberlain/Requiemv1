import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { LoggerService } from '@ci/common/services';
import type { RequestContext } from '@ci/common/types';
import { DeviceService } from '@ci/domains/devices';

import { BrowserActivityEntity } from '../entities/BrowserActivityEntity';
import type { CreateBrowserActivityDto, UpdateBrowserActivityDto, BrowserActivity } from '../types';

@Injectable()
export class BrowserActivityService {
  private logger = new LoggerService(BrowserActivityService.name);

  constructor(
    @InjectRepository(BrowserActivityEntity)
    private readonly browserActivityRepository: Repository<BrowserActivityEntity>,
    private readonly deviceService: DeviceService,
  ) {}

  private async ensureDeviceExists(deviceId: string, context: RequestContext): Promise<void> {
    // Check if device exists
    const device = await this.deviceService.findOne(context, deviceId);

    if (!device) {
      // Create device if it doesn't exist
      await this.deviceService.create(context, {
        device_name: 'Browser Extension',
        device_type: 'browser',
        platform: 'web',
      });

      this.logger.log('Created new device for browser activity', {
        deviceId,
        userId: context.userId,
      });
    }
  }

  async create(
    context: RequestContext,
    data: CreateBrowserActivityDto | CreateBrowserActivityDto[],
  ): Promise<BrowserActivity | BrowserActivity[]> {
    const isSingle = !Array.isArray(data);
    const dataArray: CreateBrowserActivityDto[] = isSingle ? [data] : data;

    this.logger.log('Creating browser activity records', {
      userId: context.userId,
      count: dataArray.length,
    });

    const returned = await Promise.all(
      dataArray.map(async (item) => {
        // Ensure device exists before creating browser activity
        await this.ensureDeviceExists(item.device_id, context);

        const browserActivity = await this.browserActivityRepository.create({
          time: new Date(item.time),
          user_id: context.userId!,
          device_id: item.device_id,
          url: item.url,
          title: item.title,
          action_type: item.action_type,
          duration_seconds: item.duration_seconds,
          scroll_depth_percent: item.scroll_depth_percent,
          page_summary: item.page_summary,
          page_embedding: item.page_embedding,
          category: item.category,
          productivity_score: item.productivity_score,
          is_incognito: item.is_incognito ?? false,
          contains_sensitive: item.contains_sensitive ?? false,
        });

        const result = await this.browserActivityRepository.save(browserActivity);

        return result.toBrowserActivity();
      }),
    );

    this.logger.log('Successfully created browser activity records', {
      userId: context.userId,
      count: returned.length,
    });

    return isSingle ? returned[0] : returned;
  }

  async findAll(context: RequestContext): Promise<BrowserActivity[]> {
    this.logger.log('Fetching all browser activity for user', {
      userId: context.userId,
    });

    const results = await this.browserActivityRepository.find({
      where: { user_id: context.userId! },
      order: { time: 'DESC' },
    });

    return results.map((entity) => entity.toBrowserActivity());
  }

  async findOne(context: RequestContext, time: string, deviceId: string): Promise<BrowserActivity | null> {
    const result = await this.browserActivityRepository.findOne({
      where: {
        time: new Date(time),
        user_id: context.userId!,
        device_id: deviceId,
      },
    });

    return result?.toBrowserActivity() ?? null;
  }

  async update(
    context: RequestContext,
    time: string,
    deviceId: string,
    data: UpdateBrowserActivityDto,
  ): Promise<BrowserActivity | null> {
    this.logger.log('Updating browser activity record', {
      userId: context.userId,
      time,
      deviceId,
    });

    // Handle time field conversion if present
    const { time: timeString, ...restData } = data;
    const updateData: Partial<BrowserActivityEntity> = { ...restData };
    if (timeString !== undefined) {
      updateData.time = new Date(timeString);
    }

    await this.browserActivityRepository.update(
      {
        time: new Date(time),
        user_id: context.userId!,
        device_id: deviceId,
      },
      updateData,
    );

    return this.findOne(context, time, deviceId);
  }

  async remove(context: RequestContext, time: string, deviceId: string): Promise<void> {
    this.logger.log('Removing browser activity record', {
      userId: context.userId,
      time,
      deviceId,
    });

    await this.browserActivityRepository.delete({
      time: new Date(time),
      user_id: context.userId!,
      device_id: deviceId,
    });
  }
}
