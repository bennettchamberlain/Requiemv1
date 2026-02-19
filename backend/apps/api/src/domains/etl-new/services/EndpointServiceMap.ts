import { Injectable } from '@nestjs/common';

import { LoggerService } from '@ci/common/logging';
import type { BaseClient, Connection } from '@ci/domains/connections';

import { syncCalendar } from '../services/Google/SyncCalendar';
import { syncContacts } from '../services/Google/SyncContacts';
import { syncDrive } from '../services/Google/SyncDrive';
import { syncGmail } from '../services/Google/SyncGmail';

import { syncYouTubeActivities } from './Google/SyncYouTubeActivities';
import { syncYouTubeLikes } from './Google/SyncYouTubeLikes';
import { syncYouTubePlaylists } from './Google/SyncYouTubePlaylists';
import { syncYouTubeSubscriptions } from './Google/SyncYouTubeSubscriptions';
import { syncOneDrive } from './Microsoft/SyncOneDrive';
import { syncOutlookCalendar } from './Microsoft/SyncOutlookCalendar';
import { syncOutlookMail } from './Microsoft/SyncOutlookMail';

const ENDPOINT_SERVICE_MAP: {
  [providerName: string]: {
    [endpointName: string]: ({
      connection,
      client,
      nextCursor,
      historical,
    }: {
      connection: Connection;
      client: BaseClient;
      nextCursor: Record<string, unknown>;
      historical: boolean;
    }) => Promise<{ data: Record<string, unknown>; nextCursor?: Record<string, unknown> }>;
  };
} = {
  Google: {
    Gmail: syncGmail,
    Calendar: syncCalendar,
    Drive: syncDrive,
    Contacts: syncContacts,
    'YouTube Activities': syncYouTubeActivities,
    'YouTube Likes': syncYouTubeLikes,
    'YouTube Playlists': syncYouTubePlaylists,
    'YouTube Subscriptions': syncYouTubeSubscriptions,
  },
  Microsoft: {
    OneDrive: syncOneDrive,
    'Outlook Mail': syncOutlookMail,
    Calendar: syncOutlookCalendar,
  },
};

@Injectable()
export class EndpointServiceMap {
  constructor(private readonly logger: LoggerService) {
    this.logger.setContext(EndpointServiceMap.name);
  }

  getSyncFunction(providerName: string, endpointName: string) {
    return ENDPOINT_SERVICE_MAP[providerName]?.[endpointName];
  }
}
