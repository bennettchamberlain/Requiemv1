/**
 * Python function runner — the pg-boss replacement for Temporal.
 *
 * The NestJS API is the single scheduler: crons fan out per-user jobs onto
 * pg-boss queues, a dispatch listener POSTs each job to the target Python
 * service's `/functions/run` endpoint and defers pg-boss completion, and the
 * Python runner reports the outcome back through an authenticated webhook that
 * completes or fails the job. If the runner dies mid-run, the queue's
 * expiration elapses and pg-boss retries — that is the durability story.
 *
 * @module PythonFunctionsModule
 */

import { Module } from '@nestjs/common';

import { LoggingModule } from '@ci/common/logging';
import { EventsModule } from '@ci/domains/events';

import './events';

import { PythonFunctionCallbackController } from './controllers/PythonFunctionCallbackController';
import { PythonFunctionCrons } from './cron/PythonFunctionCrons';
import { PythonFunctionDispatchListener } from './listeners/PythonFunctionDispatchListener';
import { PythonFunctionService } from './services/PythonFunctionService';

@Module({
  imports: [EventsModule, LoggingModule],
  providers: [PythonFunctionService, PythonFunctionDispatchListener, PythonFunctionCrons],
  controllers: [PythonFunctionCallbackController],
  exports: [PythonFunctionService],
})
export class PythonFunctionsModule {}

export { PythonFunctionService };
export { PYTHON_FUNCTION_QUEUES, PYTHON_FUNCTIONS } from './types';
export type { PythonFunctionTarget } from './types';
