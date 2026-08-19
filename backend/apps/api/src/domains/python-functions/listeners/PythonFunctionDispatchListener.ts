import { Injectable } from '@nestjs/common';

import { LoggerService } from '@ci/common/logging';
import config from '@ci/configuration';
import { OnEvent, type Acknowledgement } from '@ci/domains/events';

import { PythonFunctionRunEvent } from '../events';
import {
  PYTHON_FUNCTION_QUEUE_OPTIONS,
  PYTHON_FUNCTION_QUEUES,
  type PythonFunctionRunPayload,
  type PythonFunctionTarget,
} from '../types';

type DispatchJob = PythonFunctionRunPayload & { jobId: string };

// The runner replies as soon as the run is accepted into its worker pool, so
// this bounds connection/accept time only — never function runtime.
const DISPATCH_TIMEOUT_MS = 30_000;

/**
 * Forwards `python.function.run` jobs to the target Python service and DEFERS
 * pg-boss completion: the job stays `active` (holding no worker slot) until the
 * Python runner reports the outcome through PythonFunctionCallbackController,
 * or the queue's expireInSeconds elapses and pg-boss retries.
 *
 * Both listeners are `autoAcknowledge: false` — a failed dispatch (service
 * down, pool full → 429) calls `fail()` so pg-boss retries with backoff.
 */
@Injectable()
export class PythonFunctionDispatchListener {
  constructor(private readonly logger: LoggerService) {
    this.logger.setContext(PythonFunctionDispatchListener.name);
  }

  @OnEvent(PythonFunctionRunEvent, {
    queue: PYTHON_FUNCTION_QUEUES.summary,
    autoAcknowledge: false,
    queueOptions: PYTHON_FUNCTION_QUEUE_OPTIONS.summary,
  })
  async dispatchSummary(payload: DispatchJob, ack: Acknowledgement): Promise<void> {
    await this.dispatch('summary', config.services.summary.host, payload, ack);
  }

  @OnEvent(PythonFunctionRunEvent, {
    queue: PYTHON_FUNCTION_QUEUES.hbpe,
    autoAcknowledge: false,
    queueOptions: PYTHON_FUNCTION_QUEUE_OPTIONS.hbpe,
  })
  async dispatchHbpe(payload: DispatchJob, ack: Acknowledgement): Promise<void> {
    await this.dispatch('hbpe', config.services.hbpe.host, payload, ack);
  }

  private async dispatch(
    target: PythonFunctionTarget,
    baseUrl: string,
    payload: DispatchJob,
    ack: Acknowledgement,
  ): Promise<void> {
    const url = `${baseUrl.replace(/\/+$/, '')}/functions/run`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          function: payload.function,
          args: payload.args,
          job_id: payload.jobId,
          queue: PYTHON_FUNCTION_QUEUES[target],
        }),
        signal: AbortSignal.timeout(DISPATCH_TIMEOUT_MS),
      });

      if (!response.ok) {
        const text = await response.text().catch(() => '');

        throw new Error(`POST ${url} HTTP ${response.status}: ${text.slice(0, 300)}`);
      }

      this.logger.log('Dispatched function run to python service', {
        target,
        functionName: payload.function,
        jobId: payload.jobId,
      });

      // Completion arrives via the callback controller (or queue expiration).
      ack.defer();
    } catch (err) {
      this.logger.warn('Python function dispatch failed — job will retry', {
        target,
        functionName: payload.function,
        jobId: payload.jobId,
        error: err instanceof Error ? err.message : String(err),
      });

      ack.fail(err);
    }
  }
}
