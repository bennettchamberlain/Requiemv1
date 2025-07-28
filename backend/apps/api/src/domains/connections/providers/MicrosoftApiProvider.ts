import { BaseApiProvider } from './BaseApiProvider';
import type { Connection } from '../types';
import type { SyncResult, SyncResponse } from './types';

export class MicrosoftApiProvider extends BaseApiProvider {
  constructor() {
    super('Microsoft');
  }

  async sync(connection: Connection): Promise<SyncResponse> {
    this.logger.log('Syncing Microsoft data', { connectionId: connection.id });

    const syncResults: SyncResult[] = [];
    const errors: string[] = [];

    // Microsoft Graph - User Profile
    try {
      const userData = await this.makeApiRequest(connection, '/v1.0/me');
      syncResults.push({ api: 'Microsoft Graph - User', data: userData });
      this.logger.debug('Microsoft User data synced', { connectionId: connection.id });
    } catch (error) {
      const errorMsg = `Microsoft User API failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
      errors.push(errorMsg);
      this.logger.error(errorMsg, { connectionId: connection.id, error });
    }

    // Microsoft Graph - Calendar
    try {
      const calendarData = await this.makeApiRequest(connection, '/v1.0/me/calendar/events?$top=10');
      syncResults.push({ api: 'Microsoft Graph - Calendar', data: calendarData });
      this.logger.debug('Microsoft Calendar data synced', { connectionId: connection.id });
    } catch (error) {
      const errorMsg = `Microsoft Calendar API failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
      errors.push(errorMsg);
      this.logger.error(errorMsg, { connectionId: connection.id, error });
    }

    // Microsoft Graph - Mail
    try {
      const mailData = await this.makeApiRequest(connection, '/v1.0/me/messages?$top=10');
      syncResults.push({ api: 'Microsoft Graph - Mail', data: mailData });
      this.logger.debug('Microsoft Mail data synced', { connectionId: connection.id });
    } catch (error) {
      const errorMsg = `Microsoft Mail API failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
      errors.push(errorMsg);
      this.logger.error(errorMsg, { connectionId: connection.id, error });
    }

    // Microsoft Graph - OneDrive
    try {
      const onedriveData = await this.makeApiRequest(connection, '/v1.0/me/drive/root/children?$top=10');
      syncResults.push({ api: 'Microsoft Graph - OneDrive', data: onedriveData });
      this.logger.debug('Microsoft OneDrive data synced', { connectionId: connection.id });
    } catch (error) {
      const errorMsg = `Microsoft OneDrive API failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
      errors.push(errorMsg);
      this.logger.error(errorMsg, { connectionId: connection.id, error });
    }

    return this.createSyncResponse(syncResults, errors);
  }
}
