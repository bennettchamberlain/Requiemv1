import { Injectable } from '@nestjs/common';

import { type UserServiceContext } from '@ci/common/context';
import { LoggerService } from '@ci/common/logging';

import { PersonalizationService } from './PersonalizationService';
import { PromotionCandidateService } from './PromotionCandidateService';

@Injectable()
export class PromotionReviewService {
  constructor(
    private readonly personalizationService: PersonalizationService,
    private readonly promotionCandidateService: PromotionCandidateService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(PromotionReviewService.name);
  }

  /**
   * Prepare pending promotion reviews for the feed card: reject stale hydration rows
   * and refresh legacy prompts. The UI reads `/personalization/promotion-candidates`
   * directly — not feed_queue.
   */
  async surfacePendingReviews(context: UserServiceContext, limit = 1): Promise<number> {
    const profile = await this.personalizationService.getProfile(context.userId!);
    if (profile.trustMode === 'hands_off') {
      return 0;
    }

    const pending = await this.promotionCandidateService.listPending(context, limit);

    this.logger.log('Promotion review cards prepared', { userId: context.userId, pending: pending.length });

    return pending.length;
  }
}
