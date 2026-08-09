/**
 * Central personalization profile — trust_mode and promotion review pipeline.
 *
 * @module PersonalizationModule
 */

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { EventsModule } from '@ci/domains/events';
import { GraphModule } from '@ci/domains/graph';
import { IntelligenceModule } from '@ci/domains/intelligence';
import { MemoryModule } from '@ci/domains/memory';

import { PersonalizationController } from './controllers/PersonalizationController';
import { PromotionCandidateEntity } from './entities/PromotionCandidateEntity';
import { FeedQueuePopulationListener } from './listeners/FeedQueuePopulationListener';
import { CrossTableHydrationService } from './services/CrossTableHydrationService';
import { LifeContextService } from './services/LifeContextService';
import { PersonalizationService } from './services/PersonalizationService';
import { PromotionCandidateService } from './services/PromotionCandidateService';
import { PromotionReviewService } from './services/PromotionReviewService';

@Module({
  imports: [
    EventsModule,
    TypeOrmModule.forFeature([PromotionCandidateEntity]),
    MemoryModule,
    GraphModule,
    IntelligenceModule,
  ],
  controllers: [PersonalizationController],
  providers: [
    PersonalizationService,
    PromotionCandidateService,
    CrossTableHydrationService,
    LifeContextService,
    PromotionReviewService,
    FeedQueuePopulationListener,
  ],
  exports: [
    PersonalizationService,
    PromotionCandidateService,
    CrossTableHydrationService,
    LifeContextService,
    PromotionReviewService,
  ],
})
export class PersonalizationModule {}

export {
  PersonalizationService,
  PromotionCandidateService,
  CrossTableHydrationService,
  LifeContextService,
  PromotionReviewService,
};
export type {
  PersonalizationProfile,
  TrustMode,
  PersonalizationDecision,
  PersonalizationActionKind,
} from './types';
