import { ForbiddenException, Injectable, type OnModuleInit } from '@nestjs/common';
import { z, type ZodTypeAny } from 'zod';

import type { RequestContext } from '@ci/common/context';
import { type ApiKeyScopedRequest, isScopeLimitedApiKey } from '@ci/common/guards';
import { LoggerService } from '@ci/common/logging';
import { type JSONSchema, ToolRegistry, intentToolName } from '@ci/domains/tools';

import type { McpRegisteredTool } from '../types';

import { GraphQLToolAdapter } from './GraphQLToolAdapter';
import { McpExecutorService } from './McpExecutorService';

@Injectable()
export class McpToolService implements OnModuleInit {
  private tools = new Map<string, McpRegisteredTool>();

  constructor(
    private readonly graphqlAdapter: GraphQLToolAdapter,
    private readonly toolRegistry: ToolRegistry,
    private readonly executorService: McpExecutorService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext('McpToolService');
  }

  onModuleInit() {
    this.registerGraphQLTools();
    this.registerNativeTools();

    this.logger.log('MCP tools consolidated', {
      total: this.tools.size,
      graphql: this.graphqlAdapter.getTools().length,
      native: this.toolRegistry.getRegisteredToolNames().length,
    });
  }

  getTools(): McpRegisteredTool[] {
    return [...this.tools.values()];
  }

  /**
   * The tools this caller can actually execute.
   *
   * GraphQL-derived tools run against the same Nest-wrapped resolvers that serve
   * `/graphql`. Those resolvers declare no `@RequireScopes`, so deny-by-default
   * enforcement rejects a **scope-limited** key on every one of them — which is
   * the confinement a chat-agent connect key exists to have. Advertising them
   * anyway would hand the model a catalog where each call fails with an opaque
   * `Forbidden resource`, so filter them out instead. Native intents execute
   * through the ToolRegistry and remain available.
   *
   * Full-authority principals (sessions/JWT, and empty-scope keys such as the
   * bulk importer's) are unaffected and still see every tool.
   */
  getToolsForRequest(req: ApiKeyScopedRequest): McpRegisteredTool[] {
    if (!isScopeLimitedApiKey(req)) {
      return this.getTools();
    }

    return this.getTools().filter((tool) => tool.source !== 'graphql');
  }

  getSchemaSDL(): string {
    return this.graphqlAdapter.getSchemaSDL();
  }

  async executeTool(
    name: string,
    args: Record<string, unknown>,
    context: { req: import('express').Request },
  ): Promise<unknown> {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`Tool not found: ${name}`);
    }

    if (tool.source === 'graphql') {
      // Belt-and-braces: getToolsForRequest already hides these from a scope-limited
      // caller, but a client may still name one directly. Fail with the reason rather
      // than letting the resolver guard raise a bare `Forbidden resource`.
      if (isScopeLimitedApiKey(context.req)) {
        throw new ForbiddenException(
          `Tool "${name}" reads the knowledge graph directly, which this scope-limited API key cannot access`,
        );
      }

      const graphqlTool = this.graphqlAdapter.getTools().find((t) => t.name === name);

      if (!graphqlTool) {
        throw new Error(`GraphQL tool not found: ${name}`);
      }

      return this.executorService.executeTool(graphqlTool, args, context);
    }

    // Native tool execution
    const userId = (context.req.user as { id?: string })?.id;
    const requestContext: RequestContext = { userId };
    const result = await this.toolRegistry.executeTool(name, requestContext, args);

    if (!result.success) {
      throw new Error(result.error?.message ?? `Tool "${name}" execution failed`);
    }

    return result.data;
  }

  private registerGraphQLTools() {
    for (const tool of this.graphqlAdapter.getTools()) {
      this.tools.set(tool.name, {
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        // Carry the synthesized label so auto-wrapped CRUD is advertised (and gated) with the same
        // privacy metadata as native intents rather than slipping through unlabelled.
        privacy: tool.privacy,
        source: 'graphql',
      });
    }
  }

  private registerNativeTools() {
    // Every registered tool is a curated intent; advertise them all to MCP clients under their
    // executable (underscored) names.
    const schemas = this.toolRegistry.getAgentFacingTools();

    for (const schema of schemas) {
      // schema.name is the dotted intent id; expose/execute by the MCP-safe executable name.
      const toolName = intentToolName(schema.name);

      // Skip if a GraphQL tool with the same name already exists
      if (this.tools.has(toolName)) {
        this.logger.debug(`Skipping native tool "${toolName}" — name conflict with GraphQL tool`);

        continue;
      }

      this.tools.set(toolName, {
        name: toolName,
        description: schema.description,
        inputSchema: this.jsonSchemaToZodShape(schema.parameters),
        privacy: schema.privacy,
        source: 'native',
      });
    }
  }

  private jsonSchemaToZodShape(schema: JSONSchema): Record<string, ZodTypeAny> {
    const shape: Record<string, ZodTypeAny> = {};
    const properties = schema.properties ?? {};
    const required = new Set(schema.required ?? []);

    for (const [key, prop] of Object.entries(properties)) {
      let zodType = this.jsonPropertyToZod(prop);

      if (prop.description) {
        zodType = zodType.describe(prop.description);
      }

      if (!required.has(key)) {
        zodType = zodType.optional();
      }

      shape[key] = zodType;
    }

    return shape;
  }

  private jsonPropertyToZod(prop: JSONSchema): ZodTypeAny {
    if (prop.enum && prop.enum.length > 0) {
      const values = prop.enum.map(String) as [string, ...string[]];

      return z.enum(values);
    }

    switch (prop.type) {
      case 'string':
        return z.string();
      case 'number':
        return z.number();
      case 'integer': {
        let schema = z.number().int();

        if (typeof prop.minimum === 'number') {
          schema = schema.min(prop.minimum);
        }

        if (typeof prop.maximum === 'number') {
          schema = schema.max(prop.maximum);
        }

        return schema;
      }

      case 'boolean':
        return z.boolean();
      case 'array':
        if (prop.items) {
          return z.array(this.jsonPropertyToZod(prop.items));
        }

        return z.array(z.unknown());
      case 'object':
        if (prop.properties) {
          return z.object(this.jsonSchemaToZodShape(prop));
        }

        return z.record(z.unknown());
      default:
        return z.unknown();
    }
  }
}
