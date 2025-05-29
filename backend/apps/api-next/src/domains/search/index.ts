import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { EmbeddingController } from './EmbeddingController';
import { EmbeddingEntity } from './EmbeddingEntity';
import { EmbeddingService } from './EmbeddingService';

@Module({
  imports: [TypeOrmModule.forFeature([EmbeddingEntity])],
  providers: [EmbeddingService],
  controllers: [EmbeddingController],
  exports: [EmbeddingService],
})
export class EmbeddingModule {}
