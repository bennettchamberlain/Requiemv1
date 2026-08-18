import type { BaseClient, Connection } from '@ci/domains/connections';

import { parseReceivePayload, syncSignalContacts, syncSignalMessages } from '../signalApi';

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

  it('swallows a malformed JSON string and yields an empty envelope instead of throwing', () => {
    const payload = ['{not valid json'];

    const result = parseReceivePayload(payload);

    expect(result).toEqual([{}]);
  });

  it('passes through a plain-object (non-string) array item unchanged', () => {
    const envelopeObject = {
      envelope: { sourceNumber: '+15551234567', dataMessage: { message: 'Hi' } },
    };

    const result = parseReceivePayload([envelopeObject]);

    expect(result).toEqual([envelopeObject]);
  });

  it('handles a mix of string and object items in the same payload', () => {
    const objectItem = { envelope: { dataMessage: { message: 'from object' } } };
    const payload = [JSON.stringify({ envelope: { dataMessage: { message: 'from string' } } }), objectItem];

    const result = parseReceivePayload(payload);

    expect(result[0].envelope?.dataMessage?.message).toBe('from string');
    expect(result[1].envelope?.dataMessage?.message).toBe('from object');
  });
});

function makeClient(response: unknown): { client: BaseClient; request: jest.Mock } {
  const request = jest.fn().mockResolvedValue(response);
  const client = {
    request,
    logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn(), setContext: jest.fn() },
  } as unknown as BaseClient;

  return { client, request };
}

function makeConnection(externalId: string | undefined): Connection {
  return { id: 'conn-1', externalId } as Connection;
}

describe('syncSignalContacts', () => {
  it('requests contacts for the URL-encoded phone number and returns them under data.contacts', async () => {
    const contacts = [{ number: '+1 555 123 4567', name: 'Alice' }];
    const { client, request } = makeClient(contacts);
    const connection = makeConnection('+1 555 123 4567');

    const result = await syncSignalContacts({ connection, client, nextCursor: {} });

    expect(request).toHaveBeenCalledWith(connection, '/v1/contacts/%2B1%20555%20123%204567');
    expect(result).toEqual({ data: { contacts }, nextCursor: {} });
  });

  it('throws when the connection has no phone number (externalId)', async () => {
    const { client } = makeClient([]);
    const connection = makeConnection(undefined);

    await expect(syncSignalContacts({ connection, client, nextCursor: {} })).rejects.toThrow(
      'Signal connection missing phone number',
    );
  });
});

describe('syncSignalMessages', () => {
  it('filters envelopes down to those with a dataMessage.message present', async () => {
    const rawPayload = [
      { envelope: { sourceNumber: '+15551234567', dataMessage: { message: 'kept' } } },
      { envelope: { sourceNumber: '+15551234567' } }, // no dataMessage — should be dropped
      { envelope: { sourceNumber: '+15551234567', dataMessage: {} } }, // dataMessage with no message — dropped
    ];
    const { client, request } = makeClient(rawPayload);
    const connection = makeConnection('+15551234567');

    const result = await syncSignalMessages({ connection, client, nextCursor: {} });

    expect(result.data.messages).toHaveLength(1);
    expect(result.data.messages[0]?.dataMessage?.message).toBe('kept');
    expect(result.data.phoneNumber).toBe('+15551234567');
    expect(request).toHaveBeenCalledWith(connection, expect.stringContaining('/v1/receive/%2B15551234567?'));
  });

  it('defaults max_messages to 100 when nextCursor has no maxMessages', async () => {
    const { client, request } = makeClient([]);
    const connection = makeConnection('+15551234567');

    await syncSignalMessages({ connection, client, nextCursor: {} });

    const [, endpoint] = request.mock.calls[0] as [Connection, string];
    expect(endpoint).toContain('max_messages=100');
  });

  it('honors an explicit maxMessages from nextCursor', async () => {
    const { client, request } = makeClient([]);
    const connection = makeConnection('+15551234567');

    await syncSignalMessages({ connection, client, nextCursor: { maxMessages: 25 } });

    const [, endpoint] = request.mock.calls[0] as [Connection, string];
    expect(endpoint).toContain('max_messages=25');
  });

  it('throws when the connection has no phone number (externalId)', async () => {
    const { client } = makeClient([]);
    const connection = makeConnection(undefined);

    await expect(syncSignalMessages({ connection, client, nextCursor: {} })).rejects.toThrow(
      'Signal connection missing phone number',
    );
  });
});
