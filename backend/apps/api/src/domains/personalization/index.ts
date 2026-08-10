import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { EventsModule } from '@ci/domains/events';
import { GraphModule } from '@ci/domains/graph';
import { IntelligenceModule } from '@ci/domains/intelligence';
import { LlmCoreModule } from '@ci/domains/llm';
import { MemoryModule } from '@ci/domains/memory';

import { PersonalizationController } from './controllers/PersonalizationController';
import { PromotionCandidateEntity } from './entities/PromotionCandidateEntity';
import { FeedQueuePopulationListener } from './listeners/FeedQueuePopulationListener';
import { CrossTableHydrationService } from './services/CrossTableHydrationService';
import { LifeContextService } from './services/LifeContextService';
import { PersonalizationService } from './services/PersonalizationService';
import { PromotionCandidateService } from './services/PromotionCandidateService';
import { PromotionReviewPromptService } from './services/PromotionReviewPromptService';
import { PromotionReviewService } from './services/PromotionReviewService';

@Module({
  imports: [
    EventsModule,
    TypeOrmModule.forFeature([PromotionCandidateEntity]),
    MemoryModule,
    GraphModule,
    IntelligenceModule,
    LlmCoreModule,
  ],
  controllers: [PersonalizationController],
  providers: [
    PersonalizationService,
    PromotionCandidateService,
    PromotionReviewPromptService,
    CrossTableHydrationService,
    LifeContextService,
    PromotionReviewService,
    FeedQueuePopulationListener,
  ],
  exports: [
    PersonalizationService,
    PromotionCandidateService,
    PromotionReviewPromptService,
    CrossTableHydrationService,
    LifeContextService,
    PromotionReviewService,
  ],
})
export class PersonalizationModule {}

export {
  PersonalizationService,
  PromotionCandidateService,
  PromotionReviewPromptService,
  CrossTableHydrationService,
  LifeContextService,
  PromotionReviewService,
};
export type {
  PersonalizationProfile,
  TrustMode,
  PersonalizationDecision,
  PersonalizationActionKind,
  PromotionCandidateKind,
} from './types';
