import type { CalendarSyncState, GmailSyncState, CalendarSyncResult } from '@ci/domains/etl/types/syncTypes';

import type { Connection } from '../types';

import { BaseOAuth2Client } from './BaseOAuth2Client';
import type { SyncResponse } from './types';

export class GoogleClient extends BaseOAuth2Client {
  protected readonly baseUrl = 'https://www.googleapis.com';

  protected readonly authorizationEndpoint = 'https://accounts.google.com/o/oauth2/v2/auth';

  protected readonly tokenEndpoint = 'https://oauth2.googleapis.com/token';

  protected readonly scopes = [
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/calendar.readonly',
  ];

  protected get clientId() {
    const clientIdVariable = 'GOOGLE_CLIENT_ID';
    const clientId = process.env[clientIdVariable];

    if (!clientId) {
      this.logger.error(`Expected environment variable ${clientIdVariable} not specified`);

      throw new Error('Client id not configured for provider');
    }

    return clientId;
  }

  protected get clientSecret() {
    const clientSecretVariable = 'GOOGLE_CLIENT_SECRET';
    const clientSecret = process.env[clientSecretVariable];

    if (!clientSecret) {
      this.logger.error(`Expected environment variable ${clientSecretVariable} not specified`);

      throw new Error('Client secret not configured for provider');
    }

    return clientSecret;
  }

  async sync(connection: Connection): Promise<SyncResponse[]> {
    const responses: SyncResponse[] = [];

    // Google Calendar API - Incremental sync
    try {
      const calendarSyncState = connection.syncState?.calendar as CalendarSyncState | null;

      const calendarResults = await this.syncCalendar(connection, calendarSyncState);

      // Process Calendar results - only create API logs for results with actual data
      for (const result of calendarResults) {
        this.logger.log('Processing Calendar result', {
          connectionId: connection.id,
          hasData: result.data !== null,
          syncState: result.syncState,
          syncToken: result.syncState?.syncToken,
        });

        if (result.data !== null) {
          // Only create API log if there's actual data
          responses.push({
            success: true,
            message: 'Google Calendar sync completed successfully',
            data: {
              results: [
                {
                  api: 'Google Calendar',
                  data: result.data,
                  syncState: result.syncState as Record<string, unknown>,
                },
              ],
              errors: [],
            },
            cursor: { calendar: result.syncState },
          });
        } else {
          // Update sync state without creating API log
          responses.push({
            success: true,
            message: 'Google Calendar sync completed (no new data)',
            data: {
              results: [],
              errors: [],
            },
            cursor: { calendar: result.syncState },
          });
        }
      }
    } catch (error) {
      const errorMsg = `Google Calendar API failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
      this.logger.error('Calendar sync failed', { connectionId: connection.id, error: errorMsg });

      responses.push({
        success: false,
        message: errorMsg,
        data: {
          results: [],
          errors: [errorMsg],
        },
      });
    }

    // Gmail API - Incremental sync
    try {
      const gmailSyncState = connection.syncState?.gmail as GmailSyncState | null;

      const gmailResults = await this.syncGmail(connection, gmailSyncState);

      // Process Gmail results - only create API logs for results with actual data
      for (const result of gmailResults) {
        if (result.data !== null) {
          // Only create API log if there's actual data
          responses.push({
            success: true,
            message: 'Gmail sync completed successfully',
            data: {
              results: [
                {
                  api: 'Gmail',
                  data: result.data,
                  syncState: result.syncState as Record<string, unknown>,
                },
              ],
              errors: [],
            },
            cursor: { gmail: result.syncState },
          });
        } else {
          // Update sync state without creating API log
          responses.push({
            success: true,
            message: 'Gmail sync completed (no new data)',
            data: {
              results: [],
              errors: [],
            },
            cursor: { gmail: result.syncState },
          });
        }
      }
    } catch (error) {
      const errorMsg = `Gmail API failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
      this.logger.error('Gmail sync failed', { connectionId: connection.id, error: errorMsg });

      responses.push({
        success: false,
        message: errorMsg,
        data: {
          results: [],
          errors: [errorMsg],
        },
      });
    }

    // Google Drive API - Simple sync (no incremental support yet)
    // Note: Drive API requires specific scopes and may not be available for all connections
    try {
      const driveData = await this.request(connection, '/drive/v3/files?pageSize=10');
      const currentTime = new Date().toISOString();

      responses.push({
        success: true,
        message: 'Google Drive sync completed successfully',
        data: {
          results: [
            {
              api: 'Google Drive',
              data: driveData,
            },
          ],
          errors: [],
        },
        cursor: { drive: { lastSyncAt: currentTime } }, // Track Drive sync time
      });

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
      // Don't add to responses array - this is expected for connections without Drive scope
    }

    return responses;
  }

  private async syncCalendar(
    connection: Connection,
    syncState: CalendarSyncState | null,
  ): Promise<CalendarSyncResult[]> {
    // Try incremental sync first if sync token exists
    if (syncState?.syncToken) {
      try {
        return await this.performIncrementalSync(connection, syncState);
      } catch (error) {
        if (error instanceof Error && error.message.includes('410')) {
          this.logger.warn('Sync token is stale, performing full sync', {
            connectionId: connection.id,
          });
          // Fall through to full sync
        } else {
          throw error;
        }
      }
    }

    // Perform full sync to get all events and sync token
    return await this.performFullSync(connection);
  }

