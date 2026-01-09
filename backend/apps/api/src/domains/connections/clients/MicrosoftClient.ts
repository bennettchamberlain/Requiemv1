import type { Buffer } from 'node:buffer';

import { Injectable } from '@nestjs/common';

import { LoggerService } from '@ci/common/logging';
import type {
  OutlookCalendarSyncState,
  OutlookCalendarsSyncState,
  OutlookMailSyncState,
  OneDriveSyncState,
} from '@ci/domains/etl';

import type { Connection } from '../entities/ConnectionEntity';

import { BaseOAuth2Client } from './BaseOAuth2Client';
import type { SyncResponse } from './types';

const OUTLOOK_SKIP_REGEX = /skip=(\d+)(&?)/;
const ONEDRIVE_ETAG_REGEX =
  /^"([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}),[0-9]"$/;

const MAIL_PAGE_SIZE = 50;
const CALENDAR_PAGE_SIZE = 50;
const ONEDRIVE_PAGE_SIZE = 50;

interface Calendar {
  id: string;
  name: string;
  isDefaultCalendar: boolean;
  changeKey: string;
  owner: {
    name: string;
    address: string;
  };
}

export interface OneDriveUser {
  email: string;
  displayName: string;
}

export interface OneDrivePageEntity {
  '@odata.etag': string;
  createdDateTime: string;
  eTag: string;
  id: string;
  lastModifiedDateTime: string;
  webUrl: string;
  createdBy: {
    user: OneDriveUser;
  };
  lastModifiedBy: {
    user: OneDriveUser;
  };
  content?: OneDriveFileEntity;
}

export interface OneDriveFileEntity {
  '@microsoft.graph.downloadUrl': string;
  createdDateTime: string;
  eTag: string;
  id: string;
  lastModifiedDateTime: string;
  name: string;
  webUrl: string;
  size: number;
  createdBy: {
    user: OneDriveUser;
  };
  lastModifiedBy: {
    user: OneDriveUser;
  };
  file: {
    mimeType: string;
    hashes: {
      [key: string]: string;
    };
  };
  image?: {
    height: number;
    width: number;
  };
  photo?: {
    orientation?: number;
  };
  raw?: Buffer;
}

@Injectable()
export class MicrosoftClient extends BaseOAuth2Client {
  constructor(protected readonly logger: LoggerService) {
    super();
    this.logger.setContext(MicrosoftClient.name);
  }

  protected readonly baseUrl = 'https://graph.microsoft.com';

  protected readonly authorizationEndpoint = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize';

  protected readonly tokenEndpoint = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';

  protected readonly scopes = ['user.read', 'mail.read', 'calendars.read', 'files.read', 'offline_access'];

  protected readonly extraAuthParams = {};

  protected readonly endpointMap = {
    'Outlook Mail': ['mail.read'],
    Calendar: ['calendars.read'],
    OneDrive: ['files.read'],
    default: ['offline_access', 'user.read'],
  };

  protected getScopesFromActiveEndpoints(activeEndpoints: string[]): string {
    const scopesSet = new Set<string>(this.endpointMap['default']);

    activeEndpoints.forEach((endpoint) => {
      const scopes = this.endpointMap[endpoint as keyof typeof this.endpointMap];
      scopes.forEach((scope) => scopesSet.add(scope));
    });

    return scopesSet.size > 0 ? Array.from(scopesSet).join(' ') : '';
  }

  protected get clientId() {
    const clientIdVariable = 'MICROSOFT_CLIENT_ID';
    const clientId = process.env[clientIdVariable];

    if (!clientId) {
      this.logger.error(`Expected environment variable ${clientIdVariable} not specified`);

      throw new Error('Client id not configured for provider');
    }

    return clientId;
  }

