import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';

import { Context, type RequestContext, toServiceContext } from '@ci/common/context';
import { ApiKeyGuard } from '@ci/common/guards';
import { LoggerService } from '@ci/common/logging';
import { ValidationPipe } from '@ci/common/pipes';

import { ContextService } from '../services/ContextService';
import { RecallService } from '../services/RecallService';
import { recallSchema, type RecallDto } from '../types';

@Controller('memory')
export class MemoryController {
  constructor(
    private readonly contextService: ContextService,
    private readonly recallService: RecallService,
    private readonly logger: LoggerService,
  ) {}

  /**
   * L0 — static user profile block for the agent system prompt.
   *
   * Returns a pre-formatted markdown block summarising the user's knowledge
   * graph: name, relationships, preferences, and dossier. Intended to be
   * called once per session (system_prompt_block), not per turn.
   *
   * Invoked by:
   *   - Hermes 'system_prompt_block'
   *   - OpenClaw 'assemble'
   */
  @UseGuards(ApiKeyGuard)
  @Get('context')
  async context(@Context() context: RequestContext) {
    return this.contextService.getContext(toServiceContext(context));
  }

  /**
   * L1 — per-turn search against the knowledge graph.
   *
   * Runs a hybrid keyword/semantic search using the query, then hydrates
   * the matched entity IDs into readable names and content. The response
   * block is injected into the agent context before each turn.
   *
   * Invoked by:
   *   - Hermes 'prefetch'
   *   - OpenClaw 'assemble'
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
    //
    // Creating a thread/messages emits events internally; all async processing
    // downstream can be handled in event listeners.
    //
    // What we return here gets injected into the agent message before it goes
    // to the model. Latency here is user-visible, so partition sync (immediate)
    // from async (gradual enrichment).
  }
}
