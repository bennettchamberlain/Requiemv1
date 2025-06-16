import { Module } from '@nestjs/common';

import { OllamaController } from './controllers/OllamaController';
import { OllamaService } from './services/OllamaService';

@Module({
  imports: [],
  providers: [OllamaService],
  controllers: [OllamaController],
  exports: [],
})
export class LLMModule {}

// Entities
export {};

// Services
export {};

// Types
export type {} from './types';
