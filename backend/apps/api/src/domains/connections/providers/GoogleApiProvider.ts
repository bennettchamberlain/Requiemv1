import { BaseApiProvider } from './BaseApiProvider';
import type { Connection } from '../types';
import type { SyncResult, SyncResponse } from './types';

export class GoogleApiProvider extends BaseApiProvider {
  constructor() {
    super('Google');
  }

  async sync(connection: Connection): Promise<SyncResponse> {
    this.logger.log('Syncing Google data', { connectionId: connection.id });

    const syncResults: SyncResult[] = [];
    const errors: string[] = [];

    // Google Calendar API
    try {
      const calendarData = await this.makeApiRequest(
        connection,
        '/calendar/v3/calendars/primary/events?maxResults=10&timeMin=' + new Date().toISOString(),
      );
      syncResults.push({ api: 'Google Calendar', data: calendarData });
      this.logger.debug('Google Calendar data synced', { connectionId: connection.id });
    } catch (error) {
      const errorMsg = `Google Calendar API failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
      errors.push(errorMsg);
      this.logger.error(errorMsg, { connectionId: connection.id, error });
    }

    // Gmail API
    try {
      const gmailData = await this.makeApiRequest(
        connection,
        '/gmail/v1/users/me/messages?maxResults=10',
      );
      syncResults.push({ api: 'Gmail', data: gmailData });
      this.logger.debug('Gmail data synced', { connectionId: connection.id });
    } catch (error) {
      const errorMsg = `Gmail API failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
      errors.push(errorMsg);
      this.logger.error(errorMsg, { connectionId: connection.id, error });
    }

    // Google Drive API
    try {
      const driveData = await this.makeApiRequest(
        connection,
        '/drive/v3/files?pageSize=10',
      );
      syncResults.push({ api: 'Google Drive', data: driveData });
      this.logger.debug('Google Drive data synced', { connectionId: connection.id });
    } catch (error) {
      const errorMsg = `Google Drive API failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
      errors.push(errorMsg);
      this.logger.error(errorMsg, { connectionId: connection.id, error });
    }

    return this.createSyncResponse(syncResults, errors);
  }
}
