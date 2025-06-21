import { Injectable } from '@nestjs/common';
import ollama, { type ChatResponse, type GenerateResponse, type Message as OllamaMessage } from 'ollama';

import type { RequestContext } from '@ci/common/types';

import type { Message } from '../types';

import { MessageService } from './MessageService';

const PROMPT_MODEL = 'gemma3:1b';

interface PromptOptions {
  model?: string;
  signal?: AbortSignal;
}

type MessagesInput = Pick<Message, 'prompt' | 'text'>[];

@Injectable()
export class OllamaService {
  constructor(private readonly messageService: MessageService) {}

  generateStream(
    context: RequestContext,
    prompt: string,
    options?: PromptOptions,
  ): AsyncGenerator<GenerateResponse> & { buffer: string } {
    const chunks: string[] = [];

    const stream = (async function* () {
      const resolvedOptions = options ?? {};
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
        if (chunk && !!chunk.response) {
          chunks.push(chunk.response);
        }

        yield chunk;
      }
    })();

    Object.defineProperty(stream, 'buffer', {
      enumerable: true,
      get: () => chunks.join(''),
    });

    return stream as typeof stream & { buffer: string };
  }

  generate(
    context: RequestContext,
    prompt: string,
    options?: Omit<PromptOptions, 'signal'>,
  ): Promise<GenerateResponse> {
    const resolvedOptions = options ?? ({} as PromptOptions);

    const { model = PROMPT_MODEL } = resolvedOptions;

    return ollama.generate({
      model,
      prompt,
    });
  }

  chatStream(
    context: RequestContext,
    messages: MessagesInput,
    options?: PromptOptions,
  ): AsyncGenerator<ChatResponse> & { buffer: string } {
    const chunks: string[] = [];

    const stream = (async function* (self) {
      const resolvedOptions = options ?? {};
      const { model = PROMPT_MODEL, signal } = resolvedOptions;

      const iterator = await ollama.chat({
        model,
        messages: self.toOllamaMessages(messages),
        stream: true,
      });

      signal?.addEventListener('abort', () => {
        iterator.abort();
      });

      for await (const chunk of iterator) {
        if (chunk && !!chunk.message) {
          // TODO: Handle other properties on `chunk.message`.
          //   chunk.message.images?
          //   chunk.message.role
          //   chunk.message.tool_calls?
          chunks.push(chunk.message.content);
        }

        yield chunk;
      }
    })(this);

    Object.defineProperty(stream, 'buffer', {
      enumerable: true,
      get: () => chunks.join(''),
    });

    return stream as typeof stream & { buffer: string };
  }

  chat(
    context: RequestContext,
    messages: MessagesInput,
    options?: Omit<PromptOptions, 'signal'>,
  ): Promise<ChatResponse> {
    const resolvedOptions = options ?? ({} as PromptOptions);

    const { model = PROMPT_MODEL } = resolvedOptions;

    return ollama.chat({
      model,
      messages: this.toOllamaMessages(messages)
    });
  }

  private toOllamaMessages(messages: MessagesInput) {
    const ollamaMessages: OllamaMessage[] = messages.map(
      (message) =>
        ({
          role: message.prompt ? 'user' : 'system',
          content: message.text ?? '',
        }) satisfies OllamaMessage,
    );

    return ollamaMessages;
  }
}
