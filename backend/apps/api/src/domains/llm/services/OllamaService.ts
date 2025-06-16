import { Injectable } from '@nestjs/common';

import { RequestContext } from '@ci/common/types';

import type { OllamaChunk } from '../types';

const PROMPT_MODEL = 'gemma3:1b';

interface PromptOptions {
  model?: string;
  signal?: AbortSignal;
}

@Injectable()
export class OllamaService {
  constructor() {}

  async *prompt(
    context: RequestContext,
    prompt: string,
    options?: PromptOptions,
  ): AsyncGenerator<OllamaChunk> {
    const resolvedOptions = options ?? ({} as PromptOptions);

    const { model = PROMPT_MODEL, signal } = resolvedOptions;

    const ollamaRes = await fetch('http://localhost:11434/api/generate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: model,
        prompt: prompt,
        stream: true,
      }),
      signal: signal,
    });

    if (ollamaRes.body == null) {
      return null;
    }

    const reader = ollamaRes.body.getReader();

    for await (const chunk of ndjsonStream<OllamaChunk>(reader)) {
      yield chunk;
    }
  }
}

async function* ndjsonStream<T>(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  decoder = new TextDecoder(),
) {
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();

    if (done) {
      break;
    }

    if (value) {
      buffer += decoder.decode(value, { stream: true });

      let lines = buffer.split('\n');

      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.trim()) {
          continue;
        }

        try {
          yield JSON.parse(line) as T;
        } catch (err) {
          // Optionally: log or ignore
          // console.error('JSON parse error on line:', line);
        }
      }
    }
  }

  // Flush last buffer
  if (buffer.trim()) {
    try {
      yield JSON.parse(buffer) as T;
    } catch (err) {
      // console.error('JSON parse error on buffer:', buffer);
    }
  }
}
