import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import ollama, {
  type ChatResponse,
  type GenerateResponse,
  type Message as OllamaMessage,
  type Tool,
  type ToolCall,
} from 'ollama';
import { DataSource } from 'typeorm';

import { LoggerService } from '@ci/common/services';
import type { RequestContext } from '@ci/common/types';

import {
  ToolRegistry,
  GetUserPreferencesTool,
  GetEntertainmentPreferencesTool,
  GetStreamingAvailabilityTool,
  type ToolSchema,
} from '../tools';
import type { Message, OllamaModel } from '../types';

import { MessageService } from './MessageService';

const PROMPT_MODEL = 'gemma3:1b';
const INTERNAL_MODELS = new Set(['nomic-embed-text']);

interface PromptOptions {
  model?: string;
  signal?: AbortSignal;
  enableTools?: boolean;
}

type MessagesInput = Pick<Message, 'prompt' | 'text'>[];

@Injectable()
export class OllamaService {
  private readonly logger = new LoggerService(OllamaService.name);

  private readonly toolRegistry = new ToolRegistry();

  constructor(
    private readonly messageService: MessageService,
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {
    this.initializeTools();
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async getAvailableModels(context: RequestContext): Promise<OllamaModel[]> {
    const result = await ollama.list();
    const models = result.models.map((model) => this.parseOllamaModel(model.name));

    return models.filter((model) => !INTERNAL_MODELS.has(model.name));
  }

  async generateStream(
    context: RequestContext,
    prompt: string,
    options?: PromptOptions,
  ): Promise<AsyncGenerator<GenerateResponse> & { buffer: string }> {
    const chunks: string[] = [];

    const stream = (async function* () {
      const resolvedOptions = options ?? {};
      const { model = PROMPT_MODEL, signal } = resolvedOptions;

      const iterator = await ollama.generate({
        model,
        prompt,
        stream: true,
      });

      signal?.addEventListener('abort', () => {
        iterator.abort();
      });

      for await (const chunk of iterator) {
        if (chunk && !!chunk.response) {
          chunks.push(chunk.response);
        }

        yield chunk;
      }
    })();

    Object.defineProperty(stream, 'buffer', {
      enumerable: true,
      get: () => chunks.join(''),
    });

    return stream as typeof stream & { buffer: string };
  }

  async generate(
    context: RequestContext,
    prompt: string,
    options?: Omit<PromptOptions, 'signal'>,
  ): Promise<GenerateResponse> {
    const resolvedOptions = options ?? ({} as PromptOptions);
    const { model = PROMPT_MODEL } = resolvedOptions;

    return ollama.generate({
      model,
      prompt,
    });
  }

  async chatStream(
    context: RequestContext,
    messages: MessagesInput,
    options?: PromptOptions,
  ): Promise<AsyncGenerator<ChatResponse> & { messages: OllamaMessage[] }> {
    const resolvedOptions = options ?? {};
    const { model = PROMPT_MODEL, signal, enableTools = false } = resolvedOptions;

    const availableTools = enableTools ? this.toolRegistry.getAvailableTools(context) : [];
    const ollamaTools: Tool[] = availableTools.map(this.convertToOllamaTool);

    const chunks: string[] = [];
    const toolCalls: ToolCall[] = [];
    const inputMessages = this.toOllamaMessages(messages);
    const accumulatedMessages: OllamaMessage[] = [];

    const stream = (async function* (self) {
      do {
        if (signal?.aborted) {
          break;
        }

        let lastChunk: ChatResponse | undefined;
        let handleAbort = () => {};

        // Flush the chunk buffer at the start of every iteration.
        chunks.splice(0, chunks.length);

        // Pop off any previously required tool calls and evaluate them.
        // Notably this will always be empty on the first iteration.
        const iterationToolCalls = toolCalls.splice(0, toolCalls.length);
        const toolEvaluations = await self.newHandleToolCalls(context, iterationToolCalls);

        // Tool evaluations may result in new accumulated messages.
        // We feed these forward into additional Ollama calls.
        accumulatedMessages.push(...toolEvaluations);

        // We only enable tools in this iteration if:
        //
        //   1. Tools are enabled for the service call
        //   2. Tools are configured / available in the system
        //   3. We did not evaluate any tools from the previous iteration
        //
        // This is important to get right.
        const iterationWillCallTools = enableTools && ollamaTools.length > 0 && toolEvaluations.length === 0;

        try {
          const iterator = await ollama.chat({
            model,
            messages: inputMessages.concat(accumulatedMessages),
            stream: true,
            ...(iterationWillCallTools && { tools: ollamaTools }),
          });

          handleAbort = () => iterator.abort();

          signal?.addEventListener('abort', handleAbort);

          for await (const chunk of iterator) {
            lastChunk = chunk;

            if (chunk.message.content) {
              chunks.push(chunk.message.content);
            }

            if (chunk.message.tool_calls) {
              toolCalls.push(...chunk.message.tool_calls);
            }

            yield chunk;
          }

          if (lastChunk?.done) {
            self.logger.log('Ollama prompt evaluation completed', {
              model: lastChunk.model,
              totalDuration: lastChunk.total_duration ? lastChunk.total_duration / 1_000_000 : undefined,
              loadDuration: lastChunk.load_duration ? lastChunk.load_duration / 1_000_000 : undefined,
              evalDuration: lastChunk.prompt_eval_duration
                ? lastChunk.prompt_eval_duration / 1_000_000
                : undefined,
              promptCount: lastChunk.prompt_eval_count,
              evalCount: lastChunk.eval_count,
              doneReason: lastChunk.done_reason,
            });
          }
        } catch (err) {
          if (!(err instanceof DOMException && err.name === 'AbortError')) {
            self.logger.error('Ollama prompt evaluation completed', {
              model: lastChunk?.model ?? resolvedOptions.model,
              doneReason: 'error',
            });

            break;
          }
        } finally {
          const message = {
            role: 'assistant',
            content: chunks.join(''),
            ...(toolCalls.length > 0 && { tool_calls: toolCalls.slice() }),
          } satisfies OllamaMessage;

          accumulatedMessages.push(message);

          signal?.removeEventListener('abort', handleAbort);

          if (signal?.aborted) {
            self.logger.log('Ollama prompt evaluation completed', {
              model: lastChunk?.model ?? resolvedOptions.model,
              doneReason: 'canceled',
            });
          }
        }
      } while (toolCalls.length > 0);
    })(this);

    Object.defineProperty(stream, 'messages', {
      enumerable: true,
      get: () => accumulatedMessages,
    });

    return stream as typeof stream & { messages: OllamaMessage[] };
  }

  async chat(
    context: RequestContext,
    messages: MessagesInput,
    options?: Omit<PromptOptions, 'signal'>,
  ): Promise<ChatResponse> {
    const resolvedOptions = options ?? ({} as PromptOptions);
    const { model = PROMPT_MODEL, enableTools = false } = resolvedOptions;

    // If tools are enabled, use function calling
    if (enableTools) {
      return this.chatWithTools(context, messages, options);
    }

    return ollama.chat({
      model,
      messages: this.toOllamaMessages(messages),
    });
  }

  /**
   * Chat with function calling support
   */
  async chatWithTools(
    context: RequestContext,
    messages: MessagesInput,
    options?: Omit<PromptOptions, 'signal'>,
  ): Promise<ChatResponse> {
    const resolvedOptions = options ?? ({} as PromptOptions);
    const { model = PROMPT_MODEL } = resolvedOptions;

    // Get available tools
    const availableTools = this.toolRegistry.getAvailableTools(context);
    const ollamaTools: Tool[] = availableTools.map(this.convertToOllamaTool);

    const requestPayload = {
      model,
      messages: this.toOllamaMessages(messages),
      ...(ollamaTools.length > 0 && { tools: ollamaTools }),
    };

    this.logger.debug('Sending chat request with tools', {
      model,
      messageCount: messages.length,
      toolCount: ollamaTools.length,
      toolNames: availableTools.map((t) => t.name),
      userId: context.userId,
    });

    const response = await ollama.chat(requestPayload);

    // Handle tool calls if present
    if (response.message.tool_calls && response.message.tool_calls.length > 0) {
      return await this.handleToolCalls(context, messages, response, options);
    }

    return response;
  }

  async validateModel(context: RequestContext, model: string | undefined): Promise<OllamaModel> {
    const resolvedModel = model ?? PROMPT_MODEL;

    const availableModels = await this.getAvailableModels(context);

    const validModel = availableModels.find((availableModel) => availableModel.model === resolvedModel);

    if (!validModel) {
      throw new Error(`Invalid model specified: ${model}`);
    }

    return validModel;
  }

  private toOllamaMessages(messages: MessagesInput): OllamaMessage[] {
    const ollamaMessages: OllamaMessage[] = messages.map(
      (message) =>
        ({
          // TODO: Change this to assistant, and realistically we need to make this better than a binary in the database, constrained enum string?
          role: message.prompt ? 'user' : 'system',
          content: message.text ?? '',
        }) satisfies OllamaMessage,
    );

    return ollamaMessages;
  }

  private parseOllamaModel(model: string): OllamaModel {
    const [fullName, tag = 'latest'] = model.split(':'); // `namespace/model:tag`
    const parts = fullName.split('/');

    if (parts.length === 2) {
      const [namespace, name] = parts;

      return {
        model,
        namespace,
        name,
        tag,
      };
    }

    return {
      model,
      namespace: null,
      name: parts[0],
      tag,
    };
  }

  /**
   * Initialize tools registry with available tools
   */
  private initializeTools(): void {
    const getUserPreferencesTool = new GetUserPreferencesTool(this.dataSource);
    const getEntertainmentPreferencesTool = new GetEntertainmentPreferencesTool(this.dataSource);
    const getStreamingAvailabilityTool = new GetStreamingAvailabilityTool();
    // const getFamilyMembersTool = new GetFamilyMembersTool(this.dataSource); // Disabled for demo

    this.toolRegistry.register(getUserPreferencesTool);
    this.toolRegistry.register(getEntertainmentPreferencesTool);
    this.toolRegistry.register(getStreamingAvailabilityTool);
    // this.toolRegistry.register(getFamilyMembersTool); // Disabled for demo

    this.logger.debug('Initialized tools registry', {
      toolCount: this.toolRegistry.getRegisteredToolNames().length,
      tools: this.toolRegistry.getRegisteredToolNames(),
    });
  }

  private async newHandleToolCalls(context: RequestContext, toolCalls: ToolCall[]): Promise<OllamaMessage[]> {
    if (toolCalls.length === 0) {
      this.logger.debug('No tool calls to evaluate, skipping handling', {
        userId: context.userId,
      });

      return [];
    }

    this.logger.debug('Processing tool calls', {
      toolCallCount: toolCalls.length,
      toolNames: toolCalls.map((tc) => tc.function.name),
      userId: context.userId,
    });

    // Execute each tool call
    const toolResults = await Promise.all(
      toolCalls.map(async (toolCall) => {
        const { name, arguments: args } = toolCall.function;

        try {
          const result = await this.toolRegistry.executeTool(name, context, args);

          return {
            call: toolCall,
            result: result.success ? result.data : { error: result.error },
            success: result.success,
          };
        } catch (error) {
          this.logger.error('Tool execution failed', {
            toolName: name,
            error: error instanceof Error ? error.message : String(error),
            userId: context.userId,
          });

          return {
            call: toolCall,
            result: { error: 'Tool execution failed' },
            success: false,
          };
        }
      }),
    );

    // Build messages with tool results

    return toolResults.map(
      ({ result }) =>
        ({
          role: 'tool' as const,
          content: JSON.stringify(result),
        }) satisfies OllamaMessage,
    );
  }

  /**
   * Process tool calls and return final response
   */
  private async handleToolCalls(
    context: RequestContext,
    originalMessages: MessagesInput,
    toolCallResponse: ChatResponse,
    options?: Omit<PromptOptions, 'signal'>,
  ): Promise<ChatResponse> {
    const { model = PROMPT_MODEL } = options ?? {};
    const toolCalls = toolCallResponse.message.tool_calls || [];

    this.logger.debug('Processing tool calls', {
      toolCallCount: toolCalls.length,
      toolNames: toolCalls.map((tc) => tc.function.name),
      userId: context.userId,
    });

    // Execute each tool call
    const toolResults = await Promise.all(
      toolCalls.map(async (toolCall) => {
        const { name, arguments: args } = toolCall.function;

        try {
          const result = await this.toolRegistry.executeTool(name, context, args);

          return {
            call: toolCall,
            result: result.success ? result.data : { error: result.error },
            success: result.success,
          };
        } catch (error) {
          this.logger.error('Tool execution failed', {
            toolName: name,
            error: error instanceof Error ? error.message : String(error),
            userId: context.userId,
          });

          return {
            call: toolCall,
            result: { error: 'Tool execution failed' },
            success: false,
          };
        }
      }),
    );

    // Build messages with tool results
    const messagesWithToolResults = [
      ...this.toOllamaMessages(originalMessages),
      {
        role: 'assistant' as const,
        content: toolCallResponse.message.content,
        tool_calls: toolCalls,
      },
      ...toolResults.map(({ call, result }) => ({
        role: 'tool' as const,
        content: JSON.stringify(result),
        tool_call_id: call.function.name,
      })),
    ];

    // Get final response incorporating tool results
    const finalResponse = await ollama.chat({
      model,
      messages: messagesWithToolResults,
    });

    this.logger.debug('Completed tool-assisted conversation', {
      toolResultsCount: toolResults.length,
      successfulTools: toolResults.filter((r) => r.success).length,
      userId: context.userId,
    });

    return finalResponse;
  }

  /**
   * Convert our ToolSchema to Ollama Tool format
   */
  private convertToOllamaTool(toolSchema: ToolSchema): Tool {
    return {
      type: 'function',
      function: {
        name: toolSchema.name,
        description: toolSchema.description,
        parameters: toolSchema.parameters,
      },
    };
  }
}
