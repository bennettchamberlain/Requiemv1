import { Injectable } from '@nestjs/common';

import { type UserServiceContext } from '@ci/common/context';
import { LoggerService } from '@ci/common/logging';
import { CommunicationService, CommunicationType } from '@ci/domains/memory';

import type { AbsorbDto } from '../types';

@Injectable()
export class AbsorbService {
  constructor(
    private readonly communicationService: CommunicationService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(AbsorbService.name);
  }

  // Fire-and-forget: caller does not await this
  absorb(context: UserServiceContext, dto: AbsorbDto): void {
    this.doAbsorb(context, dto).catch((err) => {
      this.logger.warn(`Absorb failed for user ${context.userId}: ${err}`);
    });
  }

  private async doAbsorb(context: UserServiceContext, dto: AbsorbDto): Promise<void> {
    const content = JSON.stringify(dto.messages);

    await this.communicationService.create(context, {
      time: new Date(),
      communication_type: CommunicationType.CHAT,
      direction: 'inbound',
      content,
      subject: dto.sessionId,
      category: 'agent-conversation',
      summary: this.buildSummary(dto.messages),
    });
  }

  private buildSummary(messages: Array<{ role: string; content: string }>): string {
    const userMessages = messages
      .filter((m) => m.role === 'user')
      .map((m) => m.content.slice(0, 120))
      .join(' | ');

    return userMessages.slice(0, 500) || 'Agent conversation';
  }
}
