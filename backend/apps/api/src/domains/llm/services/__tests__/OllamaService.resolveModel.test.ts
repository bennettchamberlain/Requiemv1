import { OllamaService } from '../OllamaService';

function makeLogger() {
  return {
    setContext: jest.fn(),
    debug: jest.fn(),
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
}

function buildService(served: string[]) {
  const driver = {
    listModels: jest.fn(async () => served),
    chat: jest.fn(),
  };
  const service = new OllamaService(
    { getOpenAiDriver: () => driver } as never,
    { getAgentFacingTools: () => [] } as never,
    makeLogger() as never,
    { isFeatureEnabled: jest.fn(async () => false) } as never,
  );

  return { service, driver };
}

function buildNativeService(served: string[], visionIds: readonly string[]) {
  const vision = new Set(visionIds);
  const service = new OllamaService(
    { getOpenAiDriver: () => null, usesOpenAiDriver: () => false } as never,
    { getAgentFacingTools: () => [] } as never,
    makeLogger() as never,
    { isFeatureEnabled: jest.fn(async () => false) } as never,
  );

  const spies = service as unknown as {
    listServedChatModelIds: () => Promise<string[]>;
    fetchModelCapabilities: (id: string, opts?: { throwOnError?: boolean }) => Promise<string[]>;
  };

  jest.spyOn(spies, 'listServedChatModelIds').mockResolvedValue(served);
  jest
    .spyOn(spies, 'fetchModelCapabilities')
    .mockImplementation(async (id: string) => (vision.has(id) ? ['vision'] : ['completion', 'tools']));

  return service;
}

const ctx = { userId: 'user-1' };

describe('OllamaService.resolveModel uses the loaded backend model', () => {
  it('prefers a requested id when that model is actually served', async () => {
    const { service } = buildService(['Qwen3.8-27B-Uncensored', 'other']);

    const resolved = await service.resolveModel(ctx, { requestedModel: 'Qwen3.8-27B-Uncensored' });

    expect(resolved.model).toBe('Qwen3.8-27B-Uncensored');
  });

  it('falls back to the live vLLM/Ollama model when the config default is not loaded', async () => {
    const { service } = buildService(['Qwen3.8-27B-Uncensored']);

    const resolved = await service.resolveModel(ctx, { requestedModel: 'gemma3:1b' });

    expect(resolved.model).toBe('Qwen3.8-27B-Uncensored');
  });

  it('uses the first served chat model when nothing was requested', async () => {
    const { service } = buildService(['Qwen3.8-27B-Uncensored']);

    const resolved = await service.resolveModel(ctx);

    expect(resolved.model).toBe('Qwen3.8-27B-Uncensored');
  });

  it('errors when the backend is serving no chat models', async () => {
    const { service } = buildService([]);

    await expect(service.resolveModel(ctx)).rejects.toThrow(/No chat model is currently loaded/);
  });

  it('falls back past an unloaded vision default like llava:7b on vLLM', async () => {
    const { service } = buildService(['Qwen3-8B']);

    const resolved = await service.resolveModel(ctx, {
      requestedModel: 'llava:7b',
      messages: [{ role: 'user', content: 'describe', images: ['abc'] as never }],
    });

    expect(resolved.model).toBe('Qwen3-8B');
  });

  it('prefers a loaded Ollama vision model when the turn carries images', async () => {
    const service = buildNativeService(['Qwen3-8B', 'llava:13b'], ['llava:13b']);

    const resolved = await service.resolveModel(ctx, {
      requestedModel: 'llava:7b',
      messages: [{ role: 'user', content: 'describe', images: ['abc'] as never }],
    });

    expect(resolved.model).toBe('llava:13b');
  });

  it('does not send images to a loaded text chat model when a vision model is served', async () => {
    const service = buildNativeService(['Qwen3-8B', 'llava:13b'], ['llava:13b']);

    const resolved = await service.resolveModel(ctx, {
      requestedModel: 'Qwen3-8B',
      messages: [{ role: 'user', content: 'describe', images: ['abc'] as never }],
    });

    expect(resolved.model).toBe('llava:13b');
  });
});
