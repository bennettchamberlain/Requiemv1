import { parseReceivePayload } from '../signalApi';

describe('parseReceivePayload', () => {
  it('parses JSON string envelopes', () => {
    const payload = [
      JSON.stringify({
        envelope: {
          sourceNumber: '+15551234567',
          timestamp: 1_700_000_000_000,
          dataMessage: { message: 'Hello' },
        },
      }),
    ];

    const result = parseReceivePayload(payload);

    expect(result).toHaveLength(1);
    expect(result[0].envelope?.dataMessage?.message).toBe('Hello');
  });

  it('returns empty array for non-array payloads', () => {
    expect(parseReceivePayload(null)).toEqual([]);
    expect(parseReceivePayload({})).toEqual([]);
  });
});
