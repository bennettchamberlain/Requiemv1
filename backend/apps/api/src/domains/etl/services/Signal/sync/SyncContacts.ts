import type { BaseClient, Connection } from '@ci/domains/connections';

import { syncSignalContacts as syncContactsPage } from './signalApi';

export async function syncContacts({
  connection,
  client,
  nextCursor,
}: {
  connection: Connection;
  client: BaseClient;
  nextCursor: Record<string, unknown>;
}) {
  try {
    return await syncContactsPage({
      connection,
      client,
      nextCursor,
    });
  } catch (err) {
    client.logger.error('Failed to sync Signal contacts', {
      connectionId: connection.id,
      error: err instanceof Error ? err.message : 'Unknown error',
    });

    throw err;
  }
}
