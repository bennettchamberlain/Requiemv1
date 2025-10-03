/*

// @todo this is some helper code to go and deal with fetching actual messages from gmail
// we are going to have to go back to the connection, so we need to look at that here also


//      const connection = await this.connectionService.findById(payload.connectionId);

      if (!connection) {
        this.logger.warn('Connection not found', {
          connectionId: payload.connectionId,
        });

        return;
      }


// and then we do something useful


import { Injectable } from '@nestjs/common';

import { LoggerService } from '@ci/common/services';
import { EventService, ContentService } from '@ci/domains/memory';
import type { CreateEventDto, CreateContentDto } from '@ci/domains/memory/types';

import { PeoplePromotionService } from './PeoplePromotionService';



  private async fetchGmailMessagesBatch(
    connectionId: string,
    messageIds: string[],
    batchSize: number = 10,
  ): Promise<any[]> {
    const fullMessages = [];
    
    for (let i = 0; i < messageIds.length; i += batchSize) {
      const batch = messageIds.slice(i, i + batchSize);
      const batchPromises = batch.map(async (messageId) => {
        try {
          return await this.connectionService.makePaginatedRequest(
            connectionId,
            `/gmail/v1/users/me/messages/${messageId}`,
          );
        } catch (error) {
          this.logger.error('Failed to fetch message in batch', {
            messageId,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
          return null;
        }
      });
      
      const batchResults = await Promise.all(batchPromises);
      fullMessages.push(...batchResults.filter(msg => msg !== null));
      
      // Add a small delay between batches to avoid rate limiting
      if (i + batchSize < messageIds.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    
    return fullMessages;
  }

  private async syncGmailWithPagination(
    connection: { id: string; syncState: Record<string, unknown> | null },
    userId: string,
  ): Promise<{ api: string; syncState: Record<string, unknown> | null }> {
    const { SyncStateHelper } = await import('@ci/domains/connections/types/sync-state');
    const gmailSyncState = SyncStateHelper.getGmailSyncState(connection.syncState);

    this.logger.log('Starting Gmail sync with pagination', {
      connectionId: connection.id,
      hasSyncState: !!connection.syncState,
      gmailSyncState,
      lastHistoryId: gmailSyncState?.lastHistoryId,
    });

    let newSyncState: Record<string, unknown> | null = null;
    let totalMessages = 0;
    let pageCount = 0;

    if (gmailSyncState?.lastHistoryId) {
      // Incremental sync using historyId
      this.logger.log('Performing incremental Gmail sync', {
        connectionId: connection.id,
        lastHistoryId: gmailSyncState.lastHistoryId,
      });

      try {
        const response = (await this.connectionService.makePaginatedRequest(
          connection.id,
          `/gmail/v1/users/me/history?startHistoryId=${gmailSyncState.lastHistoryId}`,
        )) as Record<string, unknown>;

        const history = (response.history as unknown[]) || [];
        totalMessages = history.length;

        // Get the latest historyId from the response for the next sync
        const latestHistoryId = response.historyId as string;

        // Save this page of incremental data only if there are new messages
        if (history.length > 0) {
          // Extract message IDs from history and fetch full messages
          const messageIds = new Set<string>();
          for (const historyItem of history) {
            if (typeof historyItem === 'object' && historyItem !== null) {
              const h = historyItem as any;
              if (h.messages && Array.isArray(h.messages)) {
                for (const msg of h.messages) {
                  if (msg.id) messageIds.add(msg.id);
                }
              }
              if (h.messagesAdded && Array.isArray(h.messagesAdded)) {
                for (const added of h.messagesAdded) {
                  if (added.message?.id) messageIds.add(added.message.id);
                }
              }
            }
          }

          // Fetch full message details in batches
          const fullMessages = await this.fetchGmailMessagesBatch(
            connection.id,
            Array.from(messageIds),
          );

          // Save history with full messages
          const enrichedHistory = history.map((historyItem: any) => {
            if (historyItem.messages) {
              historyItem.messages = historyItem.messages.map((msg: any) => {
                const fullMsg = fullMessages.find((fm: any) => fm.id === msg.id);
                return fullMsg || msg;
              });
            }
            if (historyItem.messagesAdded) {
              historyItem.messagesAdded = historyItem.messagesAdded.map((added: any) => {
                if (added.message) {
                  const fullMsg = fullMessages.find((fm: any) => fm.id === added.message.id);
                  added.message = fullMsg || added.message;
                }
                return added;
              });
            }
            return historyItem;
          });

          await this.apiLogService.create({
            content: { history: enrichedHistory },
            userId,
            connectionId: connection.id,
            scope: 'Gmail',
          });

          this.logger.log('Saved incremental Gmail data with full messages', {
            connectionId: connection.id,
            historyCount: history.length,
            messageIdCount: messageIds.size,
            fullMessageCount: fullMessages.length,
            lastHistoryId: gmailSyncState.lastHistoryId,
            latestHistoryId: latestHistoryId,
          });

          // Promote Gmail messages to higher-level objects
          await this.gmailPromotionService.promoteGmailMessages(
            { history: enrichedHistory },
            userId,
            connection.id,
          );
        } else {
          this.logger.log('No new Gmail messages found in incremental sync', {
            connectionId: connection.id,
            lastHistoryId: gmailSyncState.lastHistoryId,
            latestHistoryId: latestHistoryId,
          });
        }

        newSyncState = {
          lastHistoryId: latestHistoryId || gmailSyncState.lastHistoryId, // Use latest historyId or fallback to current
          trackedLabels: gmailSyncState.trackedLabels || ['INBOX'],
          watchChannelId: gmailSyncState.watchChannelId,
          watchResourceId: gmailSyncState.watchResourceId,
          watchExpiration: gmailSyncState.watchExpiration,
          lastFullSyncAt: gmailSyncState.lastFullSyncAt,
        };

        this.logger.log('Gmail incremental sync completed', {
          connectionId: connection.id,
          historyCount: totalMessages,
          lastHistoryId: newSyncState.lastHistoryId,
        });

        return { api: 'Gmail', syncState: newSyncState };
      } catch (error) {
        // If we get historyIdOutOfRange, do a fresh baseline
        if (error instanceof Error && error.message.includes('historyIdOutOfRange')) {
          this.logger.warn('Gmail historyId is out of range, performing fresh baseline', {
            connectionId: connection.id,
            oldHistoryId: gmailSyncState.lastHistoryId,
          });
          // Fall through to full sync
        } else {
          throw error;
        }
      }
    }

    // Full sync - get all messages and establish historyId
    this.logger.log('Performing full Gmail sync with pagination', { connectionId: connection.id });

    const labels = gmailSyncState?.trackedLabels || ['INBOX'];
    let nextPageToken: string | undefined;

    // Get all message IDs first
    do {
      let endpoint = `/gmail/v1/users/me/messages?maxResults=500&labelIds=${labels.join(',')}`;
      if (nextPageToken) {
        endpoint += `&pageToken=${nextPageToken}`;
      }

      const response = (await this.connectionService.makePaginatedRequest(connection.id, endpoint)) as Record<
        string,
        unknown
      >;
      const messages = (response.messages as unknown[]) || [];

      totalMessages += messages.length;
      pageCount++;
      nextPageToken = response.nextPageToken as string | undefined;

      // Save each page as a separate API log entry
      if (messages.length > 0) {
        // Extract message IDs
        const messageIds = messages.map((msg: any) => msg.id).filter(Boolean);
        
        // Fetch full message details in batches
        const fullMessages = await this.fetchGmailMessagesBatch(connection.id, messageIds);
        
        // If we couldn't fetch some messages, include the basic info
        const fetchedIds = new Set(fullMessages.map((msg: any) => msg.id));
        for (const message of messages) {
          if (!(message as any).id || !fetchedIds.has((message as any).id)) {
            fullMessages.push(message);
          }
        }

        await this.apiLogService.create({
          content: { messages: fullMessages, nextPageToken: response.nextPageToken },
          userId,
          connectionId: connection.id,
          scope: 'Gmail',
        });

        this.logger.log('Saved Gmail page with full messages', {
          connectionId: connection.id,
          page: pageCount,
          messageCount: messages.length,
          fullMessageCount: fullMessages.length,
          totalMessages,
          hasNextPage: !!nextPageToken,
        });

        // Log sample message details for debugging
        if (fullMessages.length > 0) {
          const sampleMessage = fullMessages[0] as any;
          this.logger.log('Sample Gmail full message from page', {
            connectionId: connection.id,
            messageId: sampleMessage.id,
            threadId: sampleMessage.threadId,
            snippet: sampleMessage.snippet?.substring(0, 100),
            labelIds: sampleMessage.labelIds,
            hasPayload: !!sampleMessage.payload,
            hasHeaders: !!(sampleMessage.payload?.headers),
            headerCount: sampleMessage.payload?.headers?.length || 0,
          });
        }

        // Promote Gmail messages to higher-level objects
        await this.gmailPromotionService.promoteGmailMessages(
          { messages: fullMessages },
          userId,
          connection.id,
        );
      }
    } while (nextPageToken);

    // Get current historyId from profile for future incremental syncs
    const profile = (await this.connectionService.makePaginatedRequest(
      connection.id,
      '/gmail/v1/users/me/profile',
    )) as Record<string, unknown>;

    newSyncState = {
      lastHistoryId: profile.historyId as string,
      trackedLabels: labels,
      lastFullSyncAt: new Date().toISOString(),
    };

    this.logger.log('Gmail full sync completed', {
      connectionId: connection.id,
      totalMessageCount: totalMessages,
      pageCount,
      historyId: newSyncState.lastHistoryId,
    });

    return { api: 'Gmail', syncState: newSyncState };
  }


  private parseScheduleToMinutes(schedule: string | null): number | null {
    if (!schedule) {
      return null;
    }

    // Parse schedule formats like "5m", "1h", "30s", etc.
    const match = schedule.match(/^(\d+)([smhd])$/);
    if (!match) {
      return null;
    }

    const value = parseInt(match[1], 10);
    const unit = match[2];

    switch (unit) {
      case 's':
        return value / 60; // seconds to minutes
      case 'm':
        return value; // minutes
      case 'h':
        return value * 60; // hours to minutes
      case 'd':
        return value * 60 * 24; // days to minutes
      default:
        return null;
    }
  }



}



*/