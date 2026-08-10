import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ConversationModule } from '@ci/domains/conversations';
import { EntityResolutionModule } from '@ci/domains/entity-resolution';
import { FilesModule } from '@ci/domains/files';
import { IntelligenceModule } from '@ci/domains/intelligence';
import { MemoryModule } from '@ci/domains/memory';
import { NotesModule } from '@ci/domains/notes';
import { SearchNextModule } from '@ci/domains/search-next';
import { UserModule } from '@ci/domains/user';

import { ActivityRollupCron } from './cron/ActivityRollupCron';
import { ActivityRollupEntity } from './entities/ActivityRollupEntity';
import { ActivityRollupService } from './services/ActivityRollupService';
import { ActivityTimelineService } from './services/ActivityTimelineService';

@Module({
  imports: [
    TypeOrmModule.forFeature([ActivityRollupEntity]),
    ConversationModule,
    EntityResolutionModule,
    FilesModule,
    IntelligenceModule,
    MemoryModule,
    NotesModule,
    SearchNextModule,
    UserModule,
  ],
  providers: [ActivityRollupService, ActivityTimelineService, ActivityRollupCron],
  exports: [ActivityRollupService, ActivityTimelineService],
})
export class ActivityModule {}

// Entities
export { ActivityRollupEntity };

// Services
export { ActivityRollupService, ActivityTimelineService };
export type {
  ActivityBucketRow,
  ActivityDailyCount,
  ActivityDailyCountsParams,
} from './services/ActivityRollupService';
export type { ActivityTimelineFilters } from './services/activityTimelineTypes';
