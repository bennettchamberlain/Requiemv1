import { Module } from '@nestjs/common';

import { EmbeddingService } from './services/EmbeddingService';

@Module({
  providers: [EmbeddingService],
  exports: [EmbeddingService],
})
export class EmbeddingModule {}

export { EmbeddingService };
