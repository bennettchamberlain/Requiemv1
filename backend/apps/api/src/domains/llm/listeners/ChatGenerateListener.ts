import { Injectable } from '@nestjs/common';

import { LoggerService } from '@ci/common/logging';
import { Events, type EventPayloads, OnEvent } from '@ci/domains/events';

import {
  LLM_BACKGROUND_QUEUE,
  LLM_BACKGROUND_QUEUE_OPTIONS,
  LLM_QUEUE,
  LLM_QUEUE_OPTIONS,
} from '../constants';
import { ChatGenerateEvent, type ChatGeneratePayload } from '../events';
import { ChatTurnService } from '../services/ChatTurnService';

@Injectable()
export class ChatGenerateListener {
  constructor(
    private readonly chatTurnService: ChatTurnService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(ChatGenerateListener.name);
  }

  @OnEvent(ChatGenerateEvent, { queue: LLM_QUEUE, queueOptions: LLM_QUEUE_OPTIONS })
  async handleGenerate(payload: ChatGeneratePayload) {
    await this.chatTurnService.execute(payload);
  }

  // Background: a title is filed, not watched. Off the interactive slot so a
  // queued title never sits between a person and their next turn.
  //
  // No try/catch: a failure fails the job, so the queue retries it (3 retries,
  // backed off from 10 s, then the dead-letter queue — see
  // LLM_BACKGROUND_QUEUE_OPTIONS). This used to swallow every error "so retries
  // are not burned on naming", back when titles shared the interactive slot and
  // a retried title held up a person's chat turn. Here that cost is gone (the
  // queue yields to chat), and swallowing meant a title that failed once — the
  // model busy or timing out under load — was never retried: nothing
  // re-enqueues it until the thread's next turn, so a thread with one turn
  // stayed untitled for good.
  @OnEvent(Events.CHAT_SUMMARIZATION, {
    queue: LLM_BACKGROUND_QUEUE,
    queueOptions: LLM_BACKGROUND_QUEUE_OPTIONS,
  })
  async handleSummarization(payload: EventPayloads[Events.CHAT_SUMMARIZATION]) {
    await this.chatTurnService.summarizeThread(payload);
  }
}
