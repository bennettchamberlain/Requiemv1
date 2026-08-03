import type { BaseClient, Connection } from '@ci/domains/connections';

export interface SignalContact {
  number?: string;
  uuid?: string;
  name?: string;
  given_name?: string;
  family_name?: string;
  nickname?: string;
}

export interface SignalDataMessage {
  timestamp?: number;
  message?: string;
  groupInfo?: {
    groupId?: string;
    groupName?: string;
  };
}

export interface SignalEnvelope {
  envelope?: {
    source?: string;
    sourceNumber?: string;
    timestamp?: number;
    dataMessage?: SignalDataMessage;
  };
}

function encodePhoneNumber(phoneNumber: string) {
  return encodeURIComponent(phoneNumber);
}

export async function syncSignalContacts({
  connection,
  client,
}: {
  connection: Connection;
  client: BaseClient;
  nextCursor: Record<string, unknown>;
}) {
  const phoneNumber = connection.externalId;

  if (!phoneNumber) {
    throw new Error('Signal connection missing phone number');
  }

  const contacts = (await client.request(
    connection,
    `/v1/contacts/${encodePhoneNumber(phoneNumber)}`,
  )) as SignalContact[];

  client.logger.log('Signal contacts sync call completed', {
    connectionId: connection.id,
    contactCount: contacts.length,
  });

  return {
    data: {
      contacts,
    },
    nextCursor: {},
  };
}

export function parseReceivePayload(payload: unknown): SignalEnvelope[] {
  if (!Array.isArray(payload)) {
    return [];
  }

  return payload.map((item) => {
    if (typeof item === 'string') {
      try {
        return JSON.parse(item) as SignalEnvelope;
      } catch {
        return {};
      }
    }

    return item as SignalEnvelope;
  });
}

export async function syncSignalMessages({
  connection,
  client,
  nextCursor,
}: {
  connection: Connection;
  client: BaseClient;
  nextCursor: Record<string, unknown>;
}) {
  const phoneNumber = connection.externalId;

  if (!phoneNumber) {
    throw new Error('Signal connection missing phone number');
  }

  const maxMessages = nextCursor.maxMessages ? String(nextCursor.maxMessages) : '100';
  const params = new URLSearchParams({
    max_messages: maxMessages,
    ignore_attachments: 'true',
    ignore_stories: 'true',
    send_read_receipts: 'false',
  });

  const rawPayload = (await client.request(
    connection,
    `/v1/receive/${encodePhoneNumber(phoneNumber)}?${params.toString()}`,
  )) as unknown;

  const envelopes = parseReceivePayload(rawPayload);
  const messages = envelopes
    .map((envelope) => envelope.envelope)
    .filter((envelope) => envelope?.dataMessage?.message);

  client.logger.log('Signal messages sync call completed', {
    connectionId: connection.id,
    messageCount: messages.length,
  });

  return {
    data: {
      messages,
      phoneNumber,
    },
    nextCursor: {},
  };
}
