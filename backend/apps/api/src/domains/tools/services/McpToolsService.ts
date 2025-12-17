import { BadRequestException, Injectable, InternalServerErrorException } from '@nestjs/common';

import type { RequestContext } from '@ci/common/context';
import { LoggerService } from '@ci/common/logging';

import type { ToolSchema } from '../core/types';
import { McpToolProvider } from '../providers/mcp/McpToolProvider';
import type { McpHealthStatus, McpServerConfig, McpSession } from '../providers/mcp/types';

export interface McpServerDto {
  name: string;
  enabled: boolean;
  description?: string;
  status: 'running' | 'stopped' | 'error';
}

export interface McpSessionDto {
  id: string;
  serverName: string;
  status: McpSession['status'];
  startTime?: string;
  tools?: string[];
}

export interface McpToolDto {
  name: string;
  serverName: string;
  description?: string;
  schema?: ToolSchema['parameters'];
}

export interface McpHealthStatusDto {
  serverName: string;
  status: McpHealthStatus['status'];
  lastCheck: string;
  consecutiveFailures: number;
  uptime: number;
  responseTime?: number;
  error?: string;
}

export interface McpExecuteResult {
  success: boolean;
  result?: unknown;
  error?: string;
  executionTimeMs?: number;
}

@Injectable()
export class McpToolsService {
  constructor(
    private readonly mcpProvider: McpToolProvider,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(McpToolsService.name);
  }

  async listServers(context?: RequestContext): Promise<McpServerDto[]> {
    this.logger.debug('Fetching MCP server configurations', {
      userId: context?.userId,
    });

    const servers = this.mcpProvider.getAvailableServers();
    const sessions = this.mcpProvider.getActiveSessions();
    const sessionMap = new Map<string, McpSession>();

    for (const session of sessions) {
      sessionMap.set(session.serverName, session);
    }

    return servers.map((server) => ({
      name: server.name,
      enabled: Boolean(server.enabled),
      description: server.description,
      status: this.getServerStatus(sessionMap.get(server.name)),
    }));
  }

  async listSessions(context?: RequestContext): Promise<McpSessionDto[]> {
    this.logger.debug('Retrieving active MCP sessions', {
      userId: context?.userId,
    });

    const sessions = this.mcpProvider.getActiveSessions();
    const schemas = await this.mcpProvider.getAvailableTools();
    const toolsByServer = this.groupToolsByServer(schemas);

    return sessions.map((session) => ({
      id: session.id,
      serverName: session.serverName,
      status: session.status,
      startTime: session.startedAt?.toISOString(),
      tools: toolsByServer.get(session.serverName) ?? [],
    }));
  }

  async listTools(context?: RequestContext): Promise<McpToolDto[]> {
    this.logger.debug('Listing MCP tools', {
      userId: context?.userId,
    });

    const schemas = await this.mcpProvider.getAvailableTools();

    return schemas
      .map((schema) => this.toToolDto(schema))
      .filter((tool): tool is McpToolDto => tool !== null);
  }

  async listHealth(context?: RequestContext): Promise<McpHealthStatusDto[]> {
    this.logger.debug('Gathering MCP health status', {
      userId: context?.userId,
    });

    const healthStatuses = await this.mcpProvider.getServersHealthStatus();

    return healthStatuses.map((status) => ({
      serverName: status.serverName,
      status: status.status,
      lastCheck: status.lastCheck.toISOString(),
      consecutiveFailures: status.consecutiveFailures,
      uptime: status.uptime,
      responseTime: status.responseTime,
      error: status.error,
    }));
  }

  async startServer(
    serverName: string,
    context?: RequestContext,
  ): Promise<{ success: boolean; message: string }> {
    this.logger.log(`Request to start MCP server ${serverName}`, {
      userId: context?.userId,
      serverName,
    });

    await this.ensureServerExists(serverName);

    try {
      await this.mcpProvider.startServer(serverName);

      return { success: true, message: `Started MCP server '${serverName}'` };
    } catch (error) {
      this.logger.error(`Failed to start MCP server ${serverName}`, {
        serverName,
        userId: context?.userId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new InternalServerErrorException(
        error instanceof Error ? error.message : `Failed to start MCP server '${serverName}'`,
      );
    }
  }

  async stopServer(
    serverName: string,
    context?: RequestContext,
  ): Promise<{ success: boolean; message: string }> {
    this.logger.log(`Request to stop MCP server ${serverName}`, {
      userId: context?.userId,
      serverName,
    });

    await this.ensureServerExists(serverName);

    try {
      await this.mcpProvider.stopServer(serverName);

      return { success: true, message: `Stopped MCP server '${serverName}'` };
    } catch (error) {
      this.logger.error(`Failed to stop MCP server ${serverName}`, {
        serverName,
        userId: context?.userId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new InternalServerErrorException(
        error instanceof Error ? error.message : `Failed to stop MCP server '${serverName}'`,
      );
    }
  }

  async executeTool(
    serverName: string,
    toolName: string,
    args: unknown,
    context?: RequestContext,
  ): Promise<McpExecuteResult> {
    this.logger.log(`Executing MCP tool ${toolName}`, {
      serverName,
      userId: context?.userId,
    });

    await this.ensureServerExists(serverName);

    const result = await this.mcpProvider.executeServerTool(serverName, toolName, args ?? {});

    return {
      success: result.success,
      result: result.content,
      error: result.error,
      executionTimeMs: result.executionTimeMs,
    };
  }

  private getServerStatus(session?: McpSession): McpServerDto['status'] {
    if (!session) {
      return 'stopped';
    }

    if (session.status === 'error') {
      return 'error';
    }

    if (session.status === 'connected' || session.status === 'connecting') {
      return 'running';
    }

    return 'stopped';
  }

  private toToolDto(schema: ToolSchema): McpToolDto | null {
    const { serverName, toolName } = this.extractServerAndToolName(schema.name);

    if (!serverName || !toolName) {
      return null;
    }

    return {
      name: toolName,
      serverName,
      description: this.stripServerPrefixFromDescription(schema.description, serverName),
      schema: schema.parameters,
    };
  }

  private extractServerAndToolName(name: string): { serverName: string | null; toolName: string | null } {
    const [serverName, ...toolParts] = name.split(':');

    if (!serverName || toolParts.length === 0) {
      return { serverName: null, toolName: null };
    }

    return { serverName, toolName: toolParts.join(':') };
  }

  private stripServerPrefixFromDescription(
    description: string | undefined,
    serverName: string,
  ): string | undefined {
    if (!description) {
      return description;
    }

    const prefixPattern = new RegExp(`^\\[${serverName}\\]\\s*`, 'i');

    return description.replace(prefixPattern, '').trim() || undefined;
  }

  private async ensureServerExists(serverName: string): Promise<void> {
    const servers = this.mcpProvider.getAvailableServers();
    const exists = servers.some((server: McpServerConfig) => server.name === serverName);

    if (!exists) {
      throw new BadRequestException(`MCP server '${serverName}' is not configured`);
    }
  }

  private groupToolsByServer(schemas: ToolSchema[]): Map<string, string[]> {
    const toolsByServer = new Map<string, string[]>();

    for (const schema of schemas) {
      const { serverName, toolName } = this.extractServerAndToolName(schema.name);
      if (!serverName || !toolName) {
        continue;
      }

      const tools = toolsByServer.get(serverName) ?? [];
      tools.push(toolName);
      toolsByServer.set(serverName, tools);
    }

    return toolsByServer;
  }
}
