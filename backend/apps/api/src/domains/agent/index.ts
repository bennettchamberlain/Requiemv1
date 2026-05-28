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

import { MemoryModule } from '@ci/domains/memory';
import { SearchNextModule } from '@ci/domains/search-next';

import { MemoryController } from './controllers/MemoryController';
import { ContextService } from './services/ContextService';
import { RecallService } from './services/RecallService';

@Module({
  imports: [MemoryModule, SearchNextModule],
  providers: [ContextService, RecallService],
  controllers: [MemoryController],
})
export class AgentModule {}
