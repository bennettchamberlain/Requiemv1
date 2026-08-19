import { BadRequestException } from '@nestjs/common';

import type { LoggerService } from '@ci/common/logging';
import type { EventService } from '@ci/domains/events';

import { PythonFunctionCallbackController } from '../controllers/PythonFunctionCallbackController';

const logger = { setContext() {}, log() {}, warn() {}, error() {} } as unknown as LoggerService;

function makeController() {
  const eventService = {
    completeJob: jest.fn().mockResolvedValue(undefined),
    failJob: jest.fn().mockResolvedValue(undefined),
  } as unknown as EventService;

  return { controller: new PythonFunctionCallbackController(eventService, logger), eventService };
}

describe('PythonFunctionCallbackController', () => {
  it('completes the deferred job with the run result', async () => {
    const { controller, eventService } = makeController();

    await controller.callback({
      job_id: 'job-1',
      queue: 'py-fn-summary',
      status: 'completed',
      result: { summaries: 3 },
    });

    expect(eventService.completeJob).toHaveBeenCalledWith('py-fn-summary', 'job-1', { summaries: 3 });
    expect(eventService.failJob).not.toHaveBeenCalled();
  });

  it('fails the deferred job with the error message', async () => {
    const { controller, eventService } = makeController();

    await controller.callback({
      job_id: 'job-2',
      queue: 'py-fn-hbpe',
      status: 'failed',
      error: 'training crashed',
    });

    expect(eventService.failJob).toHaveBeenCalledWith(
      'py-fn-hbpe',
      'job-2',
      expect.objectContaining({ message: 'training crashed' }),
    );
    expect(eventService.completeJob).not.toHaveBeenCalled();
  });

  it('rejects unknown queues', async () => {
    const { controller, eventService } = makeController();

    await expect(
      controller.callback({ job_id: 'job-1', queue: 'search-index', status: 'completed' }),
    ).rejects.toThrow(BadRequestException);
    expect(eventService.completeJob).not.toHaveBeenCalled();
  });

  it('rejects a missing job id', async () => {
    const { controller } = makeController();

    await expect(
      controller.callback({ job_id: '', queue: 'py-fn-summary', status: 'completed' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects unknown statuses', async () => {
    const { controller } = makeController();

    await expect(
      controller.callback({
        job_id: 'job-1',
        queue: 'py-fn-summary',
        status: 'running' as never,
      }),
    ).rejects.toThrow(BadRequestException);
  });
});
