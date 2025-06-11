import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { EmbeddingController } from './controllers/EmbeddingController';
import { EmbeddingEntity } from './entities/EmbeddingEntity';
import { EmbeddingService } from './services/EmbeddingService';

@Module({
  imports: [TypeOrmModule.forFeature([EmbeddingEntity])],
  providers: [EmbeddingService],
  controllers: [EmbeddingController],
  exports: [EmbeddingService],
})
export class EmbeddingModule {}

// Entities
export { EmbeddingEntity };

// Services
export { EmbeddingService };

// Types
export type {} from './types';
