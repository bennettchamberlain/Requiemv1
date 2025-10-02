import type { Connection } from '../types';

import { BaseOAuth2Client } from './BaseOAuth2Client';
import type { SyncResponse } from './types';

export class MicrosoftClient extends BaseOAuth2Client {
  async sync(connection: Connection): Promise<SyncResponse[]> {
    this.logger.log('Syncing Microsoft data', { connectionId: connection.id });

    const responses: SyncResponse[] = [];

    // Microsoft Graph - User Profile
    try {
      const userData = await this.request(connection, '/v1.0/me');

      responses.push({
        success: true,
        message: 'Microsoft Graph - User sync completed successfully',
        data: {
          results: [{ api: 'Microsoft Graph - User', data: userData }],
          errors: [],
        },
      });
    } catch (error) {
      const errorMsg = `Microsoft User API failed: ${error instanceof Error ? error.message : 'Unknown error'}`;

      responses.push({
        success: false,
        message: errorMsg,
        data: {
          results: [],
          errors: [errorMsg],
        },
      });
    }

    // Microsoft Graph - Calendar
    try {
      const calendarData = await this.request(connection, '/v1.0/me/calendar/events?$top=10');

      responses.push({
        success: true,
        message: 'Microsoft Graph - Calendar sync completed successfully',
        data: {
          results: [{ api: 'Microsoft Graph - Calendar', data: calendarData }],
          errors: [],
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

    // Microsoft Graph - Mail
    try {
      const mailData = await this.request(connection, '/v1.0/me/messages?$top=10');

      responses.push({
        success: true,
        message: 'Microsoft Graph - Mail sync completed successfully',
        data: {
          results: [{ api: 'Microsoft Graph - Mail', data: mailData }],
          errors: [],
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

    // Microsoft Graph - OneDrive
    try {
      const onedriveData = await this.request(connection, '/v1.0/me/drive/root/children?$top=10');

      responses.push({
        success: true,
        message: 'Microsoft Graph - OneDrive sync completed successfully',
        data: {
          results: [{ api: 'Microsoft Graph - OneDrive', data: onedriveData }],
          errors: [],
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

    return responses;
  }
}
