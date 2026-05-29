/**
 * Agent memory domain — passive context injection for AI agents.
 *
 * Exposes REST endpoints (all behind ApiKeyGuard):
 *   GET  /memory/context — L0 static user profile (system_prompt_block)
 *   POST /memory/recall  — L1 hybrid search against the knowledge graph (prefetch)
 *   POST /memory/turn    — stub for conversation ingestion
 *
 * Designed to back a Hermes MemoryProvider plugin that injects memories
 * passively without the agent needing to invoke MCP tools.
 *
 * @module AgentModule
 */

import { Module } from '@nestjs/common';

import { EntityResolutionModule } from '@ci/domains/entity-resolution';
import { MemoryModule } from '@ci/domains/memory';
import { SearchNextModule } from '@ci/domains/search-next';

import { MemoryController } from './controllers/MemoryController';
import { RecallService } from './services/RecallService';
import { SerializerService } from './services/SerializerService';

@Module({
  imports: [EntityResolutionModule, MemoryModule, SearchNextModule],
  providers: [RecallService, SerializerService],
  exports: [SerializerService],
  controllers: [MemoryController],
})
export class AgentModule {}
