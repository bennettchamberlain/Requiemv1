import { Injectable } from '@nestjs/common';
import ollama, { type ChatResponse, type GenerateResponse } from 'ollama';

import { RequestContext } from '@ci/common/types';

const PROMPT_MODEL = 'gemma3:1b';

interface PromptOptions {
  model?: string;
  signal?: AbortSignal;
}

@Injectable()
export class OllamaService {
  constructor() {}

  async *promptStream(
    context: RequestContext,
    prompt: string,
    options?: PromptOptions,
  ): AsyncGenerator<GenerateResponse> {
    const resolvedOptions = options ?? ({} as PromptOptions);

    const { model = PROMPT_MODEL, signal } = resolvedOptions;

    const iterator = await ollama.generate({
      model,
      prompt,
      stream: true,
    });

    signal?.addEventListener('abort', () => {
      iterator.abort();
    });

    for await (const chunk of iterator) {
      yield chunk;
    }
  }

  prompt(
    context: RequestContext,
    prompt: string,
    options?: Omit<PromptOptions, 'signal'>,
  ): Promise<GenerateResponse> {
    const resolvedOptions = options ?? ({} as PromptOptions);

    const { model = PROMPT_MODEL } = resolvedOptions;

    return ollama.generate({ model, prompt });
  }

  async *chatStream(
    context: RequestContext,
    prompt: string,
    options?: PromptOptions,
  ): AsyncGenerator<ChatResponse> {
    const resolvedOptions = options ?? ({} as PromptOptions);

    const { model = PROMPT_MODEL, signal } = resolvedOptions;

    const iterator = await ollama.chat({
      model,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
      stream: true,
    });

    signal?.addEventListener('abort', () => {
      iterator.abort();
    });

    for await (const chunk of iterator) {
      yield chunk;
    }
  }

  chat(
    context: RequestContext,
    prompt: string,
    options?: Omit<PromptOptions, 'signal'>,
  ): Promise<ChatResponse> {
    const resolvedOptions = options ?? ({} as PromptOptions);

    const { model = PROMPT_MODEL } = resolvedOptions;

    return ollama.chat({
      model,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    });
  }
}
