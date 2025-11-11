import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { DeviceModule } from '@ci/domains/devices';

import { PositionController } from './controllers/PositionController';
import { PositionEntity } from './entities/PositionEntity';
import { PositionService } from './services/PositionService';

@Module({
  imports: [TypeOrmModule.forFeature([PositionEntity]), DeviceModule],
  providers: [PositionService],
  controllers: [PositionController],
  exports: [PositionService],
})
export class PositionModule {}

export { PositionEntity };
export { PositionService };
export { PositionController };
export * from './types';
export * from './entities/PositionEntity';
