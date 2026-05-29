import { Body, Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';

import { Context, type RequestContext, toServiceContext } from '@ci/common/context';
import { ApiKeyGuard } from '@ci/common/guards';
import { LoggerService } from '@ci/common/logging';
import { ValidationPipe } from '@ci/common/pipes';
import { NoteService } from '@ci/domains/notes';

import { ContextService } from '../services/ContextService';
import { RecallService } from '../services/RecallService';
import { noteSchema, recallSchema, type NoteDto, type RecallDto } from '../types';

@Controller('memory')
export class MemoryController {
  constructor(
    private readonly contextService: ContextService,
    private readonly recallService: RecallService,
    private readonly noteService: NoteService,
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
   * Stores a raw memory fragment written by the agent or by Hermes's built-in
   * memory system (on_memory_write hook).
   *
   * The fragment is saved verbatim to ci.notes.  A future cron job will batch
   * these fragments and use an LLM extraction pass to promote them into
   * structured entities and relationships in the knowledge graph.
   *
   * Invoked by:
   *   - Hermes 'on_memory_write'
   */
  @UseGuards(ApiKeyGuard)
  @HttpCode(201)
  @Post('note')
  async note(@Context() context: RequestContext, @Body(new ValidationPipe(noteSchema)) input: NoteDto) {
    const title = input.title ?? (input.source ? `[${input.source}]` : null);
    await this.noteService.create(toServiceContext(context), {
      title,
      content: input.content,
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
  }
}
