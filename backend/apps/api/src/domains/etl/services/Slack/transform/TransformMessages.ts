import { Injectable } from '@nestjs/common';

import { LoggerService } from '@ci/common/logging';
import { type Connection } from '@ci/domains/connections';
import {
  CommunicationDirection,
  CommunicationService,
  CommunicationType,
  type CreateCommunicationDto,
} from '@ci/domains/memory';

import { ConnectionSyncJob } from '../../../types';
import type { SlackConversation, SlackMessage, SlackUser } from '../sync/slackApi';

/** Human-readable name for a Slack member, falling back to the raw id. */
function slackUserName(user: SlackUser | undefined, userId: string | undefined): string | undefined {
  return (
    user?.profile?.display_name ||
    user?.profile?.real_name ||
    user?.real_name ||
    user?.name ||
    userId ||
    undefined
  );
}

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
    const userMap = (data?.users as Record<string, SlackUser>) || {};
    const authedUserId = String(data?.authedUserId || connection.externalId || '');

    this.logger.log('Starting Slack messages transformation', {
      userId,
      connectionId: connection.id,
    });

    let createdCount = 0;

    for (const [channelId, messages] of Object.entries(messagesByChannel)) {
      const channel = channelMap[channelId];
      const channelLabel = channel?.name || channelId;

      const rows: CreateCommunicationDto[] = messages.map((message) => {
        const direction =
          message.user === authedUserId ? CommunicationDirection.OUTBOUND : CommunicationDirection.INBOUND;

        return {
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
            slack_user_name: slackUserName(message.user ? userMap[message.user] : undefined, message.user),
          },
        };
      });

      if (rows.length === 0) {
        continue;
      }

      try {
        // createMany upserts on the provenance triple, so a re-synced page is a
        // refresh rather than a unique violation logged once per message.
        const created = await this.communicationService.createMany({ userId }, rows);
        createdCount += created.length;
      } catch (error) {
        this.logger.error('Failed to transform Slack messages', {
          channelId,
          messageCount: rows.length,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    this.logger.log('Slack messages transformation completed', {
      userId,
      connectionId: connection.id,
      createdCount,
    });
  }
}
