import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { EventsModule } from '@ci/domains/events';

import { OllamaController } from './controllers/OllamaController';
import { ThreadsController } from './controllers/ThreadsController';
import { MessageEntity } from './entities/MessageEntity';
import { ThreadEntity } from './entities/ThreadEntity';
import { MessageService } from './services/MessageService';
import { OllamaService } from './services/OllamaService';
import { ThreadService } from './services/ThreadService';

@Module({
  imports: [TypeOrmModule.forFeature([MessageEntity, ThreadEntity]), EventsModule],
  providers: [MessageService, OllamaService, ThreadService],
  controllers: [OllamaController, ThreadsController],
  exports: [OllamaService],
})
export class LLMModule {}

// Entities
export { MessageEntity, ThreadEntity };

// Services
export { OllamaService };

// Types
export type {} from './types';
