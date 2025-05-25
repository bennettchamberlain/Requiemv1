// LLM Service for Ollama Integration via Job Queue
// filepath: /Users/williambroza/devel/CI-Server/backend/apps/api/src/services/llm-service.ts

import type { Params } from '@feathersjs/feathers';
import { validateData } from '@feathersjs/schema';
import { Type, Static, getValidator } from '@feathersjs/typebox';
import ollama from 'ollama';

import { Application } from '../configuration/types';
import { queryValidator } from '../configuration/validators';
import { queueAIJob } from '../utils/job-queue-utils';

// Input validation schemas for different LLM operations
export const LLMGenerateInput = Type.Object(
  {
    model: Type.String(),
    prompt: Type.String(),
    system: Type.Optional(Type.String()),
    stream: Type.Optional(Type.Boolean()),
    format: Type.Optional(Type.String()),
    options: Type.Optional(
      Type.Object({
        temperature: Type.Optional(Type.Number()),
        top_p: Type.Optional(Type.Number()),
        top_k: Type.Optional(Type.Number()),
        num_predict: Type.Optional(Type.Number()),
        seed: Type.Optional(Type.Number()),
      }),
    ),
  },
  {
    additionalProperties: false,
  },
);

export const LLMChatInput = Type.Object(
  {
    model: Type.String(),
    messages: Type.Array(
      Type.Object({
        role: Type.Union([Type.Literal('user'), Type.Literal('assistant'), Type.Literal('system')]),
        content: Type.String(),
      }),
    ),
    stream: Type.Optional(Type.Boolean()),
    format: Type.Optional(Type.String()),
    options: Type.Optional(
      Type.Object({
        temperature: Type.Optional(Type.Number()),
        top_p: Type.Optional(Type.Number()),
        top_k: Type.Optional(Type.Number()),
        num_predict: Type.Optional(Type.Number()),
        seed: Type.Optional(Type.Number()),
      }),
    ),
  },
  {
    additionalProperties: false,
  },
);

export const LLMJobInput = Type.Object(
  {
    operation: Type.Union([Type.Literal('generate'), Type.Literal('chat')]),
    model: Type.String(),
    prompt: Type.Optional(Type.String()),
    messages: Type.Optional(
      Type.Array(
        Type.Object({
          role: Type.Union([Type.Literal('user'), Type.Literal('assistant'), Type.Literal('system')]),
          content: Type.String(),
        }),
      ),
    ),
    system: Type.Optional(Type.String()),
    stream: Type.Optional(Type.Boolean()),
    format: Type.Optional(Type.String()),
    options: Type.Optional(
      Type.Object({
        temperature: Type.Optional(Type.Number()),
        top_p: Type.Optional(Type.Number()),
        top_k: Type.Optional(Type.Number()),
        num_predict: Type.Optional(Type.Number()),
        seed: Type.Optional(Type.Number()),
      }),
    ),
    jobOptions: Type.Optional(
      Type.Object({
        priority: Type.Optional(Type.Number()),
        retryLimit: Type.Optional(Type.Number()),
        retryDelay: Type.Optional(Type.Number()),
        delay: Type.Optional(Type.Number()),
      }),
    ),
  },
  {
    additionalProperties: false,
  },
);

export type LLMGenerateInputType = Static<typeof LLMGenerateInput>;
export type LLMChatInputType = Static<typeof LLMChatInput>;
export type LLMJobInputType = Static<typeof LLMJobInput>;

const generateValidator = getValidator(LLMGenerateInput, queryValidator);
const chatValidator = getValidator(LLMChatInput, queryValidator);
const jobValidator = getValidator(LLMJobInput, queryValidator);

export class LLMService {
  app: Application;

  constructor(app: Application) {
    this.app = app;
  }

