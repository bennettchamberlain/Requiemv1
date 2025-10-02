import type { Connection } from '../types';

import { BaseOAuth2Client } from './BaseOAuth2Client';
import type { SyncResult, SyncResponse } from './types';

export class MicrosoftClient extends BaseOAuth2Client {
  protected readonly baseUrl = 'https://graph.microsoft.com';

  protected readonly authorizationEndpoint = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize';

  protected readonly tokenEndpoint = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';

  protected readonly scopes = ['https://graph.microsoft.com/User.Read'];

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

  async sync(connection: Connection): Promise<SyncResponse> {
    this.logger.log('Syncing Microsoft data', { connectionId: connection.id });

    const syncResults: SyncResult[] = [];
    const errors: string[] = [];

    // Microsoft Graph - User Profile
    try {
      const userData = await this.request(connection, '/v1.0/me');

      syncResults.push({ api: 'Microsoft Graph - User', data: userData });
    } catch (error) {
      const errorMsg = `Microsoft User API failed: ${error instanceof Error ? error.message : 'Unknown error'}`;

      errors.push(errorMsg);
    }

    // Microsoft Graph - Calendar
    try {
      const calendarData = await this.request(connection, '/v1.0/me/calendar/events?$top=10');

      syncResults.push({ api: 'Microsoft Graph - Calendar', data: calendarData });
    } catch (error) {
      const errorMsg = `Microsoft Calendar API failed: ${error instanceof Error ? error.message : 'Unknown error'}`;

      errors.push(errorMsg);
    }

    // Microsoft Graph - Mail
    try {
      const mailData = await this.request(connection, '/v1.0/me/messages?$top=10');

      syncResults.push({ api: 'Microsoft Graph - Mail', data: mailData });
    } catch (error) {
      const errorMsg = `Microsoft Mail API failed: ${error instanceof Error ? error.message : 'Unknown error'}`;

      errors.push(errorMsg);
    }

    // Microsoft Graph - OneDrive
    try {
      const onedriveData = await this.request(connection, '/v1.0/me/drive/root/children?$top=10');

      syncResults.push({ api: 'Microsoft Graph - OneDrive', data: onedriveData });
    } catch (error) {
      const errorMsg = `Microsoft OneDrive API failed: ${error instanceof Error ? error.message : 'Unknown error'}`;

      errors.push(errorMsg);
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
}
