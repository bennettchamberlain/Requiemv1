import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { v7 as uuidv7 } from 'uuid';

import type { UserServiceContext } from '@ci/common/context';
import { FeatureService } from '@ci/common/feature';
import { LoggerService } from '@ci/common/logging';
import { ActionService } from '@ci/domains/intelligence';

import { CorrelationEngine } from '../correlation/CorrelationEngine';
import { shiftIso, todayIsoInTimezone } from '../dateUtil';
import type { MetricAnomaly } from '../entities/MetricAnomalyEntity';
import { MetricSuggestionEntity, type MetricSuggestion } from '../entities/MetricSuggestionEntity';
import { SuggestionArmEntity } from '../entities/SuggestionArmEntity';
import { DailyMetricsService } from '../services/DailyMetricsService';
import { METRIC_SOURCES, type MetricKey } from '../types';

import {
  detectArmTriggers,
  SUGGESTION_BASELINE_DAYS,
  SUGGESTION_MIN_BASELINE_N,
  updateArm,
  type SuggestionArmKey,
} from './suggestionMath';

@Injectable()
export class SuggestionEngine {
  constructor(
    @InjectRepository(MetricSuggestionEntity)
    private readonly suggestions: Repository<MetricSuggestionEntity>,
    @InjectRepository(SuggestionArmEntity)
    private readonly arms: Repository<SuggestionArmEntity>,
    private readonly metricsService: DailyMetricsService,
    private readonly correlationEngine: CorrelationEngine,
    private readonly actionService: ActionService,
    private readonly featureService: FeatureService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(SuggestionEngine.name);
  }

  async propose(
    context: UserServiceContext,
    anomalies: MetricAnomaly[],
    timezone = 'UTC',
  ): Promise<MetricSuggestion[]> {
    const yesterday = shiftIso(todayIsoInTimezone(timezone), -1);
    const from = shiftIso(yesterday, -(SUGGESTION_BASELINE_DAYS - 1));
    const rows = await this.metricsService.getRange(context, from, yesterday);
    const todayRow = rows.find((row) => row.date === yesterday) ?? null;
    const window = rows.filter((row) => row.date !== yesterday);
    const triggers = detectArmTriggers(todayRow, window, SUGGESTION_MIN_BASELINE_N);

    const correlations = await this.correlationEngine.list(context, { robustOnly: true });
    const persisted: MetricSuggestion[] = [];

    for (const trigger of triggers) {
      const anomaly = anomalies.find(
        (row) => row.date === yesterday && row.metric === trigger.metric,
      );
      const correlation = correlations.find(
        (row) => row.metricA === trigger.metric || row.metricB === trigger.metric,
      );

      if (!anomaly && !correlation) {
        continue;
      }

      const evidence = {
        metric: trigger.metric,
        windowDays: SUGGESTION_BASELINE_DAYS,
        baseline: trigger.baseline,
        current: trigger.current,
        gap: trigger.gap,
        sources: [...(METRIC_SOURCES[trigger.metric as MetricKey] ?? [])],
      };

      const row = await this.upsertLive(context.userId, {
        key: trigger.key,
        title: trigger.title,
        text: withAssociation(trigger.text, correlation?.metricA, correlation?.metricB, trigger.metric),
        priority: trigger.priority,
        correlationId: correlation?.id ?? null,
        anomalyId: anomaly?.id ?? null,
        evidence,
      });

      persisted.push(row);
    }

    const promote = await this.featureService.isFeatureEnabled('derivation.engines');
    if (promote) {
      await this.promote(context, persisted);
    }

    this.logger.log('Suggestion propose complete', {
      userId: context.userId,
      rows: persisted.length,
      promoted: promote,
    });

    return persisted;
  }

