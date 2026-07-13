import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import {
  BadRequestException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Headers,
  NotFoundException,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';

import { Context, type RequestContext } from '@ci/common/context';
import { MCP_SCOPE, RequireScopes } from '@ci/common/decorators';
import { type ApiKeyScopedRequest, JwtOrApiKeyAuthGuard } from '@ci/common/guards';
import { LoggerService } from '@ci/common/logging';

import { McpServerService } from '../services/McpServerService';

/** How long a session can be idle before it is reaped (ms). */
const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes

interface SessionEntry {
  transport: StreamableHTTPServerTransport;
  lastActivity: number;
  userId: string;
  /** The authority the session was built for — see {@link apiKeyScopeSignature}. */
  scopeSignature: string;
}

/**
 * A stable identity for the caller's api-key authority.
 *
 * The MCP server — its tool list AND every tool handler's captured request — is
 * built once, at `initialize`. A session is therefore frozen to the authority of
 * whoever opened it. Matching on `userId` alone is not enough: on a single-owner
 * appliance the owner's browser session (full authority) and an agent's
 * scope-limited connect key are the SAME user, so the agent could present the
 * owner's `Mcp-Session-Id` and inherit a transport whose GraphQL tools were
 * registered for a full-authority principal — with the handlers' captured request
 * carrying that authority into the resolvers. Binding the session to the scope set
 * as well means a session can only ever be resumed by the same authority that
 * opened it.
 */
function apiKeyScopeSignature(req: ApiKeyScopedRequest): string {
  const scopes = req.apiKeyScopes;

  // Distinct sentinels: a session/JWT principal is not the same authority as an
  // empty-scope (legacy full-access) key, even though both carry full authority.
  if (scopes === undefined) {
    return 'principal:non-api-key';
  }

  return `scopes:${[...scopes].sort().join(',')}`;
}

// Scope-limited connect keys need the `mcp` scope to reach MCP (CI-Hermes's key
// carries it); session/JWT and empty-scope keys are unaffected.
@Controller('mcp')
@UseGuards(JwtOrApiKeyAuthGuard)
@RequireScopes(MCP_SCOPE)
export class McpController {
  private sessions = new Map<string, SessionEntry>();

  constructor(
    private readonly mcpServerService: McpServerService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext('McpController');
  }

  /**
   * POST /mcp – handles all JSON-RPC messages (initialize, tool calls, etc.).
   * On initialize, a new transport + session is created.
   * Subsequent requests must include the Mcp-Session-Id header.
   */
  @Post()
  async handlePost(@Context() context: RequestContext, @Req() req: Request, @Res() res: Response) {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;

    let transport: StreamableHTTPServerTransport | undefined;

    if (sessionId) {
      const entry = this.sessions.get(sessionId);

      if (!entry) {
        throw new NotFoundException();
      }

      if (entry.userId !== context.userId) {
        throw new UnauthorizedException();
      }

      // The session's tools were registered for the authority that opened it, so it
      // may only be resumed by that same authority (see apiKeyScopeSignature).
      if (entry.scopeSignature !== apiKeyScopeSignature(req)) {
        throw new UnauthorizedException();
      }

      transport = entry.transport;
      entry.lastActivity = Date.now();
    } else if (this.isInitializeBody(req.body)) {
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => uuidv4(),
      });

      const server = this.mcpServerService.createServer(req);

      await server.connect(transport);

      transport.onclose = () => {
        const sid = transport?.sessionId;

        if (sid) {
          this.sessions.delete(sid);

          this.logger.log('MCP session closed', {
            sessionId: sid,
          });
        }
      };
    } else {
      res.status(400).json({
        error: 'Missing Mcp-Session-Id header. Send an initialize request first.',
      });

      return;
    }

    await transport.handleRequest(req, res, req.body);

    // After handling an initialize request, the transport now has its sessionId assigned
    if (!sessionId && transport.sessionId) {
      const userId = context.userId ?? 'unknown';

      this.sessions.set(transport.sessionId, {
        transport,
        lastActivity: Date.now(),
        userId,
        scopeSignature: apiKeyScopeSignature(req),
      });

      this.logger.log('MCP session created', {
        sessionId: transport.sessionId,
        userId,
      });
    }
  }

  /**
   * GET /mcp – opens an SSE stream for server-initiated notifications.
   * The client must include the Mcp-Session-Id header from a prior initialize.
   */
  @Get()
  async handleGet(@Context() context: RequestContext, @Req() req: Request, @Res() res: Response) {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;

    if (!sessionId) {
      res.status(400).json({ error: 'Missing Mcp-Session-Id header' });

      return;
    }

    const entry = this.sessions.get(sessionId);

    if (!entry) {
      res.status(404).json({ error: 'Session not found' });

      return;
    }

    if (entry.userId !== context.userId) {
      res.status(403).json({ error: 'Session belongs to a different user' });

      return;
    }

    if (entry.scopeSignature !== apiKeyScopeSignature(req)) {
      res.status(403).json({ error: 'Session belongs to a different authority' });

      return;
    }

    entry.lastActivity = Date.now();

    await entry.transport.handleRequest(req, res);
  }

  /**
   * DELETE /mcp – terminates the session and cleans up the transport.
   */
  @Delete()
  async handleDelete(
    @Context() context: RequestContext,
    @Req() req: Request,
    @Headers('mcp-session-id') sessionId: string | undefined,
  ) {
    if (!sessionId) {
      throw new BadRequestException('Missing Mcp-Session-Id header');
    }

    const entry = this.sessions.get(sessionId);

    if (!entry) {
      throw new NotFoundException('Session not found');
    }

    if (entry.userId !== context.userId) {
      throw new ForbiddenException('Session belongs to a different user');
    }

    if (entry.scopeSignature !== apiKeyScopeSignature(req)) {
      throw new ForbiddenException('Session belongs to a different authority');
    }

    await entry.transport.close();
    this.sessions.delete(sessionId);

    this.logger.log('MCP session terminated by client', { sessionId });

    return { success: true };
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  private reapStaleSessions() {
    const now = Date.now();

    for (const [sessionId, entry] of this.sessions) {
      if (now - entry.lastActivity > SESSION_TTL_MS) {
        entry.transport.close().catch(() => {});
        this.sessions.delete(sessionId);
        this.logger.log('MCP session reaped (idle timeout)', {
          sessionId,
        });
      }
    }
  }

  private isInitializeBody(body: unknown): boolean {
    if (Array.isArray(body)) {
      return body.some((msg) => isInitializeRequest(msg));
    }

    return isInitializeRequest(body);
  }
}
