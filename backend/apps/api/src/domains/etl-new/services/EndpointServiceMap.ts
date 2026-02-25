import { Injectable } from '@nestjs/common';

import { LoggerService } from '@ci/common/logging';

import { EndpointServiceMapInterface } from '../types';

import { syncFriends } from './Facebook/SyncFriends';
import { syncLikes } from './Facebook/SyncLikes';
import { syncPhotos } from './Facebook/SyncPhotos';
import { syncPosts } from './Facebook/SyncPosts';
import { syncVideos } from './Facebook/SyncVideos';
import { syncCalendar } from './Google/sync/SyncCalendar';
import { syncContacts } from './Google/sync/SyncContacts';
import { syncDrive } from './Google/sync/SyncDrive';
import { syncGmail } from './Google/sync/SyncGmail';
import { syncYouTubeActivities } from './Google/sync/SyncYouTubeActivities';
import { syncYouTubeLikes } from './Google/sync/SyncYouTubeLikes';
import { syncYouTubePlaylists } from './Google/sync/SyncYouTubePlaylists';
import { syncYouTubeSubscriptions } from './Google/sync/SyncYouTubeSubscriptions';
import { GmailTransformService } from './Google/transform/TransformGmail';
import { GoogleCalendarTransformService } from './Google/transform/TransformGoogleCalendar';
import { GoogleContactsTransformService } from './Google/transform/TransformGoogleContacts';
import { GoogleDriveTransformService } from './Google/transform/TransformGoogleDrive';
import { YouTubeActivitiesTransformService } from './Google/transform/TransformYouTubeActivities';
import { YouTubeLikesTransformService } from './Google/transform/TransformYouTubeLikes';
import { YouTubePlaylistsTransformService } from './Google/transform/TransformYouTubePlaylists';
import { YouTubeSubscriptionsTransformService } from './Google/transform/TransformYouTubeSubscriptions';
import { syncOneDrive } from './Microsoft/sync/SyncOneDrive';
import { syncOutlookCalendar } from './Microsoft/sync/SyncOutlookCalendar';
import { syncOutlookMail } from './Microsoft/sync/SyncOutlookMail';
import { OneDriveTransformService } from './Microsoft/transform/TransformOneDrive';
import { OutlookCalendarTransformService } from './Microsoft/transform/TransformOutlookCalendar';
import { OutlookMailTransformService } from './Microsoft/transform/TransformOutlookMail';

@Injectable()
export class EndpointServiceMap {
  private endpointServiceMap: EndpointServiceMapInterface;

  constructor(
    private readonly logger: LoggerService,
    private readonly gmailTransformService: GmailTransformService,
    private readonly googleCalendarTransformService: GoogleCalendarTransformService,
    private readonly googleContactsTransformService: GoogleContactsTransformService,
    private readonly googleDriveTransformService: GoogleDriveTransformService,
    private readonly youTubeActivitiesTransformService: YouTubeActivitiesTransformService,
    private readonly youTubeLikesTransformService: YouTubeLikesTransformService,
    private readonly youTubePlaylistsTransformService: YouTubePlaylistsTransformService,
    private readonly youTubeSubscriptionsTransformService: YouTubeSubscriptionsTransformService,
    private readonly oneDriveTransformService: OneDriveTransformService,
    private readonly outlookCalendarTransformService: OutlookCalendarTransformService,
    private readonly outlookMailTransformService: OutlookMailTransformService,
  ) {
    this.logger.setContext(EndpointServiceMap.name);
    this.endpointServiceMap = {
      sync: {
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
      },
      transform: {
        Google: {
          Gmail: this.gmailTransformService.transformGmail.bind(this.gmailTransformService),
          Calendar: this.googleCalendarTransformService.transformGoogleCalendar.bind(
            this.googleCalendarTransformService,
          ),
          Contacts: this.googleContactsTransformService.transformGoogleContacts.bind(
            this.googleContactsTransformService,
          ),
          Drive: this.googleDriveTransformService.transformGoogleDrive.bind(this.googleDriveTransformService),
          'YouTube Activities': this.youTubeActivitiesTransformService.transformYouTubeActivities.bind(
            this.youTubeActivitiesTransformService,
          ),
          'YouTube Likes': this.youTubeLikesTransformService.transformYouTubeLikes.bind(
            this.youTubeLikesTransformService,
          ),
          'YouTube Playlists': this.youTubePlaylistsTransformService.transformYouTubePlaylists.bind(
            this.youTubePlaylistsTransformService,
          ),
          'YouTube Subscriptions':
            this.youTubeSubscriptionsTransformService.transformYouTubeSubscriptions.bind(
              this.youTubeSubscriptionsTransformService,
            ),
        },
        Microsoft: {
          OneDrive: this.oneDriveTransformService.transformOneDrive.bind(this.oneDriveTransformService),
          'Outlook Mail': this.outlookMailTransformService.transformOutlookMail.bind(
            this.outlookMailTransformService,
          ),
          Calendar: this.outlookCalendarTransformService.transformOutlookCalendar.bind(
            this.outlookCalendarTransformService,
          ),
        },
      },
    };
  }

  getSyncFunction(providerName: string, endpointName: string) {
    return this.endpointServiceMap.sync[providerName]?.[endpointName];
  }

  getTransformFunction(providerName: string, endpointName: string) {
    return this.endpointServiceMap.transform[providerName]?.[endpointName];
  }
}
