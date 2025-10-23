import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';

import { Context } from '@ci/common/decorators';
import { JwtAuthGuard } from '@ci/common/guards';
import { ValidationPipe } from '@ci/common/pipes';
import type { RequestContext } from '@ci/common/types';

import { McpToolsService, type McpExecuteResult } from '../services/McpToolsService';

const serverParamSchema = z.object({
  serverName: z.string().min(1, 'Server name is required'),
});

const executeSchema = z.object({
  serverName: z.string().min(1, 'Server name is required'),
  toolName: z.string().min(1, 'Tool name is required'),
  arguments: z.unknown().optional(),
});

@Controller('mcp')
@UseGuards(JwtAuthGuard)
export class McpController {
  constructor(private readonly mcpToolsService: McpToolsService) {}

  @Get('servers')
  async getServers(@Context() context: RequestContext) {
    return this.mcpToolsService.listServers(context);
  }

  @Get('sessions')
  async getSessions(@Context() context: RequestContext) {
    return this.mcpToolsService.listSessions(context);
  }

  @Get('tools')
  async getTools(@Context() context: RequestContext) {
    return this.mcpToolsService.listTools(context);
  }

  @Get('health')
  async getHealth(@Context() context: RequestContext) {
    return this.mcpToolsService.listHealth(context);
  }

  @Post('servers/:serverName/start')
  async startServer(
    @Param(new ValidationPipe(serverParamSchema)) params: z.infer<typeof serverParamSchema>,
    @Context() context: RequestContext,
  ) {
    return this.mcpToolsService.startServer(params.serverName, context);
  }

  @Post('servers/:serverName/stop')
  async stopServer(
    @Param(new ValidationPipe(serverParamSchema)) params: z.infer<typeof serverParamSchema>,
    @Context() context: RequestContext,
  ) {
    return this.mcpToolsService.stopServer(params.serverName, context);
  }

  @Post('execute')
  async executeTool(
    @Body(new ValidationPipe(executeSchema)) body: z.infer<typeof executeSchema>,
    @Context() context: RequestContext,
  ): Promise<McpExecuteResult> {
    const { serverName, toolName, arguments: args } = body;

    return this.mcpToolsService.executeTool(serverName, toolName, args, context);
  }
}
