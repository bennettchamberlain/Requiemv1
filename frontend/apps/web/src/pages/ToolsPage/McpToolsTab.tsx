import { useRef } from 'react';

import { Badge, Button, Card } from '@ci/shadcn';
import {
  Activity,
  AlertCircle,
  CheckCircle,
  Clock,
  Play,
  Server,
  Settings,
  Square,
  Wrench,
  Zap,
} from '@ci/shadcn/icons';

import { useMcpService, type McpServer, type McpTool } from '@/api';

interface McpServerCardProps {
  serverName: string;
  tools: McpTool[];
  onStartServer: (serverName: string) => Promise<{ success: boolean; error?: string }>;
  onStopServer: (serverName: string) => Promise<{ success: boolean; error?: string }>;
  onExecuteTool: (
    serverName: string,
    toolName: string,
    args?: unknown,
  ) => Promise<{ success: boolean; result?: unknown; error?: string }>;
  getServerStatus: (serverName: string) => {
    enabled: boolean;
    status: string;
    health: string;
    uptime: number;
    lastError?: string;
  };
}

const McpServerCard = ({
  serverName,
  tools,
  onStartServer,
  onStopServer,
  onExecuteTool,
  getServerStatus,
}: McpServerCardProps) => {
  const serverStatus = getServerStatus(serverName);
  const isRunning = serverStatus.status === 'connected' || serverStatus.status === 'connecting';
  const isHealthy = serverStatus.health === 'healthy';

  const getStatusIcon = () => {
    if (isRunning && isHealthy) {
      return <CheckCircle className="h-4 w-4 text-green-600" />;
    }

    if (isRunning && !isHealthy) {
      return <AlertCircle className="h-4 w-4 text-yellow-600" />;
    }

    return <AlertCircle className="h-4 w-4 text-red-600" />;
  };

  const getStatusText = () => {
    if (serverStatus.status === 'connecting') {
      return 'Connecting...';
    }

    if (isRunning && isHealthy) {
      return 'Running';
    }

    if (isRunning && !isHealthy) {
      return 'Running (Unhealthy)';
    }

    return 'Stopped';
  };

  const getStatusColor = () => {
    if (serverStatus.status === 'connecting') {
      return 'bg-blue-100 text-blue-700';
    }

    if (isRunning && isHealthy) {
      return 'bg-green-100 text-green-700';
    }

    if (isRunning && !isHealthy) {
      return 'bg-yellow-100 text-yellow-700';
    }

    return 'bg-red-100 text-red-700';
  };

  const handleServerToggle = async () => {
    if (isRunning) {
      await onStopServer(serverName);
    } else {
      await onStartServer(serverName);
    }
  };

  const handleToolExecution = async (toolName: string) => {
    // For demo purposes, just show it works
    await onExecuteTool(serverName, toolName, {});
  };

  return (
    <Card className="h-full overflow-hidden">
      <Card.Header className="pb-3">
        <div className="flex items-start justify-between gap-2 min-w-0">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <div className="p-2 rounded-lg bg-primary/10 text-primary flex-shrink-0">
              <Server className="h-6 w-6" />
            </div>
            <div className="min-w-0 flex-1">
              <Card.Title className="text-lg truncate">{serverName}</Card.Title>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                <Badge variant="secondary" className="text-xs">
                  {tools.length} tools
                </Badge>
                <span
                  className={`text-xs px-2 py-1 rounded-full flex items-center gap-1 ${getStatusColor()}`}
                >
                  {getStatusIcon()}
                  {getStatusText()}
                </span>
              </div>
            </div>
          </div>

          <div className="flex flex-col items-end gap-2 flex-shrink-0">
            <Button
              size="sm"
              variant={isRunning ? 'destructive' : 'default'}
              onClick={handleServerToggle}
              className="min-w-[80px]"
            >
              {isRunning ? (
                <>
                  <Square className="h-4 w-4 mr-1" />
                  Stop
                </>
              ) : (
                <>
                  <Play className="h-4 w-4 mr-1" />
                  Start
                </>
              )}
            </Button>

            {serverStatus.uptime > 0 && (
              <div className="text-xs text-muted-foreground flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {Math.floor(serverStatus.uptime / 1000)}s uptime
              </div>
            )}
          </div>
        </div>
      </Card.Header>

      <Card.Content className="space-y-4">
        {serverStatus.lastError && (
          <div className="text-xs text-red-600 bg-red-50 p-2 rounded-md flex items-start gap-2">
            <AlertCircle className="h-3 w-3 mt-0.5 flex-shrink-0" />
            <span>{serverStatus.lastError}</span>
          </div>
        )}

        <div>
          <h4 className="text-sm font-medium mb-2 flex items-center gap-2">
            <Wrench className="h-4 w-4" />
            Available Tools:
          </h4>

          {tools.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">No tools available</p>
          ) : (
            <div className="space-y-2">
              {tools.map((tool, index) => (
                <div
                  key={index}
                  className="flex items-center justify-between p-2 bg-muted/30 rounded-md gap-2 min-w-0"
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium truncate">{tool.name}</div>
                    {tool.description && (
                      <div className="text-xs text-muted-foreground truncate">{tool.description}</div>
                    )}
                  </div>

                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleToolExecution(tool.name)}
                    disabled={!isRunning}
                    className="h-6 px-2 flex-shrink-0"
                  >
                    <Zap className="h-3 w-3" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>

        {!serverStatus.enabled && (
          <div className="text-xs text-orange-600 bg-orange-50 p-2 rounded-md flex items-start gap-2">
            <Settings className="h-3 w-3 mt-0.5 flex-shrink-0" />
            <span>This server is disabled in configuration</span>
          </div>
        )}
      </Card.Content>
    </Card>
  );
};

export function McpToolsTab() {
  const {
    servers,
    toolsByServer,
    isLoading,
    error,
    refreshData,
    startServer,
    stopServer,
    executeTool,
    getServerStatus,
  } = useMcpService();

  // Establish a shared mock start time for demo cards - moved to top level to satisfy Rules of Hooks
  const mockBaseStartRef = useRef<number>(Date.now() - 1000 * 60 * 47); // ~47 minutes ago
  const mockUptimeOffsets: Record<string, number> = {
    'Weather Service': 0, // base
    'Calendar Integration': 1000 * 60 * 2, // +2 min
    'Email Integration': 1000 * 60 * 4 + 30 * 1000, // +4.5 min
    'Financial Markets': 1000 * 60 * 3 + 15 * 1000, // +3.25 min
    'Translation Service': 1000 * 60 * 1 + 45 * 1000, // +1.75 min
    'WhatsApp Bridge': 1000 * 60 * 5 + 20 * 1000, // +5.33 min
    'Plaid Bridge': 1000 * 60 * 6 + 10 * 1000, // +6.17 min
  };

  // Check if we're in demo mode by looking for demo indicators
  const isDemoMode = error && error.includes('unavailable');

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-12 space-y-4">
        <Activity className="h-8 w-8 animate-spin text-primary" />
        <p className="text-muted-foreground">Loading MCP servers and tools...</p>
      </div>
    );
  }

  if (error && !isDemoMode) {
    return (
      <div className="flex flex-col items-center justify-center py-12 space-y-4">
        <AlertCircle className="h-8 w-8 text-destructive" />
        <div className="text-center">
          <p className="text-destructive font-medium">Failed to load MCP data</p>
          <p className="text-sm text-muted-foreground mt-1">{error}</p>
          <Button onClick={refreshData} variant="outline" className="mt-4">
            Retry
          </Button>
        </div>
      </div>
    );
  }

  if (servers.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 space-y-4">
        <Server className="h-8 w-8 text-muted-foreground" />
        <div className="text-center">
          <p className="font-medium">No MCP servers found</p>
          <p className="text-sm text-muted-foreground mt-1">
            Configure MCP servers in your backend to see tools here
          </p>
          <Button onClick={refreshData} variant="outline" className="mt-4">
            Refresh
          </Button>
        </div>
      </div>
    );
  }

  // Mock servers - purely aesthetic with no functionality
  const mockServers: McpServer[] = [
    {
      name: 'Weather Service',
      enabled: true,
      description: 'Comprehensive weather data, forecasts, and environmental monitoring',
    },
    {
      name: 'Calendar Integration',
      enabled: true,
      description: 'Full calendar management with events, reminders, and scheduling',
    },
    {
      name: 'Email Integration',
      enabled: true,
      description: 'Email management, sending, reading, and organization',
    },
    {
      name: 'Financial Markets',
      enabled: true,
      description: 'Real-time stock quotes, market data, and cryptocurrency prices',
    },
    {
      name: 'Translation Service',
      enabled: true,
      description: 'Multi-language translation and localization services',
    },
    {
      name: 'WhatsApp Bridge',
      enabled: true,
      description:
        'Provides a secure bridge to your WhatsApp account, enabling message search, contact management, and sending capabilities while keeping all data stored locally on your device',
    },
    {
      name: 'Plaid Bridge',
      enabled: true,
      description:
        'Provides a robust bridge to the Plaid financial API, enabling secure access to bank account data, transactions, and authentication flows for financial analysis and personal finance tracking',
    },
  ];

  // Mock tools for each mock server
  const mockTools: Record<string, McpTool[]> = {
    'Weather Service': [
      {
        name: 'get_current_weather',
        description: 'Get current weather conditions for a specific location',
        serverName: 'Weather Service',
      },
      {
        name: 'get_hourly_forecast',
        description: 'Get detailed hourly weather forecast for the next 48 hours',
        serverName: 'Weather Service',
      },
      {
        name: 'get_daily_forecast',
        description: 'Get daily weather forecast for up to 10 days',
        serverName: 'Weather Service',
      },
      {
        name: 'get_weather_alerts',
        description: 'Retrieve active weather alerts and warnings for a location',
        serverName: 'Weather Service',
      },
      {
        name: 'get_historical_weather',
        description: 'Get historical weather data for a date and location',
        serverName: 'Weather Service',
      },
      {
        name: 'get_air_quality',
        description: 'Get current air quality index and pollution levels',
        serverName: 'Weather Service',
      },
      {
        name: 'get_uv_index',
        description: 'Get current UV index and sun protection recommendations',
        serverName: 'Weather Service',
      },
      {
        name: 'compare_locations',
        description: 'Compare weather conditions across multiple locations',
        serverName: 'Weather Service',
      },
      {
        name: 'get_precipitation',
        description: 'Get current precipitation data including rain, snow, and precipitation probability',
        serverName: 'Weather Service',
      },
    ],
    'Calendar Integration': [
      {
        name: 'create_event',
        description: 'Create a new calendar event with title, date, time, and location',
        serverName: 'Calendar Integration',
      },
      {
        name: 'list_events',
        description: 'List upcoming calendar events within a date range',
        serverName: 'Calendar Integration',
      },
      {
        name: 'update_event',
        description: 'Update an existing calendar event details',
        serverName: 'Calendar Integration',
      },
      {
        name: 'delete_event',
        description: 'Delete a calendar event by ID',
        serverName: 'Calendar Integration',
      },
      {
        name: 'get_event_details',
        description: 'Get detailed information about a specific calendar event',
        serverName: 'Calendar Integration',
      },
      {
        name: 'create_recurring_event',
        description: 'Create a recurring event with custom recurrence patterns',
        serverName: 'Calendar Integration',
      },
      {
        name: 'check_availability',
        description: 'Check calendar availability for a specific time slot',
        serverName: 'Calendar Integration',
      },
      {
        name: 'find_free_time',
        description: 'Find free time slots in the calendar for a duration',
        serverName: 'Calendar Integration',
      },
      {
        name: 'create_reminder',
        description: 'Create a reminder or notification for an event',
        serverName: 'Calendar Integration',
      },
      {
        name: 'invite_attendees',
        description: 'Send calendar invitations to attendees for an event',
        serverName: 'Calendar Integration',
      },
      {
        name: 'respond_to_invitation',
        description: 'Respond to a calendar invitation (accept, decline, tentative)',
        serverName: 'Calendar Integration',
      },
      {
        name: 'get_calendar_summary',
        description: 'Get a summary of events for a day, week, or month',
        serverName: 'Calendar Integration',
      },
      {
        name: 'set_timezone',
        description: 'Set or update timezone settings for calendar operations',
        serverName: 'Calendar Integration',
      },
      {
        name: 'search_events',
        description: 'Search calendar events by keywords, attendees, or location',
        serverName: 'Calendar Integration',
      },
      {
        name: 'export_calendar',
        description: 'Export calendar events in various formats (ICS, CSV, JSON)',
        serverName: 'Calendar Integration',
      },
    ],
    'Email Integration': [
      {
        name: 'send_email',
        description: 'Send an email with recipients, subject, body, and attachments',
        serverName: 'Email Integration',
      },
      {
        name: 'read_email',
        description: 'Read emails from inbox with filtering and pagination',
        serverName: 'Email Integration',
      },
      {
        name: 'get_email_details',
        description: 'Get detailed information about a specific email',
        serverName: 'Email Integration',
      },
      {
        name: 'search_emails',
        description: 'Search emails by subject, sender, content, or date range',
        serverName: 'Email Integration',
      },
      {
        name: 'reply_to_email',
        description: 'Reply to an email thread with context',
        serverName: 'Email Integration',
      },
      {
        name: 'forward_email',
        description: 'Forward an email to one or more recipients',
        serverName: 'Email Integration',
      },
      {
        name: 'delete_email',
        description: 'Delete emails or move them to trash',
        serverName: 'Email Integration',
      },
      {
        name: 'organize_emails',
        description: 'Organize emails into folders or apply labels',
        serverName: 'Email Integration',
      },
      {
        name: 'get_unread_count',
        description: 'Get count of unread emails in inbox',
        serverName: 'Email Integration',
      },
      {
        name: 'mark_as_read',
        description: 'Mark emails as read or unread',
        serverName: 'Email Integration',
      },
      {
        name: 'create_draft',
        description: 'Create and save an email draft',
        serverName: 'Email Integration',
      },
      {
        name: 'manage_attachments',
        description: 'Download, upload, or manage email attachments',
        serverName: 'Email Integration',
      },
    ],
    'Financial Markets': [
      {
        name: 'get_stock_quote',
        description: 'Get real-time stock price quote for a ticker symbol',
        serverName: 'Financial Markets',
      },
      {
        name: 'get_stock_history',
        description: 'Get historical stock price data for a ticker and date range',
        serverName: 'Financial Markets',
      },
      {
        name: 'get_market_summary',
        description: 'Get overall market summary and indices performance',
        serverName: 'Financial Markets',
      },
      {
        name: 'get_crypto_price',
        description: 'Get current cryptocurrency price for a symbol',
        serverName: 'Financial Markets',
      },
      {
        name: 'get_crypto_history',
        description: 'Get historical cryptocurrency price data',
        serverName: 'Financial Markets',
      },
      {
        name: 'get_portfolio_value',
        description: 'Calculate total value of a portfolio with multiple holdings',
        serverName: 'Financial Markets',
      },
      {
        name: 'get_company_info',
        description: 'Get company information, financials, and key metrics',
        serverName: 'Financial Markets',
      },
      {
        name: 'get_market_news',
        description: 'Get latest financial news and market updates',
        serverName: 'Financial Markets',
      },
      {
        name: 'compare_stocks',
        description: 'Compare performance of multiple stocks side by side',
        serverName: 'Financial Markets',
      },
      {
        name: 'get_dividend_info',
        description: 'Get dividend information and ex-dividend dates',
        serverName: 'Financial Markets',
      },
      {
        name: 'get_options_chain',
        description: 'Get options chain data for a stock ticker',
        serverName: 'Financial Markets',
      },
      {
        name: 'get_forex_rates',
        description: 'Get foreign exchange rates between currency pairs',
        serverName: 'Financial Markets',
      },
    ],
    'Translation Service': [
      {
        name: 'translate_text',
        description: 'Translate text from one language to another',
        serverName: 'Translation Service',
      },
      {
        name: 'detect_language',
        description: 'Detect the language of a given text',
        serverName: 'Translation Service',
      },
      {
        name: 'translate_batch',
        description: 'Translate multiple text segments in a single request',
        serverName: 'Translation Service',
      },
      {
        name: 'translate_with_context',
        description: 'Translate text with context to improve accuracy',
        serverName: 'Translation Service',
      },
      {
        name: 'get_supported_languages',
        description: 'Get list of all supported source and target languages',
        serverName: 'Translation Service',
      },
      {
        name: 'transliterate_text',
        description: 'Convert text between different writing systems',
        serverName: 'Translation Service',
      },
      {
        name: 'translate_document',
        description: 'Translate an entire document preserving formatting',
        serverName: 'Translation Service',
      },
      {
        name: 'get_translation_confidence',
        description: 'Get confidence score for a translation quality',
        serverName: 'Translation Service',
      },
      {
        name: 'localize_content',
        description: 'Adapt content for specific regional or cultural context',
        serverName: 'Translation Service',
      },
      {
        name: 'translate_audio',
        description: 'Translate spoken audio content to text in another language',
        serverName: 'Translation Service',
      },
    ],
    'WhatsApp Bridge': [
      {
        name: 'search_messages',
        description: 'Search through WhatsApp messages by keywords, sender, date range, or chat',
        serverName: 'WhatsApp Bridge',
      },
      {
        name: 'send_message',
        description: 'Send a text message to a contact or group via WhatsApp',
        serverName: 'WhatsApp Bridge',
      },
      {
        name: 'get_contacts',
        description: 'Retrieve list of WhatsApp contacts with names and phone numbers',
        serverName: 'WhatsApp Bridge',
      },
      {
        name: 'get_chat_history',
        description: 'Get message history for a specific chat or contact',
        serverName: 'WhatsApp Bridge',
      },
      {
        name: 'send_media',
        description: 'Send images, videos, documents, or audio files through WhatsApp',
        serverName: 'WhatsApp Bridge',
      },
      {
        name: 'create_group',
        description: 'Create a new WhatsApp group with multiple participants',
        serverName: 'WhatsApp Bridge',
      },
      {
        name: 'get_group_info',
        description: 'Get information about a WhatsApp group including members and settings',
        serverName: 'WhatsApp Bridge',
      },
      {
        name: 'mark_as_read',
        description: 'Mark messages as read or unread in a conversation',
        serverName: 'WhatsApp Bridge',
      },
      {
        name: 'delete_message',
        description: 'Delete messages from a chat (for everyone or just yourself)',
        serverName: 'WhatsApp Bridge',
      },
      {
        name: 'archive_chat',
        description: 'Archive or unarchive WhatsApp chats',
        serverName: 'WhatsApp Bridge',
      },
      {
        name: 'get_profile_info',
        description: 'Get WhatsApp profile information including status and profile picture',
        serverName: 'WhatsApp Bridge',
      },
      {
        name: 'reply_to_message',
        description: 'Reply to a specific message in a chat thread',
        serverName: 'WhatsApp Bridge',
      },
    ],
    'Plaid Bridge': [
      {
        name: 'link_account',
        description: 'Initiate Plaid Link flow to connect a new bank account',
        serverName: 'Plaid Bridge',
      },
      {
        name: 'get_accounts',
        description: 'Retrieve all connected bank accounts with balances and details',
        serverName: 'Plaid Bridge',
      },
      {
        name: 'get_transactions',
        description: 'Get transaction history for accounts within a date range',
        serverName: 'Plaid Bridge',
      },
      {
        name: 'get_account_balance',
        description: 'Get current balance for a specific bank account',
        serverName: 'Plaid Bridge',
      },
      {
        name: 'get_identity',
        description: 'Retrieve account holder identity information from connected accounts',
        serverName: 'Plaid Bridge',
      },
      {
        name: 'refresh_accounts',
        description: 'Refresh account data and balances from connected institutions',
        serverName: 'Plaid Bridge',
      },
      {
        name: 'get_account_info',
        description:
          'Get detailed information about a specific account including type, subtype, and institution details',
        serverName: 'Plaid Bridge',
      },
      {
        name: 'categorize_transactions',
        description: 'Categorize transactions by type (food, transportation, entertainment, etc.)',
        serverName: 'Plaid Bridge',
      },
      {
        name: 'get_income',
        description: 'Extract income information from connected accounts',
        serverName: 'Plaid Bridge',
      },
      {
        name: 'create_asset_report',
        description: 'Generate a comprehensive asset report for all connected accounts',
        serverName: 'Plaid Bridge',
      },
      {
        name: 'get_investments',
        description: 'Retrieve investment holdings and securities information',
        serverName: 'Plaid Bridge',
      },
      {
        name: 'remove_account',
        description: 'Disconnect and remove a linked bank account',
        serverName: 'Plaid Bridge',
      },
      {
        name: 'get_liabilities',
        description: 'Get credit card and loan liability information',
        serverName: 'Plaid Bridge',
      },
      {
        name: 'analyze_spending',
        description: 'Analyze spending patterns and trends across accounts',
        serverName: 'Plaid Bridge',
      },
    ],
  };

  // Combine real and mock servers
  const allServers = [...servers, ...mockServers];

  // Combine real and mock tools
  const allToolsMap = { ...toolsByServer, ...mockTools };

  // No-op handlers for mock servers
  const handleMockServerAction = async () => {
    return { success: true };
  };

  const handleMockToolExecution = async () => {
    return { success: true, result: 'Mock tool execution (no functionality)' };
  };

  // Wrapper for start/stop that checks if server is mock
  const handleStartServer = async (serverName: string) => {
    if (mockServers.some((s) => s.name === serverName)) {
      return handleMockServerAction();
    }

    return startServer(serverName);
  };

  const handleStopServer = async (serverName: string) => {
    if (mockServers.some((s) => s.name === serverName)) {
      return handleMockServerAction();
    }

    return stopServer(serverName);
  };

  const handleExecuteTool = async (serverName: string, toolName: string, args?: unknown) => {
    if (mockServers.some((s) => s.name === serverName)) {
      return handleMockToolExecution();
    }

    return executeTool(serverName, toolName, args);
  };

  // Wrapper for getServerStatus that handles mock servers
  const getServerStatusWithMocks = (serverName: string) => {
    if (mockServers.some((s) => s.name === serverName)) {
      const mockServer = mockServers.find((s) => s.name === serverName);

      return {
        enabled: mockServer?.enabled ?? true,
        status: 'connected' as const,
        health: 'healthy' as const,
        uptime: Math.max(0, Date.now() - (mockBaseStartRef.current + (mockUptimeOffsets[serverName] ?? 0))),
      };
    }

    return getServerStatus(serverName);
  };

  const totalTools = Object.values(allToolsMap).reduce((total, toolList) => total + toolList.length, 0);
  const activeServers = allServers.filter((server) => server.status === 'running');

  return (
    <div className="space-y-6">
      {/* Demo Mode Banner */}
      {isDemoMode && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-amber-600 mt-0.5 flex-shrink-0" />
            <div>
              <h3 className="text-sm font-medium text-amber-800">Demo Mode Active</h3>
              <p className="text-sm text-amber-700 mt-1">
                MCP backend is not available. Showing sample data for demonstration purposes. Server controls
                will simulate actions but won't affect real services.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Header Section */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-xl font-semibold">MCP Server Tools</h2>
          <p className="text-sm text-muted-foreground">
            External tools provided by Model Context Protocol servers
          </p>
        </div>
        <Button onClick={refreshData} variant="outline" size="sm" className="self-start md:self-auto">
          <Activity className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      {/* Stats Section */}
      <div className="flex gap-4 text-sm">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 bg-green-500 rounded-full"></div>
          <span>{totalTools} Total Tools</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 bg-blue-500 rounded-full"></div>
          <span>{activeServers.length} Active Servers</span>
        </div>
      </div>

      {/* Servers Grid */}
      <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
        {allServers.map((server) => (
          <McpServerCard
            key={server.name}
            serverName={server.name}
            tools={allToolsMap[server.name] ?? []}
            onStartServer={handleStartServer}
            onStopServer={handleStopServer}
            onExecuteTool={handleExecuteTool}
            getServerStatus={getServerStatusWithMocks}
          />
        ))}
      </div>
    </div>
  );
}