  /**
   * Direct synchronous LLM generation (blocks until complete)
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async create(input: LLMGenerateInputType, _params?: Params) {
    try {
      // Force non-streaming for direct service calls
      const response = await ollama.generate({
        model: input.model,
        prompt: input.prompt,
        system: input.system,
        format: input.format,
        options: input.options,
        stream: false,
      });

      return {
        success: true,
        model: input.model,
        prompt: input.prompt,
        response: input.stream ? 'Stream initiated' : response.response,
        created_at: response.created_at,
        done: response.done,
        total_duration: response.total_duration,
        load_duration: response.load_duration,
        prompt_eval_count: response.prompt_eval_count,
        prompt_eval_duration: response.prompt_eval_duration,
        eval_count: response.eval_count,
        eval_duration: response.eval_duration,
      };
    } catch (error) {
      throw new Error(`LLM generation failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  static hooks = {
    before: {
      create: [validateData(generateValidator)],
    },
  };
}

export class LLMChatService {
  app: Application;

  constructor(app: Application) {
    this.app = app;
  }

  /**
   * Direct synchronous LLM chat (blocks until complete)
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async create(input: LLMChatInputType, _params?: Params) {
    try {
      // Force non-streaming for direct service calls
      const response = await ollama.chat({
        model: input.model,
        messages: input.messages,
        format: input.format,
        options: input.options,
        stream: false,
      });

      return {
        success: true,
        model: input.model,
        messages: input.messages,
        response: input.stream ? 'Stream initiated' : response.message,
        created_at: response.created_at,
        done: response.done,
        total_duration: response.total_duration,
        load_duration: response.load_duration,
        prompt_eval_count: response.prompt_eval_count,
        prompt_eval_duration: response.prompt_eval_duration,
        eval_count: response.eval_count,
        eval_duration: response.eval_duration,
      };
    } catch (error) {
      throw new Error(`LLM chat failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  static hooks = {
    before: {
      create: [validateData(chatValidator)],
    },
  };
}

export class LLMJobService {
  app: Application;

  constructor(app: Application) {
    this.app = app;
  }

  /**
   * Queue an LLM job for asynchronous processing
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async create(input: LLMJobInputType, _params?: Params) {
    try {
      // Validate operation-specific requirements
      if (input.operation === 'generate' && !input.prompt) {
        throw new Error('Prompt is required for generate operation');
      }
      if (input.operation === 'chat' && !input.messages) {
        throw new Error('Messages are required for chat operation');
      }

      // Queue the LLM job
      const jobId = await queueAIJob(
        this.app,
        'llm-processing',
        {
          operation: input.operation,
          model: input.model,
          prompt: input.prompt,
          messages: input.messages,
          system: input.system,
          stream: input.stream,
          format: input.format,
          options: input.options,
        },
        {
          priority: input.jobOptions?.priority || 5,
          retryLimit: input.jobOptions?.retryLimit || 3,
          retryDelay: input.jobOptions?.retryDelay || 5000,
          delay: input.jobOptions?.delay || 0,
        },
      );

      return {
        success: true,
        jobId,
        operation: input.operation,
        model: input.model,
        message: `LLM ${input.operation} job ${jobId} queued for model ${input.model}`,
        queuedAt: new Date().toISOString(),
      };
    } catch (error) {
      throw new Error(`Failed to queue LLM job: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  static hooks = {
    before: {
      create: [validateData(jobValidator)],
    },
  };
}

export class LLMUtilityService {
  app: Application;

  constructor(app: Application) {
    this.app = app;
  }

  /**
   * Get available models from Ollama
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async find(_params?: Params) {
    try {
      const response = await ollama.list();
      return {
        success: true,
        models: response.models.map((model) => ({
          name: model.name,
          size: model.size,
          digest: model.digest,
          modified_at: model.modified_at,
          details: model.details,
        })),
        count: response.models.length,
      };
    } catch (error) {
      throw new Error(`Failed to list models: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Get model information
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async get(modelName: string, _params?: Params) {
    try {
      const response = await ollama.show({ model: modelName });
      return {
        success: true,
        model: modelName,
        details: response,
      };
    } catch (error) {
      throw new Error(`Failed to get model info: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Pull a model from Ollama library
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async create(data: { model: string; insecure?: boolean }, _params?: Params) {
    try {
      await ollama.pull({
        model: data.model,
        insecure: data.insecure || false,
      });

      return {
        success: true,
        model: data.model,
        message: `Model ${data.model} pulled successfully`,
        pulledAt: new Date().toISOString(),
      };
    } catch (error) {
      throw new Error(`Failed to pull model: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Delete a model
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async remove(modelName: string, _params?: Params) {
    try {
      await ollama.delete({ model: modelName });
      return {
        success: true,
        model: modelName,
        message: `Model ${modelName} deleted successfully`,
        deletedAt: new Date().toISOString(),
      };
    } catch (error) {
      throw new Error(`Failed to delete model: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
