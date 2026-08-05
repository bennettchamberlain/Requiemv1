import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export type LlmBackendKind = 'ollama' | 'openai_compatible';

export interface PersistedLlmEndpointSettings {
  backend: LlmBackendKind;
  port: number;
  apiKey?: string;
  hostGateway?: string;
}

export interface ResolvedLlmEndpointEnv {
  backend: LlmBackendKind;
  hostGateway: string;
  port: number;
  apiKey: string;
}

const DEFAULT_OLLAMA_PORT = 11434;

/** Host path shared between API and summary-service when APP_DATA_DIR is mounted at /app-data. */
export function sharedConfigPath(): string | null {
  const appDataDir = process.env.APP_DATA_DIR?.trim();

  if (!appDataDir) {
    return null;
  }

  return join(appDataDir, 'data', 'llm-endpoint.json');
}

export function containerSharedConfigPath(): string {
  return process.env.LLM_ENDPOINT_CONFIG_PATH?.trim() || '/app-data/data/llm-endpoint.json';
}

export function llmApiBaseFromSettings(settings: ResolvedLlmEndpointEnv): string {
  if (settings.backend === 'openai_compatible') {
    return `http://${settings.hostGateway}:${settings.port}/v1`;
  }

  return `http://${settings.hostGateway}:${settings.port}/v1`;
}

export function writeSharedConfig(path: string, settings: PersistedLlmEndpointSettings): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(settings, null, 2));
}

export function readSharedConfig(path: string): PersistedLlmEndpointSettings | null {
  if (!existsSync(path)) {
    return null;
  }

  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as PersistedLlmEndpointSettings;

    if (parsed.backend !== 'ollama' && parsed.backend !== 'openai_compatible') {
      return null;
    }

    if (!Number.isFinite(parsed.port) || parsed.port <= 0 || parsed.port > 65535) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

/** Keep app.env LLM_* in sync so summary-service picks up Settings changes on restart. */
export function syncAppEnvLlmVars(settings: ResolvedLlmEndpointEnv): void {
  const appDataDir = process.env.APP_DATA_DIR?.trim();

  if (!appDataDir) {
    return;
  }

  const appEnvPath = join(appDataDir, 'app.env');

  if (!existsSync(appEnvPath)) {
    return;
  }

  const llmVars: Record<string, string> = {
    LLM_API_BASE: llmApiBaseFromSettings(settings),
    LLM_API_KEY: settings.apiKey,
  };

  const lines = readFileSync(appEnvPath, 'utf8').split('\n');
  const seen = new Set<string>();
  const nextLines = lines.map((line) => {
    const match = /^([A-Z0-9_]+)=/.exec(line);

    if (!match) {
      return line;
    }

    const key = match[1];
    const value = llmVars[key];

    if (value === undefined) {
      return line;
    }

    seen.add(key);

    return `${key}=${value}`;
  });

  for (const [key, value] of Object.entries(llmVars)) {
    if (!seen.has(key)) {
      nextLines.push(`${key}=${value}`);
    }
  }

  writeFileSync(appEnvPath, nextLines.join('\n'));
}

export function inferHostGatewayFromEnv(): string {
  for (const candidate of [
    process.env.OLLAMA_HOST,
    process.env.LLM_API_BASE,
    process.env.CI_OLLAMA_EMBED_HOST,
  ]) {
    if (!candidate) {
      continue;
    }

    try {
      return new URL(candidate).hostname;
    } catch {
      // keep trying
    }
  }

  return 'host.docker.internal';
}

export function portFromUrl(url: string | undefined, fallback: number): number {
  if (!url) {
    return fallback;
  }

  try {
    const parsed = new URL(url);

    return parsed.port ? Number.parseInt(parsed.port, 10) : parsed.protocol === 'https:' ? 443 : 80;
  } catch {
    return fallback;
  }
}

export { DEFAULT_OLLAMA_PORT };
