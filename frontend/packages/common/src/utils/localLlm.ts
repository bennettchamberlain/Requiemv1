/**
 * Client for the on-device LocalLLM sidecar (Phase 3 "Thinks" of the disconnected-mode
 * design doc). Unlike every other request in this app, sidecar traffic does NOT go
 * through `buildApiUrl()`/`fetchJson` — it targets the sidecar's own per-launch
 * `baseUrl` + bearer `token` (from `startLocalLlm()` in `nativeBridge.ts`), which is
 * unrelated to the appliance's configured `apiBaseUrl`. Adopting the sidecar as a
 * `buildApiUrl()` target — so the rest of the app talks to it transparently in an
 * offline "Local" mode — is the larger Rung-2 mode-switch and is deliberately out of
 * scope here; this module only proves the sidecar's chat-completions contract works.
 */

export interface LocalLlmChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LocalLlmConnection {
  baseUrl: string;
  token: string;
}

/**
 * Streams a chat completion from the sidecar, yielding text deltas as they arrive.
 * Speaks the same `POST /v1/chat/completions` (OpenAI-compatible, SSE) wire format the
 * native plugin's HTTP server implements — see `LocalLlmHttpServer.kt` /
 * `LocalLLMHTTPServer.swift`.
 */
export async function* streamLocalLlmCompletion(
  connection: LocalLlmConnection,
  messages: LocalLlmChatMessage[],
  options: { signal?: AbortSignal } = {},
): AsyncGenerator<string> {
  const response = await fetch(`${connection.baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${connection.token}`,
    },
    body: JSON.stringify({ messages, stream: true }),
    signal: options.signal,
  });

  if (!response.ok || !response.body) {
    throw new Error(`Local model request failed: ${response.status} ${response.statusText}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  for (;;) {
    const { done, value } = await reader.read();

    if (done) {
      return;
    }

    buffer += decoder.decode(value, { stream: true });

    // SSE frames are separated by a blank line; a response can straddle multiple reads.
    let separatorIndex = buffer.indexOf('\n\n');
    while (separatorIndex !== -1) {
      const frame = buffer.slice(0, separatorIndex);
      buffer = buffer.slice(separatorIndex + 2);

      const payload = frame.startsWith('data:') ? frame.slice(5).trim() : frame.trim();

      if (payload === '[DONE]') {
        return;
      }

      if (payload) {
        const delta = parseChunkDelta(payload);

        if (delta) {
          yield delta;
        }
      }

      separatorIndex = buffer.indexOf('\n\n');
    }
  }
}

function parseChunkDelta(payload: string): string | null {
  try {
    const chunk = JSON.parse(payload) as {
      error?: string;
      choices?: Array<{ delta?: { content?: string } }>;
    };

    if (chunk.error) {
      throw new Error(chunk.error);
    }

    return chunk.choices?.[0]?.delta?.content ?? null;
  } catch (err) {
    if (err instanceof SyntaxError) {
      // Not JSON — a malformed or unexpected frame; skip rather than abort the stream.
      return null;
    }

    throw err;
  }
}

/** Non-streaming variant: collects the full reply before resolving. */
export async function getLocalLlmCompletion(
  connection: LocalLlmConnection,
  messages: LocalLlmChatMessage[],
  options: { signal?: AbortSignal } = {},
): Promise<string> {
  let full = '';

  for await (const delta of streamLocalLlmCompletion(connection, messages, options)) {
    full += delta;
  }

  return full;
}
