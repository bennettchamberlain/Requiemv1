import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v7 as uuidv7 } from 'uuid';

import type { UserServiceContext } from '@ci/common/context';
import { LoggerService } from '@ci/common/logging';

import { shiftIso, todayIsoInTimezone } from '../dateUtil';
import { MetricCorrelationEntity, type MetricCorrelation } from '../entities/MetricCorrelationEntity';
import { DailyMetricsService } from '../services/DailyMetricsService';
import type { MetricKey } from '../types';

import {
  decayNovelty,
  scanWindow,
  WINDOWS,
  type WindowDays,
} from './correlationMath';

const HISTORY_DAYS = 180;

@Injectable()
export class CorrelationEngine {
  constructor(
    @InjectRepository(MetricCorrelationEntity)
    private readonly repository: Repository<MetricCorrelationEntity>,
    private readonly metricsService: DailyMetricsService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(CorrelationEngine.name);
  }

  async scan(context: UserServiceContext, timezone = 'UTC'): Promise<MetricCorrelation[]> {
    const yesterday = shiftIso(todayIsoInTimezone(timezone), -1);
    const from = shiftIso(yesterday, -(HISTORY_DAYS - 1));
    const rows = await this.metricsService.getRange(context, from, yesterday);

    const byKey = new Map<string, ReturnType<typeof scanWindow>[number][]>();
    for (const windowDays of WINDOWS) {
      const windowFrom = shiftIso(yesterday, -(windowDays - 1));
      const windowRows = rows.filter((row) => row.date >= windowFrom);
      const tests = scanWindow(windowRows, windowDays);
      for (const test of tests) {
        const key = `${test.metricA}|${test.metricB}|${test.lagDays}`;
        const list = byKey.get(key) ?? [];
        list.push(test);
        byKey.set(key, list);
      }
    }

    const robustKeys = new Set<string>();
    for (const [key, tests] of byKey) {
      const survivors = tests.filter((test) => test.survives);
      if (survivors.length < 2) {
        continue;
      }

      const sign = Math.sign(survivors[0].association.effect);
      if (survivors.every((test) => Math.sign(test.association.effect) === sign)) {
        robustKeys.add(key);
      }
    }

    const persisted: MetricCorrelation[] = [];
    const now = new Date();

    for (const windowDays of WINDOWS) {
      const windowFrom = shiftIso(yesterday, -(windowDays - 1));
      const windowRows = rows.filter((row) => row.date >= windowFrom);
      for (const test of scanWindow(windowRows, windowDays)) {
        const key = `${test.metricA}|${test.metricB}|${test.lagDays}`;
        const row = await this.upsert(context.userId, {
          metricA: test.metricA,
          metricB: test.metricB,
          lagDays: test.lagDays,
          windowDays: test.windowDays,
          n: test.association.n,
          pearson: test.association.pearson,
          spearman: test.association.spearman,
          mutualInfo: test.association.mutualInfo,
          pValue: test.association.pValue,
          qValue: test.qValue,
          effect: test.association.effect,
          robust: robustKeys.has(key),
          coverageMean: test.association.coverageMean,
          computedAt: now,
        });
        persisted.push(row);
      }
    }

    this.logger.log('Correlation scan complete', {
      userId: context.userId,
      rows: persisted.length,
      robust: persisted.filter((row) => row.robust).length,
    });

    return persisted;
  }

  async list(
    context: UserServiceContext,
    options: { windowDays?: number; robustOnly?: boolean } = {},
  ): Promise<MetricCorrelation[]> {
    const qb = this.repository
      .createQueryBuilder('row')
      .where('row.user_id = :userId', { userId: context.userId })
      .orderBy('row.q_value', 'ASC')
      .addOrderBy('row.computed_at', 'DESC');

    if (options.windowDays !== undefined) {
      qb.andWhere('row.window_days = :windowDays', { windowDays: options.windowDays });
    }

    if (options.robustOnly) {
      qb.andWhere('row.robust = true');
    }

    const rows = await qb.getMany();

    return rows.map((entity) => MetricCorrelationEntity.toEgressType(entity));
  }

  async findPair(
    context: UserServiceContext,
    metricA: MetricKey,
    metricB: MetricKey,
    lagDays: number,
    windowDays: WindowDays,
  ): Promise<MetricCorrelation | null> {
    const entity = await this.repository.findOne({
      where: { userId: context.userId, metricA, metricB, lagDays, windowDays },
    });

    return entity ? MetricCorrelationEntity.toEgressType(entity) : null;
  }

  /**
   * Reserved for event-study / interrupted time series. v1 does not persist
   * ITS results — discrete life events need a cleaner taxonomy first.
   */
  async scanAround(
    context: UserServiceContext,
    event: { date: string; kind: string },
  ): Promise<MetricCorrelation[]> {
    void context;
    void event;

    return [];
  }

  async decayNoveltyForMetric(userId: string, metric: string): Promise<void> {
    const rows = await this.repository.find({ where: { userId } });
    for (const row of rows) {
      if (row.metricA !== metric && row.metricB !== metric) {
        continue;
      }

      row.novelty = decayNovelty(row.novelty);
      await this.repository.save(row);
    }
  }

  private async upsert(
    userId: string,
    fields: Omit<MetricCorrelation, 'id' | 'userId' | 'novelty'>,
  ): Promise<MetricCorrelation> {
    const existing = await this.repository.findOne({
      where: {
        userId,
        metricA: fields.metricA,
        metricB: fields.metricB,
        lagDays: fields.lagDays,
        windowDays: fields.windowDays,
      },
    });

    const entity = existing ?? this.repository.create({ id: uuidv7(), userId, novelty: 1 });
    entity.metricA = fields.metricA;
    entity.metricB = fields.metricB;
    entity.lagDays = fields.lagDays;
    entity.windowDays = fields.windowDays;
    entity.n = fields.n;
    entity.pearson = fields.pearson;
    entity.spearman = fields.spearman;
    entity.mutualInfo = fields.mutualInfo;
    entity.pValue = fields.pValue;
    entity.qValue = fields.qValue;
    entity.effect = fields.effect;
    entity.robust = fields.robust;
    entity.coverageMean = fields.coverageMean;
    entity.computedAt = fields.computedAt;

    const saved = await this.repository.save(entity);

    return MetricCorrelationEntity.toEgressType(saved);
  }
}
