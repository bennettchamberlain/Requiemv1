import { OUTGOING_EVENT_TYPES, SIGNED_TRANSACTION_TYPE, SOCIAL_EVENT_TYPES } from '../lifeStats';
import { LifeStatsService } from '../LifeStatsService';

describe('LifeStatsService SQL contracts', () => {
  function setup() {
    const query = jest.fn<Promise<unknown[]>, [string, unknown[]]>(async () => []);
    const eventRepo = { manager: { query } };
    const logger = { setContext: jest.fn() };
    const service = new LifeStatsService(eventRepo as never, logger as never);

    return { service, query };
  }

  const range = { from: new Date('2026-05-01T00:00:00.000Z'), to: new Date('2026-08-01T00:00:00.000Z') };

  it('scopes spend to the owner, range, outgoing types, and signed transactions', async () => {
    const { service, query } = setup();
    await service.spendByMerchant('user-1', range);

    const [sql, params] = query.mock.calls[0];
    const normalized = sql.replace(/\s+/g, ' ');

    expect(params[0]).toBe('user-1');
    expect(params[1]).toEqual(range.from);
    expect(params[2]).toEqual(range.to);
    expect(params[3]).toEqual([...OUTGOING_EVENT_TYPES]);
    expect(params[4]).toBe(SIGNED_TRANSACTION_TYPE);
    expect(normalized).toContain('e.event_type = ANY($4::text[])');
    expect(normalized).toContain('e.event_type = $5');
    expect(normalized).toContain('FROM ci.receipts r');
    expect(normalized).toContain("e.metadata->>'Amount'");
    expect(normalized).not.toContain('credit');
  });

  it('excludes the self person from conversation ranks', async () => {
    const { service, query } = setup();
    await service.topConversations('user-1', range);

    const [sql, params] = query.mock.calls[0];
    const normalized = sql.replace(/\s+/g, ' ');

    expect(params[0]).toBe('user-1');
    expect(normalized).toContain('COALESCE(e.is_self, false) = false');
    expect(normalized).toContain('e.merged_into_entity_id IS NULL');
    expect(normalized).toContain("e.entity_type = 'Person'");
  });

  it('restricts time hours to duration-bearing or known timed types', async () => {
    const { service, query } = setup();
    await service.timeBreakdown('user-1', range);

    const eventSql = query.mock.calls[0][0].replace(/\s+/g, ' ');
    expect(eventSql).toContain('e.duration_minutes IS NOT NULL');
    expect(eventSql).toContain('e.event_type = ANY($8::text[])');

    const callSql = query.mock.calls[1][0].replace(/\s+/g, ' ');
    expect(callSql).toContain('c.duration_seconds IS NOT NULL');
  });

  it('buckets social events by like/post/comment and range span', async () => {
    const { service, query } = setup();
    await service.socialOverTime('user-1', range);

    const [sql, params] = query.mock.calls[0];
    expect(params[3]).toBe('week');
    expect(params[4]).toEqual([...SOCIAL_EVENT_TYPES]);
    expect(sql.replace(/\s+/g, ' ')).toContain('e.event_type = ANY($5::text[])');
  });

  it('uses monthly social buckets for an unbounded range', async () => {
    const { service, query } = setup();
    await service.socialOverTime('user-1', { from: null, to: null });

    expect(query.mock.calls[0][1][3]).toBe('month');
  });

  it('casts communication_type to text so COALESCE can mix it with source_system', async () => {
    const { service, query } = setup();
    await service.channels('user-1', range);

    const [sql] = query.mock.calls[0];
    expect(sql.replace(/\s+/g, ' ')).toContain("COALESCE(NULLIF(c.source_system, ''), c.communication_type::text, 'unknown')");
  });
});