  private async performFullSync(connection: Connection): Promise<CalendarSyncResult[]> {
    const results: Array<{ data: unknown; syncState: CalendarSyncState }> = [];
    let nextPageToken: string | undefined;
    let lastResponse: Record<string, unknown> | null = null;

    // Fetch all events to get sync token (no time restrictions)
    do {
      let endpoint = `/calendar/v3/calendars/primary/events?maxResults=2500&showDeleted=true&singleEvents=true`;
      if (nextPageToken) {
        endpoint += `&pageToken=${nextPageToken}`;
      }

      const response = (await this.request(connection, endpoint)) as Record<string, unknown>;
      const events = (response.items as unknown[]) || [];

      nextPageToken = response.nextPageToken as string | undefined;
      lastResponse = response;

      // Store page data
      results.push({
        data: { items: events, pageToken: nextPageToken },
        syncState: {} as CalendarSyncState, // Will be updated after all pages
      });
    } while (nextPageToken);

    // Get sync token from last response
    if (!lastResponse?.nextSyncToken) {
      throw new Error('Failed to get nextSyncToken from Google Calendar API');
    }

    const newSyncState: CalendarSyncState = {
      syncToken: lastResponse.nextSyncToken as string,
      lastFullSyncAt: new Date().toISOString(),
    };

    // Update all results with the final sync state
    results.forEach((result) => {
      result.syncState = newSyncState;
    });

    return results;
  }

  private async performIncrementalSync(
    connection: Connection,
    syncState: CalendarSyncState,
  ): Promise<CalendarSyncResult[]> {
    const response = (await this.request(
      connection,
      `/calendar/v3/calendars/primary/events?syncToken=${syncState.syncToken}&showDeleted=true`,
    )) as Record<string, unknown>;

    const events = (response.items as unknown[]) || [];
    const newSyncToken = response.nextSyncToken as string;

    const newSyncState: CalendarSyncState = {
      syncToken: newSyncToken,
      lastFullSyncAt: syncState.lastFullSyncAt,
      lastUpdatedMinUsed: syncState.lastUpdatedMinUsed,
    };

    // Return data only if there are events
    if (events.length > 0) {
      return [
        {
          data: { items: events, nextSyncToken: newSyncToken },
          syncState: newSyncState,
        },
      ];
    } else {
      return [
        {
          data: null,
          syncState: newSyncState,
        },
      ];
    }
  }

  private async syncGmail(
    connection: Connection,
    syncState: GmailSyncState | null,
  ): Promise<Array<{ data: unknown; syncState: GmailSyncState }>> {
    const results: Array<{ data: unknown; syncState: GmailSyncState }> = [];
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

        const history = (response.history as unknown[]) || [];
        const newHistoryId = response.historyId as string;

        newSyncState = {
          lastHistoryId: newHistoryId,
          trackedLabels: syncState.trackedLabels || ['INBOX'],
          watchChannelId: syncState.watchChannelId,
          watchResourceId: syncState.watchResourceId,
          watchExpiration: syncState.watchExpiration,
        };

        // Always return the updated sync state, but only include data if there's history
        if (history.length > 0) {
          results.push({
            data: { history, historyId: newHistoryId },
            syncState: newSyncState,
          });
        } else {
          // Return sync state update without data
          results.push({
            data: null, // No data to log
            syncState: newSyncState,
          });
        }

        return results;
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
    let totalMessages = 0;
    let pageCount = 0;

    // Get all message IDs first
    do {
      let endpoint = `/gmail/v1/users/me/messages?maxResults=500&labelIds=${labels.join(',')}`;
      if (nextPageToken) {
        endpoint += `&pageToken=${nextPageToken}`;
      }

      const response = (await this.request(connection, endpoint)) as Record<string, unknown>;
      const messages = (response.messages as unknown[]) || [];

      totalMessages += messages.length;
      nextPageToken = response.nextPageToken as string | undefined;
      pageCount++;

      this.logger.log('Gmail full sync page completed', {
        connectionId: connection.id,
        pageMessageCount: messages.length,
        totalMessages,
        pageNumber: pageCount,
        hasNextPage: !!nextPageToken,
      });

      // Create a result for this page (but don't include syncState yet)
      results.push({
        data: { messages, pageToken: nextPageToken, pageNumber: pageCount },
        syncState: {} as GmailSyncState, // Will be updated after all pages
      });
    } while (nextPageToken);

    // Get current historyId from profile for future incremental syncs
    const profile = (await this.request(connection, '/gmail/v1/users/me/profile')) as Record<string, unknown>;

    newSyncState = {
      lastHistoryId: profile.historyId as string,
      trackedLabels: labels,
    };

    // Update all results with the final sync state
    results.forEach((result) => {
      result.syncState = newSyncState;
    });

    this.logger.log('Gmail full sync completed', {
      connectionId: connection.id,
      totalMessageCount: totalMessages,
      totalPages: pageCount,
      historyId: newSyncState.lastHistoryId,
    });

    return results;
  }
}
