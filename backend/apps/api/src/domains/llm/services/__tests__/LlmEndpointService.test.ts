import config from '@ci/configuration';

import { LlmEndpointService } from '../LlmEndpointService';

jest.mock('../llmEndpointShared', () => {
  const actual = jest.requireActual('../llmEndpointShared');

  return {
    ...actual,
    readSharedConfig: jest.fn(() => null),
    writeSharedConfig: jest.fn(),
  };
});

jest.mock('@ci/configuration', () => ({
  __esModule: true,
  default: {
    logging: { level: 'error' },
    services: { ollama: { host: 'http://localhost:11434' } },
    llm: { apiBase: undefined, apiKey: 'ollama', chatModel: 'gemma3:1b' },
  },
}));

describe('LlmEndpointService', () => {
  const logger = {
    setContext: jest.fn(),
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };

  beforeEach(() => {
    (config as { llm: { apiBase?: string; apiKey: string } }).llm.apiBase = undefined;
    (config as { llm: { apiBase?: string; apiKey: string } }).llm.apiKey = 'ollama';
  });

  it('defaults to Ollama on the inferred host gateway', () => {
    const service = new LlmEndpointService(logger as never);
    service.onModuleInit();

    expect(service.getView()).toEqual({
      backend: 'ollama',
      port: 11434,
      apiKey: 'ollama',
      hostGateway: 'localhost',
      locked: false,
    });
    expect(service.usesOpenAiDriver()).toBe(false);
  });

  it('switches to an OpenAI-compatible driver when settings are updated', () => {
    const service = new LlmEndpointService(logger as never);
    service.onModuleInit();

    service.update({
      backend: 'openai_compatible',
      port: 8000,
      apiKey: 'vllm-local',
    });

    expect(service.getView()).toMatchObject({
      backend: 'openai_compatible',
      port: 8000,
      apiKey: 'vllm-local',
      locked: false,
    });
    expect(service.usesOpenAiDriver()).toBe(true);
    expect(service.getOllamaHost()).toBe('http://localhost:11434');
  });

  it('treats a non-Ollama LLM_API_BASE port as locked Hub config', () => {
    (config as { llm: { apiBase?: string } }).llm.apiBase = 'http://host.docker.internal:8000/v1';

    const service = new LlmEndpointService(logger as never);
    service.onModuleInit();

    expect(service.getView()).toMatchObject({
      backend: 'openai_compatible',
      port: 8000,
      locked: true,
    });
    expect(service.usesOpenAiDriver()).toBe(true);
  });
});
