import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  llmApiBaseFromSettings,
  readSharedConfig,
  syncAppEnvLlmVars,
  writeSharedConfig,
} from '../llmEndpointShared';

describe('llmEndpointShared', () => {
  it('writes and reads shared endpoint config', () => {
    const dir = mkdtempSync(join(tmpdir(), 'llm-endpoint-'));
    const path = join(dir, 'llm-endpoint.json');

    writeSharedConfig(path, {
      backend: 'openai_compatible',
      port: 8000,
      apiKey: 'vllm-local',
      hostGateway: 'host.docker.internal',
    });

    expect(readSharedConfig(path)).toEqual({
      backend: 'openai_compatible',
      port: 8000,
      apiKey: 'vllm-local',
      hostGateway: 'host.docker.internal',
    });
  });

  it('builds OpenAI-compatible base URLs', () => {
    expect(
      llmApiBaseFromSettings({
        backend: 'openai_compatible',
        hostGateway: 'host.docker.internal',
        port: 8000,
        apiKey: 'vllm-local',
      }),
    ).toBe('http://host.docker.internal:8000/v1');
  });

  it('patches app.env with LLM vars', () => {
    const dir = mkdtempSync(join(tmpdir(), 'app-env-'));
    const appEnvPath = join(dir, 'app.env');

    writeFileSync(appEnvPath, 'APP_PORT=8642\nLLM_API_BASE=http://host.docker.internal:11434/v1\n');

    process.env.APP_DATA_DIR = dir;

    syncAppEnvLlmVars({
      backend: 'openai_compatible',
      hostGateway: 'host.docker.internal',
      port: 8000,
      apiKey: 'vllm-local',
    });

    expect(readFileSync(appEnvPath, 'utf8')).toContain('LLM_API_BASE=http://host.docker.internal:8000/v1');
    expect(readFileSync(appEnvPath, 'utf8')).toContain('LLM_API_KEY=vllm-local');

    delete process.env.APP_DATA_DIR;
  });
});
