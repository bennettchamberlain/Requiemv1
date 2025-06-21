import { Body, Controller, HttpCode, NotFoundException, Post, Res, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Response } from 'express';
import { z } from 'zod';

import { Context } from '@ci/common/decorators';
import { ValidationPipe } from '@ci/common/pipes';
import { LoggerService } from '@ci/common/services';
import type { RequestContext } from '@ci/common/types';

import { MessageService } from '../services/MessageService';
import { OllamaService } from '../services/OllamaService';
import { ThreadService } from '../services/ThreadService';
import type { PromptInput } from '../types';

const DEFAULT_MODEL = 'gemma3:1b';

const promptSchema = z.object({
  prompt: z.string(),
  model: z.optional(z.string()),
  threadId: z.string().nullable().optional(),
});

@Controller('llm')
export class OllamaController {
  private logger = new LoggerService(OllamaController.name);

  constructor(
    private readonly messageService: MessageService,
    private readonly ollamaService: OllamaService,
    private readonly threadService: ThreadService,
  ) {}

  @UseGuards(AuthGuard('jwt'))
  @Post('generate')
  @HttpCode(200)
  async generate(
    @Context() context: RequestContext,
    @Body(new ValidationPipe(promptSchema)) input: PromptInput,
    @Res() res: Response,
  ) {
    let threadId: string;

    if (input.threadId != null) {
      const threadExists = await this.threadService.exists(context, input.threadId);

      if (!threadExists) {
        throw new NotFoundException('Thread not found');
      }

      threadId = input.threadId;
    } else {
      const thread = await this.threadService.create(context, {
        model: DEFAULT_MODEL, // TODO: Make this user input and validate it.
      });
      threadId = thread.id;

      // TODO: Kick off a Promise to name and describe the chat. Do this in parallel and update the metadata in the `finally` block? Can also Event it.
      // Let's do this with an event to build up good practice examples. We don't need it here anyway. We don't want to bog response down until it finishes,
      // especially if Ollama serializes the requests. We'll delegate the complexity to the frontend and long-poll perhaps until we have a summary.
    }

    const prompt = await this.messageService.create(context, {
      model: DEFAULT_MODEL, // TODO: Make this user input and validate it.
      text: input.prompt,
      mimetype: 'text/markdown', // TODO: Make this more flexible.
      prompt: true,
      canceled: false,
      threadId,
    });

    // Pre-create the message that will be updated after the stream
    // terminates with more content and resolution.
    const llmResponse = await this.messageService.create(context, {
      model: DEFAULT_MODEL, // TODO: Make this user input and validate it.
      // text -> We are updating this after the stream terminates
      // mimetype // TODO: Infer this from the content stream
      prompt: false,
      // canceled -> We are updating this after the stream terminates
      threadId,
      promptMessageId: prompt.id,
    });

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Thread-Id', threadId);
    res.setHeader('X-Prompt-Id', prompt.id);
    res.setHeader('X-Response-Id', llmResponse.id);

    const abortController = new AbortController();
    const signal = abortController.signal;

    res.on('close', () => {
      if (!signal.aborted) {
        abortController.abort();
      }
    });

    const messages = await this.messageService.findByThread(context, threadId);
    const filteredMessages = messages.filter((message) => message.id !== llmResponse.id);

    const stream = this.ollamaService.chatStream(context, filteredMessages, {
      signal,
    });

    try {
      for await (const chunk of stream) {
        if (chunk.message) {
          // TODO: Handle other properties on `chunk.message`.
          //   chunk.message.images?
          //   chunk.message.role
          //   chunk.message.tool_calls?
          res.write(chunk.message.content);
        }

        if (chunk.done) {
          this.logger.log('Ollama prompt evaluation completed', {
            model: chunk.model,
            totalDuration: chunk.total_duration ? chunk.total_duration / 1_000_000 : undefined,
            loadDuration: chunk.load_duration ? chunk.load_duration / 1_000_000 : undefined,
            evalDuration: chunk.prompt_eval_duration ? chunk.prompt_eval_duration / 1_000_000 : undefined,
            promptCount: chunk.prompt_eval_count,
            evalCount: chunk.eval_count,
            doneReason: chunk.done_reason,
          });
        }
      }
    } catch (err) {
      if (signal.aborted) {
        this.logger.log('Client disconnected, aborted upstream Ollama request.');
      } else {
        this.logger.error('Error proxying Ollama stream:', err as Error);
      }
    } finally {
      await this.messageService.update(context, llmResponse.id, {
        text: stream.buffer,
        canceled: signal.aborted,
      });

      res.end();
    }
  }
}