  protected get clientSecret() {
    const clientSecretVariable = 'MICROSOFT_CLIENT_SECRET';
    const clientSecret = process.env[clientSecretVariable];

    if (!clientSecret) {
      this.logger.error(`Expected environment variable ${clientSecretVariable} not specified`);

      throw new Error('Client secret not configured for provider');
    }

    return clientSecret;
  }

  async sync(connection: Connection): Promise<SyncResponse[]> {
    const responses: SyncResponse[] = [];

    if (connection.activeEndpoints.indexOf('OneDrive') > -1) {
      // Microsoft Graph - OneDrive
      try {
        const oneDriveSyncState = connection.syncState?.oneDrive as OneDriveSyncState | null;
        const oneDriveResults = await this.syncOneDrive(connection, oneDriveSyncState);

        responses.push({
          success: true,
          message: 'Microsoft Graph - OneDrive sync completed successfully',
          data: {
            results: [{ api: 'Microsoft Graph - OneDrive Files', data: oneDriveResults }],
            errors: [],
          },
          cursor: {
            oneDrive: oneDriveResults[0].syncState || oneDriveSyncState,
          },
        });
      } catch (error) {
        const errorMsg = `Microsoft OneDrive API failed: ${error instanceof Error ? error.message : 'Unknown error'}`;

        responses.push({
          success: false,
          message: errorMsg,
          data: {
            results: [],
            errors: [errorMsg],
          },
        });
      }
    }

    if (connection.activeEndpoints.indexOf('Calendar') > -1) {
      // Microsoft Graph - Calendar
      try {
        const outlookCalendarsSyncState =
          (connection.syncState?.outlookCalendars as OutlookCalendarsSyncState) ||
          ({} as OutlookCalendarsSyncState);
        const calendarsResults = await this.syncCalendars(connection, outlookCalendarsSyncState);

        for (const response of calendarsResults) {
          outlookCalendarsSyncState[response.calendarId] = { skip: response.syncState.skip! };
        }

        responses.push({
          success: true,
          message: 'Microsoft Graph - Calendar sync completed successfully',
          data: {
            results: [{ api: 'Microsoft Graph - Calendar', data: calendarsResults }],
            errors: [],
          },
          cursor: {
            outlookCalendars: outlookCalendarsSyncState,
          },
        });
      } catch (error) {
        const errorMsg = `Microsoft Calendar API failed: ${error instanceof Error ? error.message : 'Unknown error'}`;

        responses.push({
          success: false,
          message: errorMsg,
          data: {
            results: [],
            errors: [errorMsg],
          },
        });
      }
    }

    if (connection.activeEndpoints.indexOf('Outlook Mail') > -1) {
      // Microsoft Graph - Mail
      try {
        const outlookMailSyncState = connection.syncState?.outlookMail as OutlookMailSyncState | null;
        const outlookResults = await this.syncOutlook(connection, outlookMailSyncState);

        responses.push({
          success: true,
          message: 'Microsoft Graph - Mail sync completed successfully',
          data: {
            results: [{ api: 'Microsoft Graph - Mail', data: outlookResults }],
            errors: [],
          },
          cursor: {
            outlookMail: outlookResults[0].syncState || outlookMailSyncState,
          },
        });
      } catch (error) {
        const errorMsg = `Microsoft Mail API failed: ${error instanceof Error ? error.message : 'Unknown error'}`;

        responses.push({
          success: false,
          message: errorMsg,
          data: {
            results: [],
            errors: [errorMsg],
          },
        });
      }
    }

    return responses;
  }

