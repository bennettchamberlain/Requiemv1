import type {
  CalendarSyncState,
  GmailSyncState,
  CalendarSyncResult,
  DriveSyncState,
  ContactsSyncState,
  YouTubeSyncState,
} from '@ci/domains/etl/types/syncTypes';

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
    'https://www.googleapis.com/auth/drive.readonly',
    'https://www.googleapis.com/auth/youtube',
    'https://www.googleapis.com/auth/contacts',
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

  // Removed People API helper per requirement; use full URLs inline

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

    // Google Contacts - Fetch all contacts (paginated)
    try {
      const contactsSyncState = connection.syncState?.contacts as ContactsSyncState | null;
      const contactsResults = await this.syncContacts(connection, contactsSyncState);

      for (const result of contactsResults) {
        if (result.data !== null) {
          responses.push({
            success: true,
            message: 'Google Contacts sync completed successfully',
            data: {
              results: [
                {
                  api: 'Google Contacts',
                  data: result.data,
                  syncState: result.syncState as Record<string, unknown>,
                },
              ],
              errors: [],
            },
            cursor: { contacts: result.syncState },
          });
        } else {
          responses.push({
            success: true,
            message: 'Google Contacts sync completed (no new data)',
            data: { results: [], errors: [] },
            cursor: { contacts: result.syncState },
          });
        }
      }
    } catch (error) {
      const errorMsg = `Google Contacts API failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
      this.logger.error('Contacts sync failed', { connectionId: connection.id, error: errorMsg });
      responses.push({ success: false, message: errorMsg, data: { results: [], errors: [errorMsg] } });
    }

    // YouTube - Fetch likes, history, and playlists (metadata only)
    try {
      const youtubeSyncState = connection.syncState?.youtube as YouTubeSyncState | null;
      const youtubeResults = await this.syncYouTube(connection, youtubeSyncState);

      for (const result of youtubeResults) {
        if (result.data !== null) {
          responses.push({
            success: true,
            message: 'YouTube sync completed successfully',
            data: {
              results: [
                {
                  api: 'YouTube',
                  data: result.data,
                  syncState: result.syncState as Record<string, unknown>,
                },
              ],
              errors: [],
            },
            cursor: { youtube: result.syncState },
          });
        } else {
          responses.push({
            success: true,
            message: 'YouTube sync completed (no new data)',
            data: { results: [], errors: [] },
            cursor: { youtube: result.syncState },
          });
        }
      }
    } catch (error) {
      const errorMsg = `YouTube API failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
      this.logger.error('YouTube sync failed', { connectionId: connection.id, error: errorMsg });
      responses.push({ success: false, message: errorMsg, data: { results: [], errors: [errorMsg] } });
    }

    // Google Drive - Fetch metadata only (paginated)
    try {
      const driveSyncState = connection.syncState?.drive as DriveSyncState | null;
      const driveResults = await this.syncDriveMetadata(connection, driveSyncState);

      for (const result of driveResults) {
        if (result.data !== null) {
          responses.push({
            success: true,
            message: 'Google Drive metadata sync completed successfully',
            data: {
              results: [
                {
                  api: 'Google Drive',
                  data: result.data,
                  syncState: result.syncState as Record<string, unknown>,
                },
              ],
              errors: [],
            },
            cursor: { drive: result.syncState },
          });
        } else {
          responses.push({
            success: true,
            message: 'Google Drive metadata sync completed (no new data)',
            data: { results: [], errors: [] },
            cursor: { drive: result.syncState },
          });
        }
      }
    } catch (error) {
      this.logger.warn('Drive sync skipped - insufficient permissions or not available', {
        connectionId: connection.id,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
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

  private async syncContacts(
    connection: Connection,
    syncState: ContactsSyncState | null,
  ): Promise<Array<{ data: unknown; syncState: ContactsSyncState }>> {
    // Try incremental sync first if sync token exists
    if (syncState?.syncToken) {
      try {
        return await this.performIncrementalContactsSync(connection, syncState);
      } catch (error) {
        if (error instanceof Error && error.message.includes('410')) {
          this.logger.warn('Contacts sync token is stale, performing full sync', {
            connectionId: connection.id,
          });
          // Fall through to full sync
        } else {
          throw error;
        }
      }
    }

    // Perform full sync to get all contacts and sync token
    return await this.performFullContactsSync(connection);
  }

  private async performFullContactsSync(
    connection: Connection,
  ): Promise<Array<{ data: unknown; syncState: ContactsSyncState }>> {
    const results: Array<{ data: unknown; syncState: ContactsSyncState }> = [];
    const personFields = encodeURIComponent(
      [
        'names',
        'emailAddresses',
        'phoneNumbers',
        'addresses',
        'organizations',
        'occupations',
        'relations',
        'nicknames',
        'birthdays',
        'urls',
        'photos',
        'imClients',
        'locales',
        'locations',
        'interests',
        'skills',
        'sipAddresses',
        'miscKeywords',
        'ageRanges',
        'genders',
        'metadata',
      ].join(','),
    );
    let nextPageToken: string | undefined;

    // Fetch all contacts (no sync token request during pagination)
    do {
      let endpoint = `https://people.googleapis.com/v1/people/me/connections?pageSize=1000&personFields=${personFields}`;
      if (nextPageToken) {
        endpoint += `&pageToken=${nextPageToken}`;
      }

      if (connection.accessToken == null) {
        throw new Error('Connection not authenticated');
      }

      const response = (await fetch(endpoint, {
        headers: { Authorization: `Bearer ${connection.accessToken}` },
      }).then((r) => {
        if (!r.ok) {
          throw new Error(`People API request failed: ${r.status} ${r.statusText}`);
        }

        return r.json();
      })) as Record<string, unknown>;
      const connections = (response.connections as unknown[]) || [];

      nextPageToken = response.nextPageToken as string | undefined;

      // Store page data
      results.push({
        data: { contacts: connections, pageToken: nextPageToken },
        syncState: {} as ContactsSyncState, // Will be updated after all pages
      });
    } while (nextPageToken);

    // After finishing pagination, make one minimal call to request the nextSyncToken
    if (connection.accessToken == null) {
      throw new Error('Connection not authenticated');
    }

    const tokenUrl = `https://people.googleapis.com/v1/people/me/connections?pageSize=1&personFields=${personFields}&requestSyncToken=true`;
    const tokenResp = (await fetch(tokenUrl, {
      headers: { Authorization: `Bearer ${connection.accessToken}` },
    }).then((r) => {
      if (!r.ok) {
        throw new Error(`People API request failed: ${r.status} ${r.statusText}`);
      }

      return r.json();
    })) as Record<string, unknown>;
    if (!tokenResp?.nextSyncToken) {
      throw new Error('Failed to get nextSyncToken from People API');
    }

    const newSyncState: ContactsSyncState = {
      syncToken: tokenResp.nextSyncToken as string,
      lastSyncAt: new Date().toISOString(),
    };

    // Update all results with the final sync state
    results.forEach((result) => {
      result.syncState = newSyncState;
    });

    this.logger.log('Contacts full sync completed', {
      connectionId: connection.id,
      totalPages: results.length,
      syncToken: newSyncState.syncToken,
    });

    return results;
  }

  private async performIncrementalContactsSync(
    connection: Connection,
    syncState: ContactsSyncState,
  ): Promise<Array<{ data: unknown; syncState: ContactsSyncState }>> {
    const personFields = encodeURIComponent(
      [
        'names',
        'emailAddresses',
        'phoneNumbers',
        'addresses',
        'organizations',
        'occupations',
        'relations',
        'nicknames',
        'birthdays',
        'urls',
        'photos',
        'imClients',
        'locales',
        'locations',
        'interests',
        'skills',
        'sipAddresses',
        'miscKeywords',
        'ageRanges',
        'genders',
        'metadata',
      ].join(','),
    );
    const results: Array<{ data: unknown; syncState: ContactsSyncState }> = [];
    let nextPageToken: string | undefined;
    let lastResponse: Record<string, unknown> | null = null;

    do {
      let endpoint = `https://people.googleapis.com/v1/people/me/connections?pageSize=1000&personFields=${personFields}&syncToken=${encodeURIComponent(
        syncState.syncToken as string,
      )}&sortOrder=LAST_MODIFIED_ASCENDING`;
      if (nextPageToken) {
        endpoint += `&pageToken=${nextPageToken}`;
      }

      if (connection.accessToken == null) {
        throw new Error('Connection not authenticated');
      }

      const response = (await fetch(endpoint, {
        headers: { Authorization: `Bearer ${connection.accessToken}` },
      }).then((r) => {
        if (!r.ok) {
          throw new Error(`People API request failed: ${r.status} ${r.statusText}`);
        }

        return r.json();
      })) as Record<string, unknown>;
      const connections = (response.connections as unknown[]) || [];
      nextPageToken = response.nextPageToken as string | undefined;
      lastResponse = response;

      if (connections.length > 0) {
        results.push({
          data: { contacts: connections, pageToken: nextPageToken },
          syncState: {} as ContactsSyncState,
        });
      }
    } while (nextPageToken);

    const newSyncToken = (lastResponse?.nextSyncToken as string) || syncState.syncToken;
    const newSyncState: ContactsSyncState = {
      syncToken: newSyncToken,
      lastSyncAt: new Date().toISOString(),
    };

    if (results.length === 0) {
      return [
        {
          data: null,
          syncState: newSyncState,
        },
      ];
    }

    results.forEach((r) => (r.syncState = newSyncState));

    return results;
  }

  private async syncYouTube(
    connection: Connection,
    syncState: YouTubeSyncState | null,
  ): Promise<Array<{ data: unknown; syncState: YouTubeSyncState }>> {
    const results: Array<{ data: unknown; syncState: YouTubeSyncState }> = [];
    const newSyncState: YouTubeSyncState = {
      lastSyncAt: new Date().toISOString(),
      lastLikesItemId: syncState?.lastLikesItemId,
      lastHistoryItemId: syncState?.lastHistoryItemId,
      lastPlaylistId: syncState?.lastPlaylistId,
    };

    const collectPlaylistItemsIncremental = async (
      playlistId: string,
      stopAtItemId?: string,
    ): Promise<{ items: unknown[]; newTopItemId?: string }> => {
      let pageToken: string | undefined = undefined;
      const items: unknown[] = [];
      let topItemId: string | undefined;
      let reachedKnown = false;

      do {
        let endpoint = `/youtube/v3/playlistItems?part=snippet,contentDetails&maxResults=50&playlistId=${playlistId}`;
        if (pageToken) {
          endpoint += `&pageToken=${pageToken}`;
        }

        const resp = (await this.request(connection, endpoint)) as Record<string, unknown>;
        const pageItems = (resp.items as Array<Record<string, unknown>>) || [];
        if (!topItemId && pageItems.length > 0) {
          topItemId = String(pageItems[0].id || '');
        }

        for (const it of pageItems) {
          const idStr = String(it.id || '');
          if (stopAtItemId && idStr === stopAtItemId) {
            reachedKnown = true;
            break;
          }

          items.push(it);
        }

        if (reachedKnown) {
          break;
        }

        pageToken = resp.nextPageToken as string | undefined;
      } while (pageToken);

      return { items, newTopItemId: topItemId };
    };

    // Playlists (mine) - track newest playlist id
    try {
      let pageToken: string | undefined = undefined;
      const collected: Array<Record<string, unknown>> = [];
      let newestId: string | undefined;
      let reachedKnown = false;

      do {
        let endpoint = `/youtube/v3/playlists?part=snippet,contentDetails&maxResults=50&mine=true`;
        if (pageToken) {
          endpoint += `&pageToken=${pageToken}`;
        }

        const resp = (await this.request(connection, endpoint)) as Record<string, unknown>;
        const pageItems = (resp.items as Array<Record<string, unknown>>) || [];

        if (!newestId && pageItems.length > 0) {
          newestId = String(pageItems[0].id || '');
        }

        for (const pl of pageItems) {
          const idStr = String(pl.id || '');
          if (syncState?.lastPlaylistId && idStr === syncState.lastPlaylistId) {
            reachedKnown = true;
            break;
          }

          collected.push(pl);
        }

        if (reachedKnown) {
          break;
        }

        pageToken = resp.nextPageToken as string | undefined;
      } while (pageToken);

      if (newestId) {
        newSyncState.lastPlaylistId = newestId;
      }

      if (collected.length > 0) {
        results.push({ data: { type: 'playlists', items: collected }, syncState: newSyncState });
      } else {
        results.push({ data: null, syncState: newSyncState });
      }
    } catch (e) {
      this.logger.warn('YouTube playlists fetch skipped', {
        connectionId: connection.id,
        error: e instanceof Error ? e.message : 'Unknown error',
      });
    }

    // Likes (playlistId=LL)
    try {
      const inc = await collectPlaylistItemsIncremental('LL', syncState?.lastLikesItemId);
      if (inc.newTopItemId) {
        newSyncState.lastLikesItemId = inc.newTopItemId;
      }

      if (inc.items.length > 0) {
        results.push({ data: { type: 'likes', items: inc.items }, syncState: newSyncState });
      } else {
        results.push({ data: null, syncState: newSyncState });
      }
    } catch (e) {
      this.logger.warn('YouTube likes fetch skipped', {
        connectionId: connection.id,
        error: e instanceof Error ? e.message : 'Unknown error',
      });
    }

    // History (playlistId=HL)
    try {
      const inc = await collectPlaylistItemsIncremental('HL', syncState?.lastHistoryItemId);
      if (inc.newTopItemId) {
        newSyncState.lastHistoryItemId = inc.newTopItemId;
      }

      if (inc.items.length > 0) {
        results.push({ data: { type: 'history', items: inc.items }, syncState: newSyncState });
      } else {
        results.push({ data: null, syncState: newSyncState });
      }
    } catch (e) {
      this.logger.warn('YouTube history fetch skipped', {
        connectionId: connection.id,
        error: e instanceof Error ? e.message : 'Unknown error',
      });
    }

    return results;
  }

  private async syncDriveMetadata(
    connection: Connection,
    syncState: DriveSyncState | null,
  ): Promise<Array<{ data: unknown; syncState: DriveSyncState }>> {
    const results: Array<{ data: unknown; syncState: DriveSyncState }> = [];
    const fieldsChanges = encodeURIComponent(
      'nextPageToken,newStartPageToken,changes(file(id,name,mimeType,modifiedTime,owners,iconLink,webViewLink,size),fileId,removed)',
    );

    // If we don't yet have a startPageToken, perform an initial full metadata listing, then seed the token
    if (!syncState?.startPageToken) {
      const fieldsList = encodeURIComponent(
        'nextPageToken,files(id,name,mimeType,modifiedTime,owners,iconLink,webViewLink,size)',
      );
      let nextPageToken: string | undefined;
      let totalFiles = 0;

      do {
        let endpoint = `/drive/v3/files?pageSize=200&fields=${fieldsList}&q=trashed=false&orderBy=modifiedTime desc`;
        if (nextPageToken) {
          endpoint += `&pageToken=${nextPageToken}`;
        }

        const response = (await this.request(connection, endpoint)) as Record<string, unknown>;
        const files = (response.files as unknown[]) || [];
        nextPageToken = response.nextPageToken as string | undefined;
        totalFiles += files.length;

        if (files.length > 0) {
          results.push({ data: { files, nextPageToken }, syncState: {} as DriveSyncState });
        }
      } while (nextPageToken);

      // After listing, fetch a startPageToken for future incremental syncs
      const tokenResp = (await this.request(connection, `/drive/v3/changes/startPageToken`)) as Record<
        string,
        unknown
      >;
      const startPageToken = String(tokenResp.startPageToken || '');
      const newSyncState: DriveSyncState = { startPageToken, lastSyncAt: new Date().toISOString() };

      if (results.length === 0) {
        return [
          {
            data: null,
            syncState: newSyncState,
          },
        ];
      }

      results.forEach((r) => (r.syncState = newSyncState));
      this.logger.log('Drive initial metadata listing completed', {
        connectionId: connection.id,
        count: totalFiles,
      });

      return results;
    }

    let pageToken: string | undefined = syncState.startPageToken;
    let newStartPageToken: string | undefined;
    let totalChanges = 0;

    do {
      const endpoint = `/drive/v3/changes?pageSize=200&includeRemoved=true&restrictToMyDrive=true&fields=${fieldsChanges}&pageToken=${encodeURIComponent(pageToken || '')}`;
      const response = (await this.request(connection, endpoint)) as Record<string, unknown>;
      const changes = (response.changes as unknown[]) || [];
      const nextPageToken = response.nextPageToken as string | undefined;
      newStartPageToken = response.newStartPageToken as string | undefined;
      totalChanges += changes.length;

      if (changes.length > 0) {
        const changedFiles = changes
          .map((c) => c as Record<string, unknown>)
          .filter((c) => c.file && c.removed !== true)
          .map((c) => c.file);
        if (changedFiles.length > 0) {
          results.push({ data: { files: changedFiles, nextPageToken }, syncState: {} as DriveSyncState });
        }
      }

      pageToken = nextPageToken;
    } while (pageToken);

    const finalToken = newStartPageToken || syncState.startPageToken;
    const newSyncState: DriveSyncState = { startPageToken: finalToken, lastSyncAt: new Date().toISOString() };

    if (results.length === 0) {
      return [
        {
          data: null,
          syncState: newSyncState,
        },
      ];
    }

    results.forEach((r) => (r.syncState = newSyncState));
    this.logger.log('Drive changes sync completed', {
      connectionId: connection.id,
      changeCount: totalChanges,
    });

    return results;
  }
}
