import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { type UserServiceContext } from '@ci/common/context';
import { LoggerService } from '@ci/common/logging';
import {
  GraphIngestService,
  type GraphEntityInputDto,
  type GraphRelationshipInputDto,
} from '@ci/domains/graph';

import { PersonalizationService } from './PersonalizationService';
import { PromotionCandidateService } from './PromotionCandidateService';

export interface HydrationResult {
  readonly sampledRecords: number;
  readonly autoWritten: number;
  readonly reviewQueued: number;
  readonly skipped: number;
}

@Injectable()
export class CrossTableHydrationService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly graphIngestService: GraphIngestService,
    private readonly personalizationService: PersonalizationService,
    private readonly promotionCandidateService: PromotionCandidateService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(CrossTableHydrationService.name);
  }

  async hydrateAnswers(context: UserServiceContext, limit = 50): Promise<HydrationResult> {
    type Row = { answer_id: string; answer_text: string; question_text: string | null };
    const rows = (await this.dataSource.query(
      `
      SELECT a.answer_id, a.answer_text, q.question_text
      FROM ci.answers a
      LEFT JOIN ci.questions q ON q.question_id = a.question_id
      WHERE a.user_id = $1
        AND a.answer_text IS NOT NULL
        AND TRIM(a.answer_text) <> ''
      ORDER BY a.answered_at DESC
      LIMIT $2;
      `,
      [context.userId, limit],
    )) as Row[];

    return this.hydrateFromTexts(
      context,
      rows.map((r) => r.answer_text),
      'hydrate_answers',
    );
  }

  async hydrateInventory(context: UserServiceContext, limit = 50): Promise<HydrationResult> {
    type Row = { item_id: string; name: string | null; description: string | null };
    const rows = (await this.dataSource.query(
      `
      SELECT i.item_id, i.name, i.description
      FROM ci.items i
      WHERE i.user_id = $1
      ORDER BY i.created_at DESC
      LIMIT $2;
      `,
      [context.userId, limit],
    )) as Row[];

    const texts = rows.map((r) => [r.name, r.description].filter(Boolean).join(': ')).filter(Boolean);

    return this.hydrateFromTexts(context, texts, 'hydrate_inventory');
  }

  private async hydrateFromTexts(
    context: UserServiceContext,
    texts: string[],
    sourceJob: string,
  ): Promise<HydrationResult> {
    const result = {
      sampledRecords: texts.length,
      autoWritten: 0,
      reviewQueued: 0,
      skipped: 0,
    };

    if (texts.length === 0 || !context.userId) {
      return result;
    }

    for (const text of texts) {
      const entities: GraphEntityInputDto[] = [
        {
          key: `${sourceJob}:concept:${text.slice(0, 64).toLowerCase()}`,
          entityType: 'Concept',
          name: text.slice(0, 120),
          sourceSystem: sourceJob,
          properties: { type: 'activity', source: sourceJob },
        },
      ];

      const relationships: GraphRelationshipInputDto[] = [
        {
          fromKey: 'self',
          toKey: entities[0]!.key,
          type: 'INTERESTED_IN',
          properties: { strength: 0.6 },
        },
      ];

      const decision = await this.personalizationService.decideAction(context.userId, {
        kind: 'graph_edge',
        confidence: 0.75,
        hasUserInput: true,
      });

      if (decision === 'skip') {
        result.skipped += 1;
        continue;
      }

      if (decision === 'review') {
        await this.promotionCandidateService.create(context, {
          kind: 'entity',
          payload: { entities, relationships },
          confidence: 0.75,
          evidence: [{ text: text.slice(0, 500) }],
          sourceJob,
          reviewPrompt: `Companion found a possible interest: "${text.slice(0, 120)}"`,
        });
        result.reviewQueued += 1;
        continue;
      }

      await this.graphIngestService.ingest(context, { entities, relationships });
      result.autoWritten += 1;
    }

    this.logger.log('Cross-table hydration complete', { userId: context.userId, sourceJob, ...result });

    return result;
  }
}
