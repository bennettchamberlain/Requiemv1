import { Body, Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';

import { Context, type RequestContext, toServiceContext } from '@ci/common/context';
import { ApiKeyGuard, JwtOrApiKeyAuthGuard } from '@ci/common/guards';
import { LoggerService } from '@ci/common/logging';
import { ValidationPipe } from '@ci/common/pipes';
import { MemoryCompactionService } from '@ci/domains/llm';
import { UserContextService } from '@ci/domains/memory';
import { NoteService } from '@ci/domains/notes';

import { RecallService } from '../services/RecallService';
import { noteSchema, recallSchema, type NoteDto, type RecallDto } from '../types';

@Controller('memory')
export class MemoryController {
  constructor(
    private readonly userContextService: UserContextService,
    private readonly recallService: RecallService,
    private readonly noteService: NoteService,
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
   *
   * Invoked by:
   *   - Hermes 'system_prompt_block'
   *   - OpenClaw 'assemble'
   */
  @UseGuards(ApiKeyGuard)
  @Get('context')
  async context(@Context() context: RequestContext) {
    const serviceContext = toServiceContext(context);

    try {
      const userCtx = await this.userContextService.getUserContextForLLM(serviceContext.userId);

      if (!userCtx) {
        return {
          block: '',
        };
      }

      const block = this.userContextService.formatContextForSystemPrompt(userCtx);

      return {
        block,
      };
    } catch (err) {
      this.logger.warn(`L0 context failed for user ${context.userId}: ${err}`);

      return {
        block: '',
      };
    }
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

  // ---------------------------------------------------------------------------
  // Settings UI endpoints (JWT or API key — usable from the browser)
  // ---------------------------------------------------------------------------

  /**
   * Returns up to 50 of the most recent memory fragments for the current user,
   * including their processed_at timestamp so the settings UI can show status.
   *
   * Invoked by the Agent Memory settings section.
   */
  @UseGuards(JwtOrApiKeyAuthGuard)
  @Get('notes')
  async notes(@Context() context: RequestContext) {
    const notes = await this.noteService.findAll(toServiceContext(context), { take: 50 });

    return notes.map((n) => ({
      id: n.id,
      title: n.title,
      content: n.content,
      createdAt: n.createdAt instanceof Date ? n.createdAt.toISOString() : n.createdAt,
      processedAt: n.processedAt instanceof Date ? n.processedAt.toISOString() : (n.processedAt ?? null),
    }));
  }

  /**
   * Manually triggers the memory compaction worker for the current user's
   * unprocessed fragments.  The LLM call runs in the background; the response
   * returns immediately with the count of queued fragments.
   *
   * Invoked by the "Compact Now" button in the Agent Memory settings section.
   */
  @UseGuards(JwtOrApiKeyAuthGuard)
  @HttpCode(200)
  @Post('compact')
  async compact(@Context() context: RequestContext) {
    const userId = context.userId;
    if (!userId) {
      return { queued: 0 };
    }

    const ctx = toServiceContext(context);
    const unprocessed = await this.noteService.findUnprocessed(ctx, { limit: 50 });

    if (unprocessed.length === 0) {
      return { queued: 0 };
    }

    void this.compactionService
      .compactForUser(userId, unprocessed)
      .catch((err: unknown) =>
        this.logger.error('Manual compaction failed', err instanceof Error ? err : new Error(String(err))),
      );

    return { queued: unprocessed.length };
  }
}
