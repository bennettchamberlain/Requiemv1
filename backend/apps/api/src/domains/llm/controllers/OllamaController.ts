import { Body, Controller, HttpCode, Post, Res, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Response } from 'express';
import { TextDecoder } from 'util';
import { z } from 'zod';

import { Context } from '@ci/common/decorators';
import { ValidationPipe } from '@ci/common/pipes';
import type { RequestContext } from '@ci/common/types';

import { OllamaService } from '../services/OllamaService';
import { OllamaChunk, PromptInput } from '../types';
import { ndjsonStream } from '../utils';
import { LoggerService } from '@ci/common/services';

const PROMPT_MODEL = 'gemma3:1b';

const promptSchema = z.object({
  prompt: z.string(),
});

@Controller('llm')
export class OllamaController {
  private logger = new LoggerService(OllamaController.name);

  constructor(private readonly ollamaService: OllamaService) {}

  // @UseGuards(AuthGuard('jwt'))
  @Post('prompt')
  @HttpCode(200)
  async prompt(
    @Context() context: RequestContext,
    @Body(new ValidationPipe(promptSchema)) input: PromptInput,
    @Res() res: Response,
  ) {
    const abortController = new AbortController();

    res.on('close', () => {
      if (!abortController.signal.aborted) {
        abortController.abort();
      }
    });

    const ollamaRes = await fetch('http://localhost:11434/api/generate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: PROMPT_MODEL,
        prompt: input.prompt,
        stream: true,
      }),
      signal: abortController.signal,
    });

    if (ollamaRes.body == null) {
      return res.sendStatus(204);
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const reader = ollamaRes.body.getReader();

    try {
      for await (const chunk of ndjsonStream<OllamaChunk>(reader)) {
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
