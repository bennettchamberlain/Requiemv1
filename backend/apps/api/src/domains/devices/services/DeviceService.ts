import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v7 as uuid7 } from 'uuid';

import { SYSTEM_USER, UserServiceContext, type ServiceContext } from '@ci/common/types';

import { DeviceEntity } from '../entities/DeviceEntity';
import type { CreateDeviceDto, UpdateDeviceDto, Device } from '../types';

@Injectable()
export class DeviceService {
  constructor(
    @InjectRepository(DeviceEntity)
    private readonly deviceRepository: Repository<DeviceEntity>,
  ) {}

  async create(
    context: UserServiceContext,
    data: CreateDeviceDto | CreateDeviceDto[],
  ): Promise<Device | Device[]> {
    // Required for TypeScript type narrowing to work within the closure.
    const userId = context.userId;

    const isSingle = !Array.isArray(data);
    const dataArray: CreateDeviceDto[] = isSingle ? [data] : data;

    const returned = await Promise.all(
      dataArray.map(async (item) => {
        const device = await this.deviceRepository.create({
          device_id: uuid7(),
          user_id: userId,
          device_entity_id: item.device_entity_id,
          device_name: item.device_name ?? `${item.device_type} Device`,
          device_type: item.device_type,
          platform: item.platform,
          model: item.model,
          manufacturer: item.manufacturer,
          os_version: item.os_version,
          app_version: item.app_version,
          is_active: item.is_active ?? true,
          is_primary: item.is_primary ?? false,
          push_token: item.push_token,
          capabilities: item.capabilities ?? {},
          privacy_settings: item.privacy_settings ?? {},
        });

        const result = await this.deviceRepository.save(device);

        return result.toDevice();
      }),
    );

    return isSingle ? returned[0] : returned;
  }

  async findAll(context: ServiceContext): Promise<Device[]> {
    const results = await this.deviceRepository.find({
      where: {
        ...(context.userId !== SYSTEM_USER && {
          user: {
            id: context.userId,
          },
        }),
      },
      order: {
        created_at: 'DESC',
      },
    });

    return results.map((entity) => entity.toDevice());
  }

  async findById(context: ServiceContext, deviceId: string): Promise<Device | null> {
    const result = await this.deviceRepository.findOne({
      where: {
        device_id: deviceId,
        ...(context.userId !== SYSTEM_USER && {
          user: {
            id: context.userId,
          },
        }),
      },
    });

    return result?.toDevice() ?? null;
  }

  async update(context: ServiceContext, deviceId: string, data: UpdateDeviceDto): Promise<Device | null> {
    const updateData: Partial<DeviceEntity> = {};

    if (data.device_entity_id !== undefined) {
      updateData.device_entity_id = data.device_entity_id;
    }

    if (data.device_name !== undefined) {
      updateData.device_name = data.device_name;
    }

    if (data.device_type !== undefined) {
      updateData.device_type = data.device_type;
    }

    if (data.platform !== undefined) {
      updateData.platform = data.platform;
    }

    if (data.model !== undefined) {
      updateData.model = data.model;
    }

    if (data.manufacturer !== undefined) {
      updateData.manufacturer = data.manufacturer;
    }

    if (data.os_version !== undefined) {
      updateData.os_version = data.os_version;
    }

    if (data.app_version !== undefined) {
      updateData.app_version = data.app_version;
    }

    if (data.is_active !== undefined) {
      updateData.is_active = data.is_active;
    }

    if (data.is_primary !== undefined) {
      updateData.is_primary = data.is_primary;
    }

    if (data.push_token !== undefined) {
      updateData.push_token = data.push_token;
    }

    if (data.capabilities !== undefined) {
      updateData.capabilities = data.capabilities;
    }

    if (data.privacy_settings !== undefined) {
      updateData.privacy_settings = data.privacy_settings;
    }

    // Use save method for JSONB fields to avoid TypeScript issues
    const device = await this.deviceRepository.findOne({
      where: {
        device_id: deviceId,
        ...(context.userId !== SYSTEM_USER && {
          user: {
            id: context.userId,
          },
        }),
      },
    });

    if (device) {
      Object.assign(device, updateData);
      await this.deviceRepository.save(device);
    }

    return this.findById(context, deviceId);
  }

  async remove(context: ServiceContext, deviceId: string): Promise<void> {
    await this.deviceRepository.delete({
      device_id: deviceId,
      ...(context.userId !== SYSTEM_USER && {
        user: {
          id: context.userId,
        },
      }),
    });
  }

  async setPrimary(context: UserServiceContext, deviceId: string): Promise<Device | null> {
    // First, unset all other devices as primary
    await this.deviceRepository.update(
      {
        user_id: context.userId,
      },
      {
        is_primary: false,
      },
    );

    // Then set this device as primary
    await this.deviceRepository.update(
      {
        device_id: deviceId,
        user_id: context.userId,
      },
      {
        is_primary: true,
      },
    );

    return this.findById(context, deviceId);
  }

  async updateLastSeen(context: ServiceContext, deviceId: string): Promise<Device | null> {
    await this.deviceRepository.update(
      {
        device_id: deviceId,
        ...(context.userId !== SYSTEM_USER && {
          user: {
            id: context.userId,
          },
        }),
      },
      {
        last_seen: new Date(),
      },
    );

    return this.findById(context, deviceId);
  }
}
