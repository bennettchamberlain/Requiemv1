import { Injectable } from '@nestjs/common';

import { LoggerService } from '@ci/common/logging';
import type { BaseClient, Connection } from '@ci/domains/connections';

import { syncFriends } from '../services/Facebook/SyncFriends';
import { syncLikes } from '../services/Facebook/SyncLikes';
import { syncPhotos } from '../services/Facebook/SyncPhotos';
import { syncPosts } from '../services/Facebook/SyncPosts';
import { syncVideos } from '../services/Facebook/SyncVideos';
import { syncCalendar } from './Google/sync/SyncCalendar';
import { syncContacts } from './Google/sync/SyncContacts';
import { syncDrive } from './Google/sync/SyncDrive';
import { syncGmail } from './Google/sync/SyncGmail';

import { syncYouTubeActivities } from './Google/sync/SyncYouTubeActivities';
import { syncYouTubeLikes } from './Google/sync/SyncYouTubeLikes';
import { syncYouTubePlaylists } from './Google/sync/SyncYouTubePlaylists';
import { syncYouTubeSubscriptions } from './Google/sync/SyncYouTubeSubscriptions';
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
  Facebook: {
    Friends: syncFriends,
    Likes: syncLikes,
    Photos: syncPhotos,
    Posts: syncPosts,
    Videos: syncVideos,
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
