import { Injectable } from '@nestjs/common';

import { LoggerService } from '@ci/common/logging';
import { type Connection } from '@ci/domains/connections';
import { CommunicationDirection, CommunicationService, CommunicationType } from '@ci/domains/memory';

import { ConnectionSyncJob } from '../../../types';
import type { SlackConversation, SlackMessage } from '../sync/slackApi';

@Injectable()
export class SlackMessagesTransformService {
  constructor(
    private readonly communicationService: CommunicationService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(SlackMessagesTransformService.name);
  }

  async transform({ connection, syncJob }: { connection: Connection; syncJob: ConnectionSyncJob }) {
    const { userId, data } = syncJob;
    const messagesByChannel = (data?.messages as Record<string, SlackMessage[]>) || {};
    const channelMap = (data?.channels as Record<string, SlackConversation>) || {};
    const authedUserId = String(data?.authedUserId || connection.externalId || '');

    this.logger.log('Starting Slack messages transformation', {
      userId,
      connectionId: connection.id,
    });

    let createdCount = 0;

    for (const [channelId, messages] of Object.entries(messagesByChannel)) {
      const channel = channelMap[channelId];
      const channelLabel = channel?.name || channelId;

      for (const message of messages) {
        const direction =
          message.user === authedUserId ? CommunicationDirection.OUTBOUND : CommunicationDirection.INBOUND;

        try {
          await this.communicationService.create(
            { userId },
            {
              time: new Date(parseFloat(message.ts) * 1000),
              communication_type: CommunicationType.CHAT,
              direction,
              thread_id: message.thread_ts || message.ts,
              subject: channelLabel,
              content: message.text || '',
              connection_id: connection.id,
              source_type: 'ETL',
              source_system: 'slack',
              source_id: `${channelId}:${message.ts}`,
              participants_metadata: {
                channel_id: channelId,
                channel_name: channel?.name,
                slack_user_id: message.user,
              },
            },
          );

          createdCount++;
        } catch (error) {
          this.logger.error('Failed to transform Slack message', {
            channelId,
            messageTs: message.ts,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }
    }

    this.logger.log('Slack messages transformation completed', {
      userId,
      connectionId: connection.id,
      createdCount,
    });
  }
}
