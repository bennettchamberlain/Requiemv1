import { BadRequestException, Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';

import { JwtOrApiKeyAuthGuard } from '@ci/common/guards';
import { LoggerService } from '@ci/common/logging';
import { EventService } from '@ci/domains/events';

import { PYTHON_FUNCTION_QUEUES, type PythonFunctionCallbackBody } from '../types';

const CALLBACK_QUEUES = new Set<string>(Object.values(PYTHON_FUNCTION_QUEUES));

/**
 * Completion webhook for deferred python-function jobs. The Python runner
 * self-signs a JWT with the shared AUTH_TOKEN_SECRET (same pattern as HBPE's
 * graphql_client), using the run's user as subject, so the standard JWT guard
 * accepts it — no separate service-auth path.
 */
@Controller('function-runs')
export class PythonFunctionCallbackController {
  constructor(
    private readonly eventService: EventService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(PythonFunctionCallbackController.name);
  }

  @UseGuards(JwtOrApiKeyAuthGuard)
  @Post('callback')
  @HttpCode(204)
  async callback(@Body() body: PythonFunctionCallbackBody): Promise<void> {
    const { job_id: jobId, queue, status } = body;

    if (!jobId || typeof jobId !== 'string') {
      throw new BadRequestException('job_id is required');
    }

    if (!CALLBACK_QUEUES.has(queue)) {
      throw new BadRequestException(`queue must be one of: ${[...CALLBACK_QUEUES].join(', ')}`);
    }

    if (status === 'completed') {
      await this.eventService.completeJob(queue, jobId, body.result);

      return;
    }

    if (status === 'failed') {
      await this.eventService.failJob(queue, jobId, {
        message: body.error ?? 'python function failed without detail',
        failedAt: new Date().toISOString(),
      });

      return;
    }

    throw new BadRequestException(`status must be 'completed' or 'failed'`);
  }
}
