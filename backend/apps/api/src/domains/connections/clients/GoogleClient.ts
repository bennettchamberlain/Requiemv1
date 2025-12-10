import { Injectable } from '@nestjs/common';

import { LoggerService } from '@ci/common/logging';
import type {
  CalendarSyncState,
  GmailSyncState,
  CalendarSyncResult,
  DriveSyncState,
  ContactsSyncState,
  YouTubeSyncState,
  GoogleSyncState,
} from '@ci/domains/etl';

import type { Connection } from '../entities/ConnectionEntity';

import { BaseOAuth2Client } from './BaseOAuth2Client';
import type { SyncResponse } from './types';

@Injectable()
export class GoogleClient extends BaseOAuth2Client {
  constructor(protected readonly logger: LoggerService) {
    super();
    this.logger.setContext(GoogleClient.name);
  }

  protected readonly baseUrl = 'https://www.googleapis.com';

  protected readonly authorizationEndpoint = 'https://accounts.google.com/o/oauth2/v2/auth';

  protected readonly tokenEndpoint = 'https://oauth2.googleapis.com/token';

  protected readonly scopeNames = [
    'gmail.readonly',
    'calendar.readonly',
    'drive.readonly',
    'youtube',
    'contacts',
  ];

  protected readonly scopes = this.scopeNames.map((scope) => `https://www.googleapis.com/auth/${scope}`);

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

