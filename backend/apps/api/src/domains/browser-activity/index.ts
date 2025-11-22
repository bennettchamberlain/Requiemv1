import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { DeviceModule } from '@ci/domains/devices';

import { BrowserActivityController } from './controllers/BrowserActivityController';
import { BrowserActivityEntity } from './entities/BrowserActivityEntity';
import { BrowserActivityService } from './services/BrowserActivityService';
import {EventsModule} from "@ci/domains/events";

@Module({
  imports: [TypeOrmModule.forFeature([BrowserActivityEntity]), DeviceModule, EventsModule],
  providers: [BrowserActivityService],
  controllers: [BrowserActivityController],
  exports: [BrowserActivityService],
})
export class BrowserActivityModule {}

// Entities
export { BrowserActivityEntity };

// Services
export { BrowserActivityService };

// Controllers
export { BrowserActivityController };

// Types
export * from './types';
