import { useState, useEffect, useCallback } from 'react';

import { useAuth } from '@/hooks';

// Types for MCP API responses
export interface McpServer {
  name: string;
  enabled: boolean;
  description?: string;
  status?: 'running' | 'stopped' | 'error';
}

export interface McpSession {
  id: string;
  serverName: string;
  status: 'connecting' | 'connected' | 'disconnected' | 'error';
  startTime?: string;
  tools?: string[];
}

export interface McpTool {
  name: string;
  description?: string;
  serverName: string;
  schema?: {
    type: string;
    properties?: Record<string, unknown>;
    required?: string[];
  };
}

export interface McpHealthStatus {
  serverName: string;
  status: 'healthy' | 'unhealthy' | 'unknown';
  lastCheck: Date;
  consecutiveFailures: number;
  uptime: number;
  responseTime?: number;
  error?: string;
}

// API base URL - dynamically determine based on environment
const getApiBase = () => {
  // If running on dev.companionintelligence.com, use the production API
  if (window.location.hostname === 'dev.companionintelligence.com') {
    return 'https://dev.companionintelligence.com'; // Adjust this to your actual backend URL
  }

  // For local development
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    return 'http://localhost:3030';
  }

  // Default fallback - use same origin
  return window.location.origin;
};

const API_BASE = getApiBase();

class McpApiService {
  private async request<T>(endpoint: string, authToken: string | null, options?: RequestInit): Promise<T> {
    const response = await fetch(`${API_BASE}${endpoint}`, {
      headers: {
        'Content-Type': 'application/json',
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        // Add auth headers if needed
        ...options?.headers,
      },
      ...options,
    });

    if (!response.ok) {
      throw new Error(`MCP API error: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  async getServers(authToken: string | null): Promise<McpServer[]> {
    return this.request<McpServer[]>('/api/mcp/servers', authToken);
  }

  async getSessions(authToken: string | null): Promise<McpSession[]> {
    return this.request<McpSession[]>('/api/mcp/sessions', authToken);
  }

  async getTools(authToken: string | null): Promise<McpTool[]> {
    return this.request<McpTool[]>('/api/mcp/tools', authToken);
  }

  async getHealth(authToken: string | null): Promise<McpHealthStatus[]> {
    return this.request<McpHealthStatus[]>('/api/mcp/health', authToken);
  }

  async startServer(
    authToken: string | null,
    serverName: string,
  ): Promise<{ success: boolean; message: string }> {
    return this.request(`/api/mcp/servers/${serverName}/start`, authToken, {
      method: 'POST',
    });
  }

  async stopServer(
    authToken: string | null,
    serverName: string,
  ): Promise<{ success: boolean; message: string }> {
    return this.request(`/api/mcp/servers/${serverName}/stop`, authToken, {
      method: 'POST',
    });
  }

  async executeTool(
    authToken: string | null,
    serverName: string,
    toolName: string,
    args: unknown,
  ): Promise<unknown> {
    return this.request('/api/mcp/execute', authToken, {
      method: 'POST',
      body: JSON.stringify({
        serverName,
        toolName,
        arguments: args,
      }),
    });
  }
}

const mcpApi = new McpApiService();

export function useMcpService() {
  const [{ authToken }] = useAuth();
  const [servers, setServers] = useState<McpServer[]>([]);
  const [sessions, setSessions] = useState<McpSession[]>([]);
  const [tools, setTools] = useState<McpTool[]>([]);
  const [health, setHealth] = useState<McpHealthStatus[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refreshData = useCallback(async () => {
    const token = authToken ?? null;
    setIsLoading(true);
    setError(null);

    try {
      const [serversData, sessionsData, toolsData, healthData] = await Promise.allSettled([
        mcpApi.getServers(token),
        mcpApi.getSessions(token),
        mcpApi.getTools(token),
        mcpApi.getHealth(token),
      ]);

      if (serversData.status === 'fulfilled') {
        setServers(serversData.value);
      }

      if (sessionsData.status === 'fulfilled') {
        setSessions(sessionsData.value);
      }

      if (toolsData.status === 'fulfilled') {
        setTools(toolsData.value);
      }

      if (healthData.status === 'fulfilled') {
        setHealth(healthData.value);
      }

      // Check if any critical errors occurred
      const errors = [serversData, sessionsData, toolsData, healthData]
        .filter((result) => result.status === 'rejected')
        .map((result) => (result as PromiseRejectedResult).reason.message);

      if (errors.length > 0) {
        setError(`Some data failed to load: ${errors.join(', ')}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error occurred');
    } finally {
      setIsLoading(false);
    }
  }, [authToken]);

  const startServer = useCallback(
    async (serverName: string) => {
      const token = authToken ?? null;
      try {
        await mcpApi.startServer(token, serverName);
        // Refresh data after starting server
        await refreshData();

        return { success: true };
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : 'Failed to start server',
        };
      }
    },
    [authToken, refreshData],
  );

  const stopServer = useCallback(
    async (serverName: string) => {
      const token = authToken ?? null;
      try {
        await mcpApi.stopServer(token, serverName);
        // Refresh data after stopping server
        await refreshData();

        return { success: true };
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : 'Failed to stop server',
        };
      }
    },
    [authToken, refreshData],
  );

  const executeTool = useCallback(
    async (serverName: string, toolName: string, args: unknown = {}) => {
      const token = authToken ?? null;
      try {
        const result = await mcpApi.executeTool(token, serverName, toolName, args);

        return { success: true, result };
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : 'Failed to execute tool',
        };
      }
    },
    [authToken],
  );

  // Load data on mount
  useEffect(() => {
    refreshData();
  }, [refreshData]);

  // Get server status by merging servers, sessions, and health data
  const getServerStatus = useCallback(
    (serverName: string) => {
      const server = servers.find((s) => s.name === serverName);
      const session = sessions.find((s) => s.serverName === serverName);
      const healthStatus = health.find((h) => h.serverName === serverName);

      return {
        enabled: server?.enabled ?? false,
        status: session?.status ?? 'disconnected',
        health: healthStatus?.status ?? 'unknown',
        uptime: healthStatus?.uptime ?? 0,
        lastError: healthStatus?.error,
      };
    },
    [servers, sessions, health],
  );

  // Group tools by server
  const toolsByServer = useCallback(() => {
    const grouped: Record<string, McpTool[]> = {};

    tools.forEach((tool) => {
      if (!grouped[tool.serverName]) {
        grouped[tool.serverName] = [];
      }

      grouped[tool.serverName].push(tool);
    });

    return grouped;
  }, [tools]);

  return {
    servers,
    sessions,
    tools,
    health,
    isLoading,
    error,
    refreshData,
    startServer,
    stopServer,
    executeTool,
    getServerStatus,
    toolsByServer: toolsByServer(),
  };
}
