import type { Connection } from '../types';
import { SyncStateHelper, type CalendarSyncState, type GmailSyncState } from '../types/sync-state';

import { BaseOAuth2Client } from './BaseOAuth2Client';
import type { SyncResult, SyncResponse } from './types';

export class GoogleClient extends BaseOAuth2Client {
  async sync(connection: Connection): Promise<SyncResponse> {
    this.logger.log('Syncing Google data', { connectionId: connection.id });

    const syncResults: SyncResult[] = [];
    const errors: string[] = [];

    // Google Calendar API - Incremental sync
    try {
      const calendarSyncState = SyncStateHelper.getCalendarSyncState(connection.syncState);
      this.logger.log('Calendar sync state', {
        connectionId: connection.id,
        hasSyncState: !!connection.syncState,
        calendarSyncState,
        syncToken: calendarSyncState?.syncToken,
      });

      const calendarData = await this.syncCalendar(connection, calendarSyncState);

      syncResults.push({
        api: 'Google Calendar',
        data: calendarData,
        syncState: calendarData.syncState as Record<string, unknown>,
      });
    } catch (error) {
      const errorMsg = `Google Calendar API failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
      this.logger.error('Calendar sync failed', { connectionId: connection.id, error: errorMsg });
      errors.push(errorMsg);
    }

    // Gmail API - Incremental sync
    try {
      const gmailSyncState = SyncStateHelper.getGmailSyncState(connection.syncState);
      this.logger.log('Gmail sync state', {
        connectionId: connection.id,
        hasSyncState: !!connection.syncState,
        gmailSyncState,
        lastHistoryId: gmailSyncState?.lastHistoryId,
      });

      const gmailData = await this.syncGmail(connection, gmailSyncState);

      syncResults.push({
        api: 'Gmail',
        data: gmailData,
        syncState: gmailData.syncState as Record<string, unknown>,
      });
    } catch (error) {
      const errorMsg = `Gmail API failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
      this.logger.error('Gmail sync failed', { connectionId: connection.id, error: errorMsg });
      errors.push(errorMsg);
    }

    // Google Drive API - Simple sync (no incremental support yet)
    // Note: Drive API requires specific scopes and may not be available for all connections
    try {
      const driveData = await this.request(connection, '/drive/v3/files?pageSize=10');

      syncResults.push({ api: 'Google Drive', data: driveData });

      this.logger.log('Drive sync completed', {
        connectionId: connection.id,
        fileCount: Array.isArray((driveData as Record<string, unknown>)?.files)
          ? ((driveData as Record<string, unknown>).files as unknown[]).length
          : 0,
      });
    } catch (error) {
      // Drive API is optional - don't fail the entire sync if Drive is not accessible
      this.logger.warn('Drive sync skipped - insufficient permissions or not available', {
        connectionId: connection.id,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      // Don't add to errors array - this is expected for connections without Drive scope
    }

    return {
      success: errors.length === 0,
      message: `Sync completed. ${syncResults.length} APIs processed successfully. ${errors.length} errors occurred.`,
      data: {
        results: syncResults,
        errors,
      },
    };
  }

  private async syncCalendar(
    connection: Connection,
    syncState: CalendarSyncState | null,
  ): Promise<{ events: unknown; syncState: CalendarSyncState }> {
    let allEvents: unknown[] = [];
    let newSyncState: CalendarSyncState;

    if (syncState?.syncToken) {
      // Incremental sync using syncToken
      this.logger.log('Performing incremental calendar sync', {
        connectionId: connection.id,
        syncToken: syncState.syncToken,
      });

      try {
        const response = (await this.request(
          connection,
          `/calendar/v3/calendars/primary/events?syncToken=${syncState.syncToken}&showDeleted=true&singleEvents=true`,
        )) as Record<string, unknown>;

        allEvents = (response.items as unknown[]) || [];

        newSyncState = {
          syncToken: response.nextSyncToken as string,
          lastFullSyncAt: syncState.lastFullSyncAt,
          lastUpdatedMinUsed: syncState.lastUpdatedMinUsed,
        };

        this.logger.log('Calendar incremental sync completed', {
          connectionId: connection.id,
          eventCount: allEvents.length,
          syncToken: newSyncState.syncToken,
        });

        return {
          events: { items: allEvents, nextSyncToken: newSyncState.syncToken },
          syncState: newSyncState,
        };
      } catch (error) {
        // If we get 410 Gone, the syncToken is stale - do a fresh full sync
        if (error instanceof Error && error.message.includes('410')) {
          this.logger.warn('Calendar syncToken is stale, performing fresh full sync', {
            connectionId: connection.id,
            oldSyncToken: syncState.syncToken,
          });
          // Fall through to full sync
        } else {
          throw error;
        }
      }
    }

    // Full sync - bootstrap (either first time or after stale token)
    this.logger.log('Performing full calendar sync', {
      connectionId: connection.id,
    });

    const timeMin = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 days ago
    let nextPageToken: string | undefined;
    let totalEvents = 0;

    do {
      let endpoint = `/calendar/v3/calendars/primary/events?maxResults=2500&timeMin=${timeMin}&showDeleted=true&singleEvents=true`;
      if (nextPageToken) {
        endpoint += `&pageToken=${nextPageToken}`;
      }

      const response = (await this.request(connection, endpoint)) as Record<string, unknown>;
      const events = (response.items as unknown[]) || [];

      allEvents = allEvents.concat(events);
      totalEvents += events.length;
      nextPageToken = response.nextPageToken as string | undefined;

      this.logger.log('Calendar full sync page completed', {
        connectionId: connection.id,
        pageEventCount: events.length,
        totalEvents,
        hasNextPage: !!nextPageToken,
      });
    } while (nextPageToken);

    // Get the final syncToken for future incremental syncs
    const finalResponse = (await this.request(
      connection,
      `/calendar/v3/calendars/primary/events?maxResults=1&timeMin=${timeMin}&showDeleted=true&singleEvents=true`,
    )) as Record<string, unknown>;

    newSyncState = {
      syncToken: finalResponse.nextSyncToken as string,
      lastFullSyncAt: new Date().toISOString(),
      lastUpdatedMinUsed: timeMin,
    };

    this.logger.log('Calendar full sync completed', {
      connectionId: connection.id,
      totalEventCount: allEvents.length,
      syncToken: newSyncState.syncToken,
    });

    return {
      events: { items: allEvents, nextSyncToken: newSyncState.syncToken },
      syncState: newSyncState,
    };
  }

  private async syncGmail(
    connection: Connection,
    syncState: GmailSyncState | null,
  ): Promise<{ messages: unknown; syncState: GmailSyncState }> {
    let allMessages: unknown[] = [];
    let newSyncState: GmailSyncState;

    if (syncState?.lastHistoryId) {
      // Incremental sync using historyId
      this.logger.log('Performing incremental Gmail sync', {
        connectionId: connection.id,
        lastHistoryId: syncState.lastHistoryId,
      });

      try {
        const response = (await this.request(
          connection,
          `/gmail/v1/users/me/history?startHistoryId=${syncState.lastHistoryId}`,
        )) as Record<string, unknown>;

        allMessages = (response.history as unknown[]) || [];

        newSyncState = {
          lastHistoryId: syncState.lastHistoryId,
          trackedLabels: syncState.trackedLabels || ['INBOX'],
          watchChannelId: syncState.watchChannelId,
          watchResourceId: syncState.watchResourceId,
          watchExpiration: syncState.watchExpiration,
        };

        this.logger.log('Gmail incremental sync completed', {
          connectionId: connection.id,
          historyCount: allMessages.length,
          lastHistoryId: newSyncState.lastHistoryId,
        });

        return {
          messages: { history: allMessages },
          syncState: newSyncState,
        };
      } catch (error) {
        // If we get historyIdOutOfRange, do a fresh baseline
        if (error instanceof Error && error.message.includes('historyIdOutOfRange')) {
          this.logger.warn('Gmail historyId is out of range, performing fresh baseline', {
            connectionId: connection.id,
            oldHistoryId: syncState.lastHistoryId,
          });
          // Fall through to full sync
        } else {
          throw error;
        }
      }
    }

    // Full sync - get all messages and establish historyId
    this.logger.log('Performing full Gmail sync', { connectionId: connection.id });

    const labels = syncState?.trackedLabels || ['INBOX'];
    let nextPageToken: string | undefined;

    // Get all message IDs first
    do {
      let endpoint = `/gmail/v1/users/me/messages?maxResults=500&labelIds=${labels.join(',')}`;
      if (nextPageToken) {
        endpoint += `&pageToken=${nextPageToken}`;
      }

      const response = (await this.request(connection, endpoint)) as Record<string, unknown>;
      const messages = (response.messages as unknown[]) || [];

      allMessages = allMessages.concat(messages);
      nextPageToken = response.nextPageToken as string | undefined;

      this.logger.log('Gmail full sync page completed', {
        connectionId: connection.id,
        pageMessageCount: messages.length,
        totalMessages: allMessages.length,
        hasNextPage: !!nextPageToken,
      });
    } while (nextPageToken);

    // Get current historyId from profile for future incremental syncs
    const profile = (await this.request(connection, '/gmail/v1/users/me/profile')) as Record<string, unknown>;

    newSyncState = {
      lastHistoryId: profile.historyId as string,
      trackedLabels: labels,
    };

    this.logger.log('Gmail full sync completed', {
      connectionId: connection.id,
      totalMessageCount: allMessages.length,
      historyId: newSyncState.lastHistoryId,
    });

    return {
      messages: { messages: allMessages },
      syncState: newSyncState,
    };
  }
}
