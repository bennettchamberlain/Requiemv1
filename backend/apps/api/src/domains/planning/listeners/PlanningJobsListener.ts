import { Injectable } from '@nestjs/common';

import { LoggerService } from '@ci/common/logging';
import { OnEvent } from '@ci/domains/events';

import {
  PlanningEventNowEvent,
  PlanningTodoProcessEvent,
  PlanningTodoScanEvent,
  PlanningVerifyDoneEvent,
  type PlanningUserJobPayload,
} from '../events';
import { EventNowService, TodoProcessService, VerifyDoneService } from '../services/TodoProcessService';
import { TodoScanService } from '../services/TodoScanService';

@Injectable()
export class PlanningJobsListener {
  constructor(
    private readonly todoScanService: TodoScanService,
    private readonly todoProcessService: TodoProcessService,
    private readonly eventNowService: EventNowService,
    private readonly verifyDoneService: VerifyDoneService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(PlanningJobsListener.name);
  }

  @OnEvent(PlanningTodoScanEvent, { queue: 'planning' })
  async onTodoScan(payload: PlanningUserJobPayload) {
    await this.todoScanService.runForUser(payload.userId);
  }

  @OnEvent(PlanningTodoProcessEvent, { queue: 'planning' })
  async onTodoProcess(payload: PlanningUserJobPayload) {
    await this.todoProcessService.runForUser(payload.userId);
  }

  @OnEvent(PlanningEventNowEvent, { queue: 'planning' })
  async onEventNow(payload: PlanningUserJobPayload) {
    await this.eventNowService.runForUser(payload.userId);
  }

  @OnEvent(PlanningVerifyDoneEvent, { queue: 'planning' })
  async onVerifyDone(payload: PlanningUserJobPayload) {
    await this.verifyDoneService.runForUser(payload.userId);
  }
}
