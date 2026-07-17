import type { BaseClient, Connection } from '@ci/domains/connections';

const PAGE_LIMIT = 200;

export interface SlackConversation {
  id: string;
  name?: string;
  is_channel?: boolean;
  is_group?: boolean;
  is_im?: boolean;
  is_mpim?: boolean;
  is_private?: boolean;
  user?: string;
  num_members?: number;
}

export interface SlackMessage {
  type: string;
  user?: string;
  text?: string;
  ts: string;
  thread_ts?: string;
  subtype?: string;
  bot_id?: string;
}

export interface SlackConversationsListResponse {
  ok: boolean;
  channels: SlackConversation[];
  response_metadata?: {
    next_cursor?: string;
  };
}

export interface SlackConversationsHistoryResponse {
  ok: boolean;
  messages: SlackMessage[];
  has_more?: boolean;
  response_metadata?: {
    next_cursor?: string;
  };
}

export async function fetchAllConversations(client: BaseClient, connection: Connection) {
  const conversations: SlackConversation[] = [];
  let cursor: string | undefined;

  do {
    const params = new URLSearchParams({
      limit: '200',
      types: 'public_channel,private_channel,mpim,im',
    });

    if (cursor) {
      params.set('cursor', cursor);
    }

    const response = (await client.request(
      connection,
      `/conversations.list?${params.toString()}`,
    )) as SlackConversationsListResponse;

    conversations.push(...(response.channels || []));
    cursor = response.response_metadata?.next_cursor || undefined;
  } while (cursor);

  return conversations;
}

export async function syncSlackChannelMessages({
  connection,
  client,
  nextCursor,
  historical,
}: {
  connection: Connection;
  client: BaseClient;
  nextCursor: Record<string, unknown>;
  historical: boolean;
}): Promise<{ data: Record<string, unknown>; nextCursor?: Record<string, unknown> }> {
  const authedUserId = connection.externalId;

  if (!authedUserId) {
    throw new Error('Slack connection missing user id');
  }

  const conversations = await fetchAllConversations(client, connection);
  const channelMap = Object.fromEntries(conversations.map((channel) => [channel.id, channel]));
  const messagesByChannel: Record<string, SlackMessage[]> = {};
  const newCursor: Record<string, string | false> = {};

  for (const channel of conversations) {
    const channelId = channel.id;
    const existingCursor = nextCursor[channelId];

    if (existingCursor === false) {
      messagesByChannel[channelId] = [];
      newCursor[channelId] = false;
      continue;
    }

    const params = new URLSearchParams({
      channel: channelId,
      limit: String(PAGE_LIMIT),
    });

    if (typeof existingCursor === 'string' && existingCursor.length > 0) {
      params.set('cursor', existingCursor);
    } else if (!historical && typeof nextCursor.since === 'string') {
      params.set('oldest', String(Math.floor(new Date(nextCursor.since).getTime() / 1000)));
    }

    try {
      const response = (await client.request(
        connection,
        `/conversations.history?${params.toString()}`,
      )) as SlackConversationsHistoryResponse;

      const messages = (response.messages || []).filter((message) => {
        if (message.type !== 'message' || !message.text) {
          return false;
        }

        if (message.subtype && message.subtype !== 'thread_broadcast') {
          return false;
        }

        return true;
      });

      messagesByChannel[channelId] = messages;
      const nextPageCursor = response.response_metadata?.next_cursor;

      if (historical) {
        newCursor[channelId] = nextPageCursor || false;
      } else {
        newCursor[channelId] = false;
      }
    } catch (err) {
      client.logger.error('Slack messages: failed to fetch channel history', {
        connectionId: connection.id,
        channelId,
        error: err instanceof Error ? err.message : 'Unknown error',
      });
      messagesByChannel[channelId] = [];
      newCursor[channelId] = typeof existingCursor === 'string' ? existingCursor : false;
    }
  }

  client.logger.log('Slack messages sync call completed', {
    connectionId: connection.id,
    channelCount: conversations.length,
    totalMessages: Object.values(messagesByChannel).reduce((sum, items) => sum + items.length, 0),
  });

  return {
    data: {
      messages: messagesByChannel,
      channels: channelMap,
      authedUserId,
    },
    nextCursor: historical
      ? newCursor
      : {
          since: new Date().toISOString(),
        },
  };
}

export async function syncSlackChannels({
  connection,
  client,
  nextCursor,
}: {
  connection: Connection;
  client: BaseClient;
  nextCursor: Record<string, unknown>;
}): Promise<{ data: Record<string, unknown>; nextCursor?: Record<string, unknown> }> {
  const cursor = nextCursor.nextCursor ? String(nextCursor.nextCursor) : undefined;
  const params = new URLSearchParams({
    limit: '200',
    types: 'public_channel,private_channel,mpim,im',
  });

  if (cursor) {
    params.set('cursor', cursor);
  }

  const response = (await client.request(
    connection,
    `/conversations.list?${params.toString()}`,
  )) as SlackConversationsListResponse;

  const channels = response.channels || [];
  const nextPageCursor = response.response_metadata?.next_cursor;

  client.logger.log('Slack channels sync call completed', {
    connectionId: connection.id,
    channelCount: channels.length,
    hasNextPage: !!nextPageCursor,
  });

  return {
    data: {
      channels,
    },
    nextCursor: nextPageCursor
      ? {
          nextCursor: nextPageCursor,
        }
      : {},
  };
}
