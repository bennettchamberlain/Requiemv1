import type { DataSource } from 'typeorm';

import type { LoggerService } from '@ci/common/logging';

import type { PredictionScoreRow } from '../types';

import { CalibrationService, DEFAULT_CALIBRATION_LIMIT, MAX_CALIBRATION_LIMIT } from './CalibrationService';

const USER_ID = '00000000-0000-0000-0000-0000000000aa';
const CONTEXT = { userId: USER_ID };

function makeLogger(): LoggerService {
  return {
    setContext: jest.fn(),
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  } as unknown as LoggerService;
}

function makeRow(overrides: Partial<PredictionScoreRow> = {}): PredictionScoreRow {
  return {
    scored_at: new Date('2026-07-06T05:00:00.000Z'),
    window_start: new Date('2026-06-22T05:00:00.000Z'),
    window_end: new Date('2026-07-06T05:00:00.000Z'),
    brier: 0.42,
    l0_top1_acc: 0.75,
    l1_top3_acc: 0.5,
    ece: 0.08,
    coverage: 0.96,
    reliability_json: [{ bin: 9, lower: 0.9, upper: 1.0, count: 10, avg_confidence: 0.95, accuracy: 0.9 }],
    drift_flag: false,
    n_buckets: 120,
    ...overrides,
  };
}

function makeService(query: jest.Mock) {
  const dataSource = { query } as unknown as DataSource;

  return new CalibrationService(dataSource, makeLogger());
}

describe('CalibrationService', () => {
  it('runs a parameterized user-scoped query, newest first', async () => {
    const rows = [makeRow(), makeRow({ scored_at: new Date('2026-07-05T05:00:00.000Z') })];
    const query = jest.fn().mockResolvedValue(rows);
    const service = makeService(query);

    const result = await service.getScores(CONTEXT);

    expect(result).toBe(rows);
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('FROM hbpe.prediction_score');
    expect(sql).toContain('WHERE user_id = $1');
    expect(sql).toContain('ORDER BY scored_at DESC');
    expect(sql).toContain('LIMIT $2');
    expect(params).toEqual([USER_ID, DEFAULT_CALIBRATION_LIMIT]);
  });

  it('passes the requested limit through', async () => {
    const query = jest.fn().mockResolvedValue([]);
    const service = makeService(query);

    await service.getScores(CONTEXT, 3);

    expect(query.mock.calls[0][1]).toEqual([USER_ID, 3]);
  });

  it('clamps the limit to [1, MAX_CALIBRATION_LIMIT]', async () => {
    const query = jest.fn().mockResolvedValue([]);
    const service = makeService(query);

    await service.getScores(CONTEXT, 100000);
    await service.getScores(CONTEXT, -5);
    await service.getScores(CONTEXT, 0);

    expect(query.mock.calls[0][1]).toEqual([USER_ID, MAX_CALIBRATION_LIMIT]);
    expect(query.mock.calls[1][1]).toEqual([USER_ID, 1]);
    // 0 is falsy → falls back to the default limit
    expect(query.mock.calls[2][1]).toEqual([USER_ID, DEFAULT_CALIBRATION_LIMIT]);
  });

  it('returns [] when the table does not exist (42P01 — fresh install)', async () => {
    const err = Object.assign(new Error('relation "hbpe.prediction_score" does not exist'), {
      code: '42P01',
    });
    const service = makeService(jest.fn().mockRejectedValue(err));

    await expect(service.getScores(CONTEXT)).resolves.toEqual([]);
  });

  it('returns [] when the hbpe schema does not exist (3F000) via TypeORM driverError', async () => {
    const err = Object.assign(new Error('QueryFailedError'), {
      driverError: { code: '3F000' },
    });
    const service = makeService(jest.fn().mockRejectedValue(err));

    await expect(service.getScores(CONTEXT)).resolves.toEqual([]);
  });

  it('rethrows unrelated query errors', async () => {
    const err = Object.assign(new Error('connection refused'), { code: 'ECONNREFUSED' });
    const service = makeService(jest.fn().mockRejectedValue(err));

    await expect(service.getScores(CONTEXT)).rejects.toThrow('connection refused');
  });
});
