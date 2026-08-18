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
});
