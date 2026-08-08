import { join } from 'node:path';

import { Injectable, OnModuleInit } from '@nestjs/common';

import { LoggerService } from '@ci/common/logging';
import config from '@ci/configuration';

import {
  containerSharedConfigPath,
  readSharedConfig,
  sharedConfigPath,
  syncAppEnvLlmVars,
  writeSharedConfig,
  type LlmBackendKind,
  type PersistedLlmEndpointSettings,
} from './llmEndpointShared';
import { OpenAiCompatChatDriver } from './OpenAiCompatChatDriver';

export type { LlmBackendKind };

/** User-facing LLM endpoint settings (backend kind + port). */
export interface LlmEndpointSettings {
  backend: LlmBackendKind;
  port: number;
  apiKey?: string;
}

export interface LlmEndpointView extends LlmEndpointSettings {
  /** Hostname the API container uses to reach an inference server on the host. */
  hostGateway: string;
  /** True when Hub/env injected LLM_* and settings cannot override. */
  locked: boolean;
}

interface ResolvedLlmEndpoint {
  settings: LlmEndpointSettings;
  hostGateway: string;
  ollamaHost: string;
  apiBase?: string;
  apiKey: string;
  locked: boolean;
}

const DEFAULT_OLLAMA_PORT = 11434;
const DEFAULT_OPENAI_PORT = 8000;

function inferHostGateway(): string {
  for (const candidate of [config.services.ollama.host, config.llm.apiBase]) {
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

function portFromUrl(url: string | undefined, fallback: number): number {
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

function envPointsToOpenAiCompat(): boolean {
  const apiBase = config.llm.apiBase?.trim();

  if (!apiBase) {
    return false;
  }

  const ollamaPort = portFromUrl(config.services.ollama.host, DEFAULT_OLLAMA_PORT);
  const apiPort = portFromUrl(apiBase, DEFAULT_OPENAI_PORT);

  return apiPort !== ollamaPort;
}

function settingsFromEnv(): { settings: LlmEndpointSettings; hostGateway: string; locked: boolean } {
  const hostGateway = inferHostGateway();
  const ollamaPort = portFromUrl(config.services.ollama.host, DEFAULT_OLLAMA_PORT);

  if (envPointsToOpenAiCompat()) {
    return {
      hostGateway,
      locked: true,
      settings: {
        backend: 'openai_compatible',
        port: portFromUrl(config.llm.apiBase, DEFAULT_OPENAI_PORT),
        apiKey: config.llm.apiKey,
      },
    };
  }

  return {
    hostGateway,
    locked: false,
    settings: {
      backend: 'ollama',
      port: ollamaPort,
      apiKey: config.llm.apiKey,
    },
  };
}

function isForeignApiBase(apiBase: string | undefined, ollamaHost: string): boolean {
  if (!apiBase) {
    return false;
  }

  try {
    return new URL(apiBase).host !== new URL(ollamaHost).host;
  } catch {
    return true;
  }
}

function buildResolved(settings: LlmEndpointSettings, hostGateway: string, locked: boolean): ResolvedLlmEndpoint {
  const ollamaHost = `http://${hostGateway}:${settings.backend === 'ollama' ? settings.port : DEFAULT_OLLAMA_PORT}`;
  const apiBase =
    settings.backend === 'openai_compatible' ? `http://${hostGateway}:${settings.port}/v1` : undefined;

  return {
    settings,
    hostGateway,
    ollamaHost: settings.backend === 'ollama' ? `http://${hostGateway}:${settings.port}` : ollamaHost,
    apiBase,
    apiKey: settings.apiKey?.trim() || config.llm.apiKey,
    locked,
  };
}

@Injectable()
export class LlmEndpointService implements OnModuleInit {
  private resolved!: ResolvedLlmEndpoint;

  private openAiDriver: OpenAiCompatChatDriver | null = null;

  constructor(private readonly logger: LoggerService) {
    this.logger.setContext(LlmEndpointService.name);
  }

  onModuleInit(): void {
    this.reload();
  }

  getView(): LlmEndpointView {
    return {
      ...this.resolved.settings,
      hostGateway: this.resolved.hostGateway,
      locked: this.resolved.locked,
    };
  }

  getOllamaHost(): string {
    return this.resolved.ollamaHost;
  }

  getOpenAiDriver(): OpenAiCompatChatDriver | null {
    return this.openAiDriver;
  }

  usesOpenAiDriver(): boolean {
    return this.openAiDriver != null;
  }

  update(settings: LlmEndpointSettings): LlmEndpointView {
    if (this.resolved.locked) {
      throw new Error('LLM endpoint is managed by the host environment and cannot be changed here.');
    }

    const hostGateway = this.resolved.hostGateway;
    const persisted = { ...settings, hostGateway };
    this.apply(buildResolved(settings, hostGateway, false));
    this.persist(persisted);

    return this.getView();
  }

  private reload(): void {
    const fromFile = this.readPersisted();
    const fromEnv = settingsFromEnv();

    if (fromEnv.locked) {
      this.apply(buildResolved(fromEnv.settings, fromEnv.hostGateway, true));

      return;
    }

    if (fromFile) {
      this.apply(buildResolved(fromFile.settings, fromFile.hostGateway, false), { syncAppEnv: false });

      return;
    }

    this.apply(buildResolved(fromEnv.settings, fromEnv.hostGateway, false), { syncAppEnv: false });
  }

  private apply(resolved: ResolvedLlmEndpoint, options: { syncAppEnv?: boolean } = {}): void {
    this.resolved = resolved;
    this.openAiDriver =
      resolved.apiBase && isForeignApiBase(resolved.apiBase, resolved.ollamaHost)
        ? new OpenAiCompatChatDriver(resolved.apiBase, resolved.apiKey)
        : null;

    this.logger.log('LLM endpoint resolved', {
      backend: resolved.settings.backend,
      port: resolved.settings.port,
      ollamaHost: resolved.ollamaHost,
      apiBase: resolved.apiBase ?? null,
      locked: resolved.locked,
    });

    if (options.syncAppEnv !== false && !resolved.locked) {
      try {
        syncAppEnvLlmVars({
          backend: resolved.settings.backend,
          hostGateway: resolved.hostGateway,
          port: resolved.settings.port,
          apiKey: resolved.apiKey,
        });
      } catch (error) {
        this.logger.warn('Failed to sync LLM vars to app.env', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  private configPaths(): string[] {
    const paths = [containerSharedConfigPath(), join(process.cwd(), '.llm-endpoint.json')];
    const hostShared = sharedConfigPath();

    if (hostShared) {
      paths.unshift(hostShared);
    }

    return [...new Set(paths)];
  }

  private readPersisted(): { settings: LlmEndpointSettings; hostGateway: string } | null {
    for (const path of this.configPaths()) {
      const parsed = readSharedConfig(path);

      if (!parsed) {
        continue;
      }

      return {
        settings: {
          backend: parsed.backend,
          port: parsed.port,
          apiKey: parsed.apiKey,
        },
        hostGateway: parsed.hostGateway?.trim() || inferHostGateway(),
      };
    }

    return null;
  }

  private persist(settings: PersistedLlmEndpointSettings): void {
    const paths = this.configPaths();

    for (const path of paths) {
      try {
        writeSharedConfig(path, settings);
      } catch (error) {
        this.logger.warn('Failed to persist LLM endpoint settings', {
          path,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
}
