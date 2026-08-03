import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { LoggingModule } from '@ci/common/logging';
import { ActionEntity } from '@ci/domains/intelligence';
import { MemoryModule } from '@ci/domains/memory';
import { SummaryEntity } from '@ci/domains/summaries';

import { EventCandidateEntity } from './entities/EventCandidateEntity';
import { RhythmEntity } from './entities/RhythmEntity';
import { CandidateService } from './services/CandidateService';
import { SuggestionSyncService } from './services/SuggestionSyncService';

@Module({
  imports: [
    // ActionEntity/SummaryEntity are registered for read-only projection into
    // candidates; the schedule domain deliberately depends on their tables, not
    // on IntelligenceModule/SummariesModule, to keep the coupling one-way.
    TypeOrmModule.forFeature([EventCandidateEntity, RhythmEntity, ActionEntity, SummaryEntity]),
    MemoryModule,
    LoggingModule,
  ],
  providers: [CandidateService, SuggestionSyncService],
  exports: [CandidateService, SuggestionSyncService],
})
export class ScheduleModule {}

export { EventCandidateEntity, RhythmEntity };
export { CandidateService, SuggestionSyncService };
export type {
  EventCandidate,
  CandidateStatus,
  RationaleSource,
  TimeFlex,
} from './entities/EventCandidateEntity';
export type { Rhythm, RhythmKind, RhythmSource, RhythmStrength } from './entities/RhythmEntity';
export type { CreateCandidateDto, CreateRhythmDto, DeclineReason, UpdateRhythmDto } from './types';
