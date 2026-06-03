import { Body, Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';

import { Context, type RequestContext, toServiceContext } from '@ci/common/context';
import { ApiKeyGuard } from '@ci/common/guards';
import { LoggerService } from '@ci/common/logging';
import { ValidationPipe } from '@ci/common/pipes';
import { UserContextService } from '@ci/domains/memory';

import { AgentMemoryService } from '../services/AgentMemoryService';
import { MemoryCompactionService } from '../services/MemoryCompactionService';
import { RecallService } from '../services/RecallService';
import { agentMemorySchema, recallSchema, type AgentMemoryDto, type RecallDto } from '../types';

@Controller('memory')
export class MemoryController {
  constructor(
    private readonly userContextService: UserContextService,
    private readonly recallService: RecallService,
    private readonly agentMemoryService: AgentMemoryService,
    private readonly compactionService: MemoryCompactionService,
    private readonly logger: LoggerService,
  ) {
    logger.setContext(MemoryController.name);
  }

  /**
   * L0 — static user profile block for the agent system prompt.
   *
   * Returns a pre-formatted markdown block summarising the user's knowledge
   * graph: name, relationships, preferences, and dossier. Intended to be
   * called once per session (system_prompt_block), not per turn.
   */
  @UseGuards(ApiKeyGuard)
  @Get('context')
  async context(@Context() context: RequestContext) {
    const serviceContext = toServiceContext(context);

    try {
      const userCtx = await this.userContextService.getUserContextForLLM(serviceContext.userId);

      if (!userCtx) {
        return { block: '' };
      }

      return { block: this.userContextService.formatContextForSystemPrompt(userCtx) };
    } catch (err) {
      this.logger.warn(`L0 context failed for user ${context.userId}: ${err}`);

      return { block: '' };
    }
  }

  /**
   * L1 — per-turn hybrid search against the knowledge graph.
   *
   * Runs a keyword/semantic search using the query, then hydrates matched
   * entity IDs into readable names and content.
   */
  @UseGuards(ApiKeyGuard)
  @Post('recall')
  async recall(@Context() context: RequestContext, @Body(new ValidationPipe(recallSchema)) input: RecallDto) {
    return this.recallService.recall(toServiceContext(context), {
      query: input.query,
      maxResults: input.maxResults,
    });
  }

  /**
   * Stores a raw memory fragment written by the agent or by Hermes's built-in
   * memory system (on_memory_write hook).  The fragment is saved verbatim to
   * ci.agent_memory; the compaction cron promotes it into the knowledge graph.
   *
   * Invoked by:
   *   - Hermes 'on_memory_write'
   */
  @UseGuards(ApiKeyGuard)
  @HttpCode(201)
  @Post('write')
  async write(
    @Context() context: RequestContext,
    @Body(new ValidationPipe(agentMemorySchema)) input: AgentMemoryDto,
  ) {
    const title = input.title ?? (input.source ? `[${input.source}]` : null);

    await this.agentMemoryService.create(toServiceContext(context), {
      content: input.content,
      source: input.source ?? null,
      title,
      sessionId: input.sessionId ?? null,
    });
  }

  /**
   * Ingests a conversation turn into the database.
   *
   * Invoked by:
   *   - OpenClaw 'afterTurn'
   *   - Hermes 'sync_turn'
   */
  @UseGuards(ApiKeyGuard)
  @Post('turn')
  async turn(/* @Context() context: RequestContext, @Body(new ValidationPipe(turnSchema)) input: TurnDto */) {
    // threadService.upsert(sessionId)
    // messageService.create(userMessage)
    // messageService.create(assistantMessage)
  }
}