  async syncOutlook(
    connection: Connection,
    syncState: OutlookMailSyncState | null,
  ): Promise<Array<{ data: unknown; syncState: OutlookMailSyncState }>> {
    const results: Array<{ data: unknown; syncState: OutlookMailSyncState }> = [];

    // Full sync - get all messages and establish skip
    this.logger.log('Performing full Outlook Mail sync', { connectionId: connection.id });

    let nextLink: string | undefined;
    let nextSkip: string | undefined = syncState?.skip;
    let totalMessages = nextSkip ? parseInt(nextSkip) : 0;
    let pageCount = 0;

    // Get all message IDs first
    do {
      let endpoint = `/v1.0/me/messages?orderBy=receivedDateTime&top=${MAIL_PAGE_SIZE}`;
      if (nextSkip) {
        endpoint += `&skip=${nextSkip}`;
      }

      const response = (await this.request(connection, endpoint)) as Record<string, unknown>;
      const messages = (response.value as unknown[]) || [];
      nextLink = response['@odata.nextLink'] as string | undefined;

      totalMessages += messages.length;
      if (nextLink) {
        const regexExec = OUTLOOK_SKIP_REGEX.exec(nextLink);
        if (regexExec) {
          nextSkip = regexExec[1];
        }
      } else {
        nextSkip = totalMessages.toString();
      }

      pageCount++;

      this.logger.log('Outlook Mail full sync page completed', {
        connectionId: connection.id,
        pageMessageCount: messages.length,
        totalMessages,
        pageNumber: pageCount,
        hasNextPage: !!nextLink,
      });

      // Create a result for this page (but don't include syncState yet)
      results.push({
        data: { messages, skip: nextSkip, pageNumber: pageCount },
        syncState: {} as OutlookMailSyncState, // Will be updated after all pages
      });
    } while (nextLink);

    const newSyncState = {
      skip: nextSkip as string,
    };

    // Update all results with the final sync state
    results.forEach((result) => {
      result.syncState = newSyncState;
    });

    this.logger.log('Outlook Mail full sync completed', {
      connectionId: connection.id,
      totalMessageCount: totalMessages,
      totalPages: pageCount,
      skip: newSyncState.skip,
    });

    return results;
  }

  async syncCalendars(
    connection: Connection,
    syncState: OutlookCalendarsSyncState | null,
  ): Promise<Array<{ calendarId: string; data: unknown; syncState: OutlookCalendarSyncState }>> {
    let calendars: Array<Calendar> = [];
    const results: Array<{ calendarId: string; data: unknown; syncState: OutlookCalendarSyncState }> = [];

    // Full sync - get all events and establish skip
    this.logger.log('Performing full Outlook Calendar sync', { connectionId: connection.id });

    let nextCalendarsLink: string | undefined;
    let nextCalendarsSkip: string | null = null;
    let pageCount = 0;

    // Get all calendars first
    do {
      let endpoint = `/v1.0/me/calendars?top=${CALENDAR_PAGE_SIZE}`;
      if (nextCalendarsSkip) {
        endpoint += `&skip=${nextCalendarsSkip}`;
      }

      let response;
      try {
        response = (await this.request(connection, endpoint)) as Record<string, unknown>;
      } catch (e) {
        console.error('Error fetching calendars', e);
        throw e;
      }

      if (response.value) {
        calendars = calendars.concat(response.value as Calendar[]);
      }

      nextCalendarsLink = response['@odata.nextLink'] as string | undefined;

      if (nextCalendarsLink) {
        const regexExec = OUTLOOK_SKIP_REGEX.exec(nextCalendarsLink);
        if (regexExec) {
          nextCalendarsSkip = regexExec[1];
        }
      }

      pageCount++;

      this.logger.log('Outlook Calendars full sync page completed', {
        connectionId: connection.id,
        pageNumber: pageCount,
        hasNextPage: !!nextCalendarsLink,
      });
    } while (nextCalendarsLink);

    for (const calendar of calendars) {
      // Full sync - get all events and establish skip
      this.logger.log('Performing Outlook Calendar sync for', {
        connectionId: connection.id,
        calendarId: calendar.id,
      });

      const calendarSyncState = syncState?.[calendar.id] || null;
      let nextPageLink: string | undefined;
      let nextPageSkip: string | undefined = calendarSyncState?.skip;
      let totalEvents = nextPageSkip ? parseInt(nextPageSkip) : 0;
      let calPageCount = 0;

      // Get all calendars first
      do {
        let endpoint = `/v1.0/me/calendars/${calendar.id}/events?top=${CALENDAR_PAGE_SIZE}`;
        if (nextPageSkip) {
          endpoint += `&skip=${nextPageSkip}`;
        }

        let response;
        try {
          response = (await this.request(connection, endpoint)) as Record<string, unknown>;
        } catch (e) {
          console.error('Error fetching calendars', e);
          throw e;
        }

        const events = (response.value as unknown[]) || [];
        nextPageLink = response['@odata.nextLink'] as string | undefined;
        totalEvents += events.length;

        if (nextPageLink) {
          const regexExec = OUTLOOK_SKIP_REGEX.exec(nextPageLink);
          if (regexExec) {
            nextPageSkip = regexExec[1];
          }
        } else {
          nextPageSkip = totalEvents.toString();
        }

        calPageCount++;

        this.logger.log('Calendar events full sync page completed', {
          connectionId: connection.id,
          totalEvents,
          pageNumber: calPageCount,
          hasNextPage: !!nextPageLink,
        });

        // Create a result for this page (but don't include syncState yet)
        results.push({
          calendarId: calendar.id,
          data: { events, skip: nextPageSkip, pageNumber: calPageCount },
          syncState: { skip: nextPageSkip },
        });
      } while (nextPageLink);
    }

    return results;
  }

