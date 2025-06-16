import { Body, Controller, HttpCode, Post, Res, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Response } from 'express';
import { z } from 'zod';

import { Context } from '@ci/common/decorators';
import { ValidationPipe } from '@ci/common/pipes';
import type { RequestContext } from '@ci/common/types';

import { OllamaService } from '../services/OllamaService';
import { PromptInput } from '../types';
import { LoggerService } from '@ci/common/services';

const promptSchema = z.object({
  prompt: z.string(),
});

@Controller('llm')
export class OllamaController {
  private logger = new LoggerService(OllamaController.name);

  constructor(private readonly ollamaService: OllamaService) {}

  @UseGuards(AuthGuard('jwt'))
  @Post('prompt')
  @HttpCode(200)
  async prompt(
    @Context() context: RequestContext,
    @Body(new ValidationPipe(promptSchema)) input: PromptInput,
    @Res() res: Response,
  ) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const abortController = new AbortController();

    res.on('close', () => {
      if (!abortController.signal.aborted) {
        abortController.abort();
      }
    });

    const stream = this.ollamaService.promptStream(context, input.prompt, {
      signal: abortController.signal,
    });

    try {
      for await (const chunk of stream) {
        if (chunk.response) {
          res.write(chunk.response);
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

      res.end();
    } catch (err) {
      if (abortController.signal.aborted) {
        this.logger.log('Client disconnected, aborted upstream Ollama request.');
      } else {
        this.logger.error('Error proxying Ollama stream:', err as Error);
      }

      res.end();
    }
  }
}
