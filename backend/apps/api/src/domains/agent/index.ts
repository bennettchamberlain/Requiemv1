/**
 * Agent memory domain — passive context injection for AI agents.
 *
 * Exposes four REST endpoints (all behind ApiKeyGuard):
 *   GET  /agent/context  — L0 static user profile (system prompt block)
 *   POST /agent/recall   — L1 semantic search against the knowledge graph
 *   POST /agent/absorb   — async ingestion of a conversation turn (202)
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
// import { AbsorbService } from './services/AbsorbService';
// import { RecallService } from './services/RecallService';

@Module({
  imports: [MemoryModule, SearchNextModule],
  providers: [],
  controllers: [MemoryController],
})
export class AgentModule {}
