import { Body, Controller, Get, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';

import { Context, type RequestContext, toServiceContext } from '@ci/common/context';
import { ApiKeyGuard } from '@ci/common/guards';
import { ValidationPipe } from '@ci/common/pipes';

import { AbsorbService } from '../services/AbsorbService';
import { RecallService } from '../services/RecallService';
import {
  absorbSchema,
  recallSchema,
  toolCallSchema,
  type AbsorbDto,
  type AbsorbResult,
  type ContextResult,
  type RecallDto,
  type RecallResult,
  type ToolCallDto,
  type ToolResult,
} from '../types';

@Controller('agent')
export class AgentContextController {
  constructor(
    private readonly recallService: RecallService,
    private readonly absorbService: AbsorbService,
  ) {}

  /**
   * Returns the L0 static user context block (profile, family, preferences).
   * Called once at MemoryProvider.initialize() and cached for the session.
   */
  @UseGuards(ApiKeyGuard)
  @Get('context')
  getContext(@Context() context: RequestContext): Promise<ContextResult> {
    return this.recallService.getL0Context(toServiceContext(context));
  }

  /**
   * Semantic search against the knowledge graph (L1).
   * Called from MemoryProvider.queue_prefetch() on a background thread.
   */
  @UseGuards(ApiKeyGuard)
  @Post('recall')
  recall(
    @Context() context: RequestContext,
    @Body(new ValidationPipe(recallSchema)) input: RecallDto,
  ): Promise<RecallResult> {
    return this.recallService.recall(toServiceContext(context), input);
  }

  /**
   * Ingests a conversation turn into the knowledge graph (fire-and-forget).
   * Returns 202 immediately; storage happens asynchronously.
   */
  @UseGuards(ApiKeyGuard)
  @Post('absorb')
  @HttpCode(HttpStatus.ACCEPTED)
  absorb(
    @Context() context: RequestContext,
    @Body(new ValidationPipe(absorbSchema)) input: AbsorbDto,
  ): AbsorbResult {
    this.absorbService.absorb(toServiceContext(context), input);

    return { accepted: true };
  }

  /**
   * Dispatches an explicit tool call from the agent (ci_search, ci_query, ci_remember).
   */
  @UseGuards(ApiKeyGuard)
  @Post('tools')
  handleToolCall(
    @Context() context: RequestContext,
    @Body(new ValidationPipe(toolCallSchema)) input: ToolCallDto,
  ): Promise<ToolResult> {
    return this.recallService.handleToolCall(toServiceContext(context), input);
  }
}