  async list(context: UserServiceContext, includeDismissed = false): Promise<MetricSuggestion[]> {
    const qb = this.suggestions
      .createQueryBuilder('row')
      .where('row.user_id = :userId', { userId: context.userId })
      .orderBy('row.computed_at', 'DESC');

    if (!includeDismissed) {
      qb.andWhere('row.dismissed_at IS NULL').andWhere('row.accepted_at IS NULL');
    }

    const rows = await qb.getMany();

    return rows.map((entity) => MetricSuggestionEntity.toEgressType(entity));
  }

  async feedback(
    context: UserServiceContext,
    id: string,
    accepted: boolean,
  ): Promise<MetricSuggestion | null> {
    const entity = await this.suggestions.findOne({ where: { id, userId: context.userId } });
    if (!entity) {
      return null;
    }

    const now = new Date();
    if (accepted) {
      entity.acceptedAt = now;
    } else {
      entity.dismissedAt = now;
    }

    const saved = await this.suggestions.save(entity);

    if (entity.actionId) {
      if (accepted) {
        await this.actionService.markAsSeen(context, entity.actionId);
      } else {
        await this.actionService.markAsDismissed(context, entity.actionId);
      }
    }

    await this.bumpArm(context.userId, entity.key as SuggestionArmKey, accepted);

    if (!accepted && entity.correlationId) {
      const metric = entity.evidence?.metric;
      if (metric) {
        await this.correlationEngine.decayNoveltyForMetric(context.userId, metric);
      }
    }

    return MetricSuggestionEntity.toEgressType(saved);
  }

  private async promote(context: UserServiceContext, rows: MetricSuggestion[]): Promise<void> {
    if (rows.some((row) => row.actionId)) {
      return;
    }

    const chosen = [...rows].sort((left, right) => (left.priority ?? 5) - (right.priority ?? 5))[0];
    if (!chosen) {
      return;
    }

    const action = await this.actionService.create(context, {
      title: chosen.title,
      text: chosen.text,
      priority: chosen.priority ?? 3,
      source: 'suggestion',
      metadata: { suggestionId: chosen.id, key: chosen.key, evidence: chosen.evidence },
    });

    await this.suggestions.update({ id: chosen.id }, { actionId: action.id });
    chosen.actionId = action.id;
  }

  private async upsertLive(
    userId: string,
    fields: {
      key: string;
      title: string;
      text: string;
      priority: number;
      correlationId: string | null;
      anomalyId: string | null;
      evidence: MetricSuggestion['evidence'];
    },
  ): Promise<MetricSuggestion> {
    const existing = await this.suggestions.findOne({
      where: { userId, key: fields.key, acceptedAt: IsNull(), dismissedAt: IsNull() },
    });

    const entity = existing ?? this.suggestions.create({ id: uuidv7(), userId });
    entity.key = fields.key;
    entity.title = fields.title;
    entity.text = fields.text;
    entity.priority = fields.priority;
    entity.correlationId = fields.correlationId;
    entity.anomalyId = fields.anomalyId;
    entity.evidence = fields.evidence;
    entity.computedAt = new Date();

    const saved = await this.suggestions.save(entity);

    return MetricSuggestionEntity.toEgressType(saved);
  }

  private async bumpArm(userId: string, key: SuggestionArmKey, accepted: boolean): Promise<void> {
    const existing = await this.arms.findOne({ where: { userId, key } });
    const next = updateArm(existing?.alpha ?? 1, existing?.beta ?? 1, accepted);
    if (existing) {
      existing.alpha = next.alpha;
      existing.beta = next.beta;
      existing.updatedAt = new Date();
      await this.arms.save(existing);

      return;
    }

    await this.arms.save(
      this.arms.create({
        userId,
        key,
        alpha: next.alpha,
        beta: next.beta,
        updatedAt: new Date(),
      }),
    );
  }
}

function withAssociation(
  text: string,
  metricA: string | undefined,
  metricB: string | undefined,
  self: string,
): string {
  const other = metricA === self ? metricB : metricA;
  if (!other) {
    return text;
  }

  return `${text} Associated with ${other.replaceAll('_', ' ')}.`;
}
