import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { LoggerService } from '@ci/common/services';
import type { RequestContext } from '@ci/common/types';

import { BrowserActivityEntity } from '../entities/BrowserActivityEntity';
import type { CreateBrowserActivityDto, UpdateBrowserActivityDto, BrowserActivity } from '../types';

@Injectable()
export class BrowserActivityService {
  private logger = new LoggerService(BrowserActivityService.name);

  constructor(
    @InjectRepository(BrowserActivityEntity)
    private readonly browserActivityRepository: Repository<BrowserActivityEntity>,
  ) {}

  private async ensureDeviceExists(deviceId: string, userId: string): Promise<void> {
    // Check if device exists
    const deviceExists = await this.browserActivityRepository.query(
      'SELECT 1 FROM devices WHERE device_id = $1 AND user_id = $2',
      [deviceId, userId],
    );

    if (deviceExists.length === 0) {
      // Create device if it doesn't exist
      await this.browserActivityRepository.query(
        `INSERT INTO devices (device_id, user_id, device_name, device_type, platform, last_seen, is_active)
         VALUES ($1, $2, $3, $4, $5, NOW(), true)`,
        [deviceId, userId, 'Browser Extension', 'browser', 'web'],
      );

      this.logger.log('Created new device for browser activity', {
        deviceId,
        userId,
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
        await this.ensureDeviceExists(item.device_id, context.userId!);

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

    const updateData: Partial<BrowserActivityEntity> = {};

    if (data.time !== undefined) {
      updateData.time = new Date(data.time);
    }

    if (data.device_id !== undefined) {
      updateData.device_id = data.device_id;
    }

    if (data.url !== undefined) {
      updateData.url = data.url;
    }

    if (data.title !== undefined) {
      updateData.title = data.title;
    }

    if (data.action_type !== undefined) {
      updateData.action_type = data.action_type;
    }

    if (data.duration_seconds !== undefined) {
      updateData.duration_seconds = data.duration_seconds;
    }

    if (data.scroll_depth_percent !== undefined) {
      updateData.scroll_depth_percent = data.scroll_depth_percent;
    }

    if (data.page_summary !== undefined) {
      updateData.page_summary = data.page_summary;
    }

    if (data.page_embedding !== undefined) {
      updateData.page_embedding = data.page_embedding;
    }

    if (data.category !== undefined) {
      updateData.category = data.category;
    }

    if (data.productivity_score !== undefined) {
      updateData.productivity_score = data.productivity_score;
    }

    if (data.is_incognito !== undefined) {
      updateData.is_incognito = data.is_incognito;
    }

    if (data.contains_sensitive !== undefined) {
      updateData.contains_sensitive = data.contains_sensitive;
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
