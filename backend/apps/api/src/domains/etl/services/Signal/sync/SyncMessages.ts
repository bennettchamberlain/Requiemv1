import type { BaseClient, Connection } from '@ci/domains/connections';

import { syncSignalMessages as syncMessagesPage } from './signalApi';

export async function syncMessages({
  connection,
  client,
  nextCursor,
}: {
  connection: Connection;
  client: BaseClient;
  nextCursor: Record<string, unknown>;
}) {
  try {
    return await syncMessagesPage({
      connection,
      client,
      nextCursor,
    });
  } catch (err) {
    client.logger.error('Failed to sync Signal messages', {
      connectionId: connection.id,
      error: err instanceof Error ? err.message : 'Unknown error',
    });

    throw err;
  }
}