  async syncOneDrive(
    connection: Connection,
    syncState: OneDriveSyncState | null,
  ): Promise<Array<{ data: unknown; syncState: OneDriveSyncState }>> {
    const results: Array<{ data: unknown; syncState: OneDriveSyncState }> = [];

    // Full sync - get all messages and establish skip
    this.logger.log('Performing full OneDrive sync', { connectionId: connection.id });

    let nextLink: string | undefined = syncState?.nextLink;
    const newSyncState: OneDriveSyncState = {
      nextLink: syncState?.nextLink,
    };

    let pageCount = 0;

    // Get all message IDs first
    do {
      const nextLinkUrl = nextLink ? new URL(nextLink) : null;
      const endpoint = nextLinkUrl
        ? nextLinkUrl.pathname + nextLinkUrl.search + nextLinkUrl.hash
        : `/v1.0/drive/list/items?$filter=contentType%2fname+eq+%27Document%27&$orderby=lastModifiedDateTime&top=${ONEDRIVE_PAGE_SIZE}`;

      const response = (await this.request(connection, endpoint)) as Record<string, unknown>;
      const files = (response.value as OneDrivePageEntity[]) || [];
      nextLink = response['@odata.nextLink'] as string | undefined;

      const filteredFiles = [];
      for (const file of files) {
        const fileEtag = ONEDRIVE_ETAG_REGEX.exec(file.eTag);
        try {
          file.content = (await this.request(
            connection,
            `/v1.0/drive/items/${fileEtag![1]}`,
          )) as OneDriveFileEntity;
          filteredFiles.push(file);
        } catch (err) {
          console.log('Could not fetch file, skipping', err);
        }
      }

      if (nextLink) {
        newSyncState.nextLink = nextLink;
      }

      pageCount++;

      this.logger.log('OneDrive full sync page completed', {
        connectionId: connection.id,
        pageFilesCount: filteredFiles.length,
        pageNumber: pageCount,
        hasNextPage: !!nextLink,
      });

      // Create a result for this page (but don't include syncState yet)
      results.push({
        data: { files: filteredFiles, nextLink: newSyncState.nextLink, pageNumber: pageCount },
        syncState: {} as OneDriveSyncState, // Will be updated after all pages
      });
    } while (nextLink);

    // Update all results with the final sync state
    results.forEach((result) => {
      result.syncState = newSyncState;
    });

    this.logger.log('OneDrive full sync completed', {
      connectionId: connection.id,
      totalPages: pageCount,
      nextLink: newSyncState.nextLink,
    });

    return results;
  }
}
