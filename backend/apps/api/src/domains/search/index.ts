import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { EmbeddingController } from './controllers/EmbeddingController';
import { TagEntity } from './entities/TagEntity';
import { EmbeddingService } from './services/EmbeddingService';

@Module({
  imports: [TypeOrmModule.forFeature([TagEntity])],
  providers: [EmbeddingService],
  controllers: [EmbeddingController],
  exports: [EmbeddingService],
})
export class EmbeddingModule {}

// Entities
export { TagEntity };

// Services
export { EmbeddingService };

// Types
export type {} from './types';
