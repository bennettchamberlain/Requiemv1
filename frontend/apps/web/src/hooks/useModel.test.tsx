import { type ReactNode } from 'react';

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ModelProvider, useModel } from './useModel';

vi.mock('./useAuth', () => ({
  AuthProvider: ({ children }: { children: ReactNode }) => children,
  useAuth: () => [{ authToken: 'test-token', expired: false, loading: false, error: null }, {}],
}));

const MODELS = [
  {
    model: 'llama3',
    namespace: null,
    name: 'Llama 3',
    tag: null,
    vision: false,
    tools: true,
    thinking: false,
  },
  {
    model: 'qwen-vl',
    namespace: null,
    name: 'Qwen VL',
    tag: null,
    vision: true,
    tools: true,
    thinking: true,
  },
];

function setFetch(body: unknown, ok = true) {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve({ ok, status: ok ? 200 : 500, text: async () => JSON.stringify(body) } as Response),
    ),
  );
}

const wrapper = ({ children }: { children: ReactNode }) => (
  <ModelProvider args={[]}>{children}</ModelProvider>
);

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe('useModel', () => {
  it('loads models and selects the first by default', async () => {
    setFetch(MODELS);

    const { result } = renderHook(() => useModel(), { wrapper });

    await waitFor(() => expect(result.current[0].loading).toBe(false));
    expect(result.current[0].activeModels).toHaveLength(2);
    expect(result.current[0].selectedModel).toBe('llama3');
  });

  it('restores the persisted model when still available', async () => {
    localStorage.setItem('activeModel', 'qwen-vl');
    setFetch(MODELS);

    const { result } = renderHook(() => useModel(), { wrapper });

    await waitFor(() => expect(result.current[0].selectedModel).toBe('qwen-vl'));
  });

  it('selecting a vision model also sets the vision model and persists both', async () => {
    setFetch(MODELS);
    const { result } = renderHook(() => useModel(), { wrapper });
    await waitFor(() => expect(result.current[0].loading).toBe(false));

    act(() => result.current[1].selectModel('qwen-vl'));

    expect(result.current[0].selectedModel).toBe('qwen-vl');
    expect(result.current[0].selectedVisionModel).toBe('qwen-vl');
    expect(localStorage.getItem('activeModel')).toBe('qwen-vl');
    expect(localStorage.getItem('activeVisionModel')).toBe('qwen-vl');
  });

  it('derives thinking/tools support from the selected model and respects the toggle', async () => {
    setFetch(MODELS);
    const { result } = renderHook(() => useModel(), { wrapper });
    await waitFor(() => expect(result.current[0].loading).toBe(false));

    // Default selection llama3: tools yes, thinking no.
    expect(result.current[0].toolsSupported).toBe(true);
    expect(result.current[0].thinkingSupported).toBe(false);
    expect(result.current[0].thinkingEnabled).toBe(false); // preferred but unsupported

    act(() => result.current[1].selectModel('qwen-vl'));
    expect(result.current[0].thinkingSupported).toBe(true);
    expect(result.current[0].thinkingEnabled).toBe(true);

    act(() => result.current[1].toggleThinking());
    expect(result.current[0].thinkingEnabled).toBe(false);
  });

  it('surfaces an error when the model request fails', async () => {
    setFetch({}, false);

    const { result } = renderHook(() => useModel(), { wrapper });

    await waitFor(() => expect(result.current[0].loading).toBe(false));
    expect(result.current[0].error).toBeTruthy();
  });

  // Regression: an empty list is a normal recoverable backend state (Ollama
  // unreachable, no models pulled, LLM endpoint misconfigured). Indexing
  // `data[0].model` threw a TypeError that the surrounding try/catch turned into
  // a bogus `error`, so the UI reported a failure for a request that succeeded.
  it('handles an empty model list as an empty selection, not an error', async () => {
    setFetch([]);

    const { result } = renderHook(() => useModel(), { wrapper });

    await waitFor(() => expect(result.current[0].loading).toBe(false));
    expect(result.current[0].error).toBeNull();
    expect(result.current[0].activeModels).toEqual([]);
    expect(result.current[0].selectedModel).toBeNull();
    expect(result.current[0].selectedVisionModel).toBeNull();
    expect(result.current[0].thinkingSupported).toBe(false);
    expect(result.current[0].toolsSupported).toBe(false);
  });

  // Regression: `fetchJson` casts the parsed body to `Model[]` without checking,
  // so a non-array payload reached `setActiveModels` and every later
  // `activeModels.find(...)` threw *during render* — outside the fetch try/catch.
  // ModelProvider wraps the whole routed tree in App.tsx, so that unmounted the
  // entire app: a blank page on every route, not just the model selector.
  it('tolerates a non-array payload without throwing during render', async () => {
    setFetch({ error: 'llm endpoint misconfigured' });

    const { result } = renderHook(() => useModel(), { wrapper });

    await waitFor(() => expect(result.current[0].loading).toBe(false));
    expect(result.current[0].activeModels).toEqual([]);
    expect(result.current[0].selectedModel).toBeNull();
    expect(result.current[0].thinkingSupported).toBe(false);
  });

  // The empty list must not strand a stale selection from a previous session:
  // a model that is no longer served cannot be used just because it is persisted.
  it('drops a persisted model that the server no longer lists', async () => {
    localStorage.setItem('activeModel', 'qwen-vl');
    localStorage.setItem('activeVisionModel', 'qwen-vl');
    setFetch([]);

    const { result } = renderHook(() => useModel(), { wrapper });

    await waitFor(() => expect(result.current[0].loading).toBe(false));
    expect(result.current[0].selectedModel).toBeNull();
    expect(result.current[0].selectedVisionModel).toBeNull();
  });
});
