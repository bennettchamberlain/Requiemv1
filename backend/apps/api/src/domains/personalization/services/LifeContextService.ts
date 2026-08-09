import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { LoggerService } from '@ci/common/logging';
import { UserContextService } from '@ci/domains/memory';

import { PersonalizationService } from './PersonalizationService';
import { PromotionCandidateService } from './PromotionCandidateService';

export interface LifeOptimizationContext {
  readonly trustMode: string;
  readonly dossierBlock: string;
  readonly recentGraphDeltas: unknown[];
  readonly pendingPromotions: number;
  readonly insightVolumeMultiplier: number;
}

@Injectable()
export class LifeContextService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly userContextService: UserContextService,
    private readonly personalizationService: PersonalizationService,
    private readonly promotionCandidateService: PromotionCandidateService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(LifeContextService.name);
  }

  async buildForUser(userId: string): Promise<LifeOptimizationContext> {
    const profile = await this.personalizationService.getProfile(userId);
    const userCtx = await this.userContextService.getUserContextForLLM(userId);
    const dossierBlock = userCtx ? this.userContextService.formatContextForSystemPrompt(userCtx) : '';

    type DeltaRow = { delta: unknown };
    const deltaRows = (await this.dataSource.query(
      `
      SELECT delta
      FROM ci.graph_deltas
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT 20;
      `,
      [userId],
    )) as DeltaRow[];

    const pendingPromotions = await this.promotionCandidateService.countPending(userId);

    return {
      trustMode: profile.trustMode,
      dossierBlock,
      recentGraphDeltas: deltaRows.map((r) => r.delta),
      pendingPromotions,
      insightVolumeMultiplier: profile.insightVolumeMultiplier,
    };
  }

  async hasNoveltySinceLastRun(userId: string, workType: string): Promise<boolean> {
    type Row = { changed: boolean };
    const rows = (await this.dataSource.query(
      `
      WITH last_run AS (
        SELECT COALESCE(MAX(completed_on), '1970-01-01'::timestamptz) AS ts
        FROM pgboss.archive
        WHERE data->>'name' = 'smart.rotation.work'
          AND data->>'workType' = $2
          AND data->>'userId' = $1::text
      )
      SELECT EXISTS (
        SELECT 1 FROM ci.graph_deltas gd, last_run lr
        WHERE gd.user_id = $1::uuid AND gd.created_at > lr.ts
        UNION ALL
        SELECT 1 FROM ci.communications c, last_run lr
        WHERE c.user_id = $1::uuid AND c.created_at > lr.ts
        UNION ALL
        SELECT 1 FROM ci.events e, last_run lr
        WHERE e.user_id = $1::uuid AND e.created_at > lr.ts
      ) AS changed;
      `,
      [userId, workType],
    )) as Row[];

    return rows[0]?.changed ?? true;
  }
}
