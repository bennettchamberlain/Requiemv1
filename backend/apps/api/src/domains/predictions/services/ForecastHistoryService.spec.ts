import { BadRequestException } from '@nestjs/common';
import type { DataSource } from 'typeorm';

import type { LoggerService } from '@ci/common/logging';

import type { ForecastHistoryBucketRow } from '../types';

import { ForecastHistoryService } from './ForecastHistoryService';

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

function makeService(query: jest.Mock) {
  const dataSource = { query } as unknown as DataSource;

  return new ForecastHistoryService(dataSource, makeLogger());
}

function makeRow(overrides: Partial<ForecastHistoryBucketRow> = {}): ForecastHistoryBucketRow {
  return {
    bucket_index: 0,
    horizon_start: new Date('2026-07-10T00:00:00.000Z'),
    predicted_at: new Date('2026-07-09T21:12:00.000Z'),
    l0_probs: { WORK: 0.7, LEISURE: 0.3 },
    actual_l0: 'WORK',
    ...overrides,
  };
}

describe('ForecastHistoryService', () => {
  it('selects the latest prediction per bucket for the requested UTC date, user-scoped', async () => {
    const rows = [makeRow(), makeRow({ bucket_index: 1, actual_l0: null })];
    const query = jest.fn().mockResolvedValue(rows);
    const service = makeService(query);

    const result = await service.getHistory(CONTEXT, '2026-07-10');

    expect(result).toBe(rows);
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('DISTINCT ON (bucket_index)');
    expect(sql).toContain('FROM hbpe.prediction_log');
    expect(sql).toContain('WHERE user_id = $1');
    expect(sql).toContain(`(horizon_start AT TIME ZONE 'UTC')::date = $2::date`);
    expect(sql).toContain('ORDER BY bucket_index ASC, predicted_at DESC');
    expect(params).toEqual([USER_ID, '2026-07-10']);
  });

  it('rejects a malformed date before touching the database', async () => {
    const query = jest.fn();
    const service = makeService(query);

    await expect(service.getHistory(CONTEXT, 'yesterday')).rejects.toThrow(BadRequestException);
    await expect(service.getHistory(CONTEXT, '2026-7-1')).rejects.toThrow(BadRequestException);
    await expect(service.getHistory(CONTEXT, `2026-07-10'; DROP TABLE x;`)).rejects.toThrow(
      BadRequestException,
    );
    expect(query).not.toHaveBeenCalled();
  });

  it('returns [] when the table does not exist (42P01 — fresh install)', async () => {
    const err = Object.assign(new Error('relation "hbpe.prediction_log" does not exist'), {
      code: '42P01',
    });
    const service = makeService(jest.fn().mockRejectedValue(err));

    await expect(service.getHistory(CONTEXT, '2026-07-10')).resolves.toEqual([]);
  });

  it('returns [] when the hbpe schema does not exist (3F000) via TypeORM driverError', async () => {
    const err = Object.assign(new Error('QueryFailedError'), {
      driverError: { code: '3F000' },
    });
    const service = makeService(jest.fn().mockRejectedValue(err));

    await expect(service.getHistory(CONTEXT, '2026-07-10')).resolves.toEqual([]);
  });

  it('rethrows unrelated query errors', async () => {
    const err = Object.assign(new Error('connection refused'), { code: 'ECONNREFUSED' });
    const service = makeService(jest.fn().mockRejectedValue(err));

    await expect(service.getHistory(CONTEXT, '2026-07-10')).rejects.toThrow('connection refused');
  });
});
