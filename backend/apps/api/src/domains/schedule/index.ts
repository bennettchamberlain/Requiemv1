import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { LoggingModule } from '@ci/common/logging';
import { MemoryModule } from '@ci/domains/memory';

import { EventCandidateEntity } from './entities/EventCandidateEntity';
import { RhythmEntity } from './entities/RhythmEntity';
import { CandidateService } from './services/CandidateService';

@Module({
  imports: [TypeOrmModule.forFeature([EventCandidateEntity, RhythmEntity]), MemoryModule, LoggingModule],
  providers: [CandidateService],
  exports: [CandidateService],
})
export class ScheduleModule {}

export { EventCandidateEntity, RhythmEntity };
export { CandidateService };
export type {
  EventCandidate,
  CandidateStatus,
  RationaleSource,
  TimeFlex,
} from './entities/EventCandidateEntity';
export type { Rhythm, RhythmKind, RhythmSource, RhythmStrength } from './entities/RhythmEntity';
export type { CreateCandidateDto, CreateRhythmDto, DeclineReason, UpdateRhythmDto } from './types';
