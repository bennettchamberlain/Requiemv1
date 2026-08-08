import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { v7 as uuidv7 } from 'uuid';

import { type UserServiceContext } from '@ci/common/context';
import { LoggerService } from '@ci/common/logging';

import { PersonalizationService } from './PersonalizationService';
import { PromotionCandidateService } from './PromotionCandidateService';

@Injectable()
export class PromotionReviewService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly personalizationService: PersonalizationService,
    private readonly promotionCandidateService: PromotionCandidateService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(PromotionReviewService.name);
  }

  /** Surface pending promotion candidates as feed questions for cautious/balanced users. */
  async surfacePendingReviews(context: UserServiceContext, limit = 1): Promise<number> {
    const profile = await this.personalizationService.getProfile(context.userId!);
    if (profile.trustMode === 'hands_off') {
      return 0;
    }

    const pending = await this.promotionCandidateService.listPending(context, limit);
    let enqueued = 0;

    for (const candidate of pending) {
      const prompt =
        candidate.reviewPrompt ??
        `Review this suggestion from Companion (${candidate.kind}, confidence ${Math.round(candidate.confidence * 100)}%)`;

      await this.dataSource.query(
        `
        INSERT INTO ci.feed_queue (feed_queue_id, user_id, item_type, question_id, enqueued_at, metadata)
        SELECT $1, $2, 'promotion_review', NULL, NOW(), $3::jsonb
        WHERE NOT EXISTS (
          SELECT 1 FROM ci.feed_queue fq
          WHERE fq.user_id = $2
            AND fq.metadata->>'promotionCandidateId' = $4
        );
        `,
        [
          uuidv7(),
          context.userId,
          JSON.stringify({ promotionCandidateId: candidate.id, prompt }),
          candidate.id,
        ],
      );

      enqueued += 1;
    }

    this.logger.log('Promotion review cards surfaced', { userId: context.userId, enqueued });

    return enqueued;
  }
}
