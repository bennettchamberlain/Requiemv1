import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { BrowserActivityController } from './controllers/BrowserActivityController';
import { BrowserActivityEntity } from './entities/BrowserActivityEntity';
import { BrowserActivityService } from './services/BrowserActivityService';

@Module({
  imports: [TypeOrmModule.forFeature([BrowserActivityEntity])],
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