  /**
   * Generic handler for processing API sync results
   * Handles the common pattern of: fetch sync state -> call sync method -> process results -> handle errors
   */
  private async processSyncAPI<TState>(
    connection: Connection,
    config: {
      apiName: string;
      stateKey: keyof GoogleSyncState & string;
      syncMethod: (
        connection: Connection,
        syncState: TState | null,
      ) => Promise<Array<{ data: unknown; syncState: TState }>>;
      logWarningOnError?: boolean;
    },
  ): Promise<SyncResponse[]> {
    const responses: SyncResponse[] = [];

    try {
      const syncState = connection.syncState?.[config.stateKey] as TState | null;
      const results = await config.syncMethod(connection, syncState);

      for (const result of results) {
        if (result.data !== null) {
          responses.push({
            success: true,
            message: `${config.apiName} sync completed successfully`,
            data: {
              results: [
                {
                  api: config.apiName,
                  data: result.data,
                  syncState: result.syncState as Record<string, unknown>,
                },
              ],
              errors: [],
            },
            cursor: { [config.stateKey]: result.syncState },
          });
        } else {
          responses.push({
            success: true,
            message: `${config.apiName} sync completed (no new data)`,
            data: { results: [], errors: [] },
            cursor: { [config.stateKey]: result.syncState },
          });
        }
      }
    } catch (error) {
      const errorMsg = `${config.apiName} API failed: ${error instanceof Error ? error.message : 'Unknown error'}`;

      if (config.logWarningOnError) {
        this.logger.warn(`${config.stateKey} sync skipped - insufficient permissions or not available`, {
          connectionId: connection.id,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      } else {
        this.logger.error(`${config.stateKey} sync failed`, {
          connectionId: connection.id,
          error: errorMsg,
        });

        responses.push({
          success: false,
          message: errorMsg,
          data: { results: [], errors: [errorMsg] },
        });
      }
    }

    return responses;
  }

  async sync(connection: Connection): Promise<SyncResponse[]> {
    const responses: SyncResponse[] = [];

    responses.push(
      ...(await this.processSyncAPI<CalendarSyncState>(connection, {
        apiName: 'Google Calendar',
        stateKey: 'calendar',
        syncMethod: this.syncCalendar.bind(this),
      })),
    );

    responses.push(
      ...(await this.processSyncAPI<GmailSyncState>(connection, {
        apiName: 'Gmail',
        stateKey: 'gmail',
        syncMethod: this.syncGmail.bind(this),
      })),
    );

    responses.push(
      ...(await this.processSyncAPI<ContactsSyncState>(connection, {
        apiName: 'Google Contacts',
        stateKey: 'contacts',
        syncMethod: this.syncContacts.bind(this),
      })),
    );

    responses.push(
      ...(await this.processSyncAPI<YouTubeSyncState>(connection, {
        apiName: 'YouTube',
        stateKey: 'youtube',
        syncMethod: this.syncYouTube.bind(this),
      })),
    );

    responses.push(
      ...(await this.processSyncAPI<DriveSyncState>(connection, {
        apiName: 'Google Drive',
        stateKey: 'drive',
        syncMethod: this.syncDriveMetadata.bind(this),
        logWarningOnError: true,
      })),
    );

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
      const params = new URLSearchParams({
        maxResults: '2500',
        showDeleted: 'true',
        singleEvents: 'true',
      });
      if (nextPageToken) {
        params.set('pageToken', nextPageToken);
      }

      const endpoint = `/calendar/v3/calendars/primary/events?${params.toString()}`;

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
    const params = new URLSearchParams({
      syncToken: syncState.syncToken || '',
      showDeleted: 'true',
    });
    const endpoint = `/calendar/v3/calendars/primary/events?${params.toString()}`;

    const response = (await this.request(connection, endpoint)) as Record<string, unknown>;

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
      const params = new URLSearchParams({
        maxResults: '500',
        labelIds: labels.join(','),
      });
      if (nextPageToken) {
        params.set('pageToken', nextPageToken);
      }

      const endpoint = `/gmail/v1/users/me/messages?${params.toString()}`;

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
    const personFields = [
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
    ].join(',');
    let nextPageToken: string | undefined;
    let lastResponse: Record<string, unknown> | null = null;

    // Fetch all contacts (no sync token request during pagination)
    do {
      const params = new URLSearchParams({
        pageSize: '1000',
        personFields,
        requestSyncToken: 'true',
      });
      if (nextPageToken) {
        params.set('pageToken', nextPageToken);
      }

      const endpoint = `https://people.googleapis.com/v1/people/me/connections?${params.toString()}`;

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
      lastResponse = response;
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

    const nextSyncToken = lastResponse?.nextSyncToken as string;
    const newSyncState: ContactsSyncState = {
      syncToken: nextSyncToken as string,
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
    const personFields = [
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
    ].join(',');
    const results: Array<{ data: unknown; syncState: ContactsSyncState }> = [];
    let nextPageToken: string | undefined;
    let lastResponse: Record<string, unknown> | null = null;

    do {
      const params = new URLSearchParams({
        pageSize: '1000',
        personFields,
        syncToken: syncState.syncToken as string,
        sortOrder: 'LAST_MODIFIED_ASCENDING',
      });
      if (nextPageToken) {
        params.set('pageToken', nextPageToken);
      }

      const endpoint = `https://people.googleapis.com/v1/people/me/connections?${params.toString()}`;

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
      lastPlaylistId: syncState?.lastPlaylistId,
      lastSubscriptionId: syncState?.lastSubscriptionId,
      lastActivityId: syncState?.lastActivityId,
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
        const params = new URLSearchParams({
          part: 'snippet,contentDetails',
          maxResults: '50',
          playlistId,
        });
        if (pageToken) {
          params.set('pageToken', pageToken);
        }

        const endpoint = `/youtube/v3/playlistItems?${params.toString()}`;

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
        const params = new URLSearchParams({
          part: 'snippet,contentDetails',
          maxResults: '50',
          mine: 'true',
        });
        if (pageToken) {
          params.set('pageToken', pageToken);
        }

        const endpoint = `/youtube/v3/playlists?${params.toString()}`;

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

    // Subscriptions
    try {
      const subscriptions: unknown[] = [];
      let pageToken: string | undefined;
      let newestId: string | undefined;

      do {
        const params = new URLSearchParams({
          part: 'snippet,contentDetails',
          mine: 'true',
          maxResults: '50',
        });
        if (pageToken) {
          params.set('pageToken', pageToken);
        }

        const url = `https://www.googleapis.com/youtube/v3/subscriptions?${params.toString()}`;
        const resp = (await fetch(url, {
          headers: { Authorization: `Bearer ${connection.accessToken}` },
        }).then((r) => {
          if (!r.ok) {
            throw new Error(`YouTube subscriptions API failed: ${r.status} ${r.statusText}`);
          }

          return r.json();
        })) as Record<string, unknown>;

        const items = (resp.items as unknown[]) || [];
        for (const item of items) {
          const itemObj = item as Record<string, unknown>;
          const itemId = itemObj.id as string;

          if (!newestId) {
            newestId = itemId;
          }

          if (itemId === syncState?.lastSubscriptionId) {
            break;
          }

          subscriptions.push(item);
        }

        pageToken = resp.nextPageToken as string | undefined;
      } while (pageToken && subscriptions.length < 500);

      if (newestId) {
        newSyncState.lastSubscriptionId = newestId;
      }

      if (subscriptions.length > 0) {
        results.push({ data: { type: 'subscriptions', items: subscriptions }, syncState: newSyncState });
      } else {
        results.push({ data: null, syncState: newSyncState });
      }
    } catch (e) {
      this.logger.warn('YouTube subscriptions fetch skipped', {
        connectionId: connection.id,
        error: e instanceof Error ? e.message : 'Unknown error',
      });
    }

    // Activities (comments, uploads, likes)
    try {
      const activities: unknown[] = [];
      let pageToken: string | undefined;
      let newestId: string | undefined;

      do {
        const params = new URLSearchParams({
          part: 'snippet,contentDetails',
          mine: 'true',
          maxResults: '50',
        });
        if (pageToken) {
          params.set('pageToken', pageToken);
        }

        const url = `https://www.googleapis.com/youtube/v3/activities?${params.toString()}`;
        const resp = (await fetch(url, {
          headers: { Authorization: `Bearer ${connection.accessToken}` },
        }).then((r) => {
          if (!r.ok) {
            throw new Error(`YouTube activities API failed: ${r.status} ${r.statusText}`);
          }

          return r.json();
        })) as Record<string, unknown>;

        const items = (resp.items as unknown[]) || [];
        for (const item of items) {
          const itemObj = item as Record<string, unknown>;
          const itemId = itemObj.id as string;

          if (!newestId) {
            newestId = itemId;
          }

          if (itemId === syncState?.lastActivityId) {
            break;
          }

          activities.push(item);
        }

        pageToken = resp.nextPageToken as string | undefined;
      } while (pageToken && activities.length < 500);

      if (newestId) {
        newSyncState.lastActivityId = newestId;
      }

      if (activities.length > 0) {
        results.push({ data: { type: 'activities', items: activities }, syncState: newSyncState });
      } else {
        results.push({ data: null, syncState: newSyncState });
      }
    } catch (e) {
      this.logger.warn('YouTube activities fetch skipped', {
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
    const fieldsChanges =
      'nextPageToken,newStartPageToken,changes(file(id,name,mimeType,modifiedTime,owners,iconLink,webViewLink,size),fileId,removed)';

    // If we don't yet have a startPageToken, perform an initial full metadata listing, then seed the token
    if (!syncState?.startPageToken) {
      const fieldsList =
        'nextPageToken,files(id,name,mimeType,modifiedTime,owners,iconLink,webViewLink,size)';
      let nextPageToken: string | undefined;
      let totalFiles = 0;

      do {
        const params = new URLSearchParams({
          pageSize: '200',
          fields: fieldsList,
          q: 'trashed=false',
          orderBy: 'modifiedTime desc',
        });
        if (nextPageToken) {
          params.set('pageToken', nextPageToken);
        }

        const endpoint = `/drive/v3/files?${params.toString()}`;

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
      const params = new URLSearchParams({
        pageSize: '200',
        includeRemoved: 'true',
        restrictToMyDrive: 'true',
        fields: fieldsChanges,
        pageToken: pageToken || '',
      });
      const endpoint = `/drive/v3/changes?${params.toString()}`;
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
