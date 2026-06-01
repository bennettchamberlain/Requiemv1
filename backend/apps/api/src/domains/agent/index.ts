/**
 * Agent memory domain — passive context injection for AI agents.
 *
 * Exposes REST endpoints:
 *   GET  /memory/context  — L0 static user profile (system_prompt_block)        [ApiKeyGuard]
 *   POST /memory/recall   — L1 hybrid search against the knowledge graph         [ApiKeyGuard]
 *   POST /memory/note     — ingest a raw memory fragment (on_memory_write)       [ApiKeyGuard]
 *   POST /memory/turn     — stub for conversation ingestion                      [ApiKeyGuard]
 *   GET  /memory/notes    — list recent fragments for the settings UI            [JwtOrApiKey]
 *   POST /memory/compact  — manually trigger LLM compaction for current user     [JwtOrApiKey]
 *
 * @module AgentModule
 */

import { Module } from '@nestjs/common';

import { EntityResolutionModule } from '@ci/domains/entity-resolution';
import { LLMModule } from '@ci/domains/llm';
import { MemoryModule } from '@ci/domains/memory';
import { NotesModule } from '@ci/domains/notes';
import { SearchNextModule } from '@ci/domains/search-next';

import { MemoryController } from './controllers/MemoryController';
import { RecallService } from './services/RecallService';
import { SerializerService } from './services/SerializerService';

@Module({
  imports: [EntityResolutionModule, LLMModule, MemoryModule, NotesModule, SearchNextModule],
  exports: [SerializerService],
  providers: [RecallService, SerializerService],
  controllers: [MemoryController],
})
export class AgentModule {}
