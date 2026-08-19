import type { AbstractPowerSyncDatabase } from '@powersync/web';

import { POWER_SYNC_DEFAULT_LOOKBACK_DAYS, setLookbackDays } from './workingSet';

let database: AbstractPowerSyncDatabase | null = null;

export function bindPowerSyncDatabase(db: AbstractPowerSyncDatabase | null): void {
  database = db;
}

export function getBoundPowerSyncDatabase(): AbstractPowerSyncDatabase | null {
  return database;
}

export function requestPowerSyncReconnect(): void {
  window.dispatchEvent(new Event('ci-powersync-reconnect'));
}

/**
 * Drop the local replica. Call on logout (S3). Does not reconnect; the provider
 * reconnects only while a session exists.
 */
export async function disconnectAndClearPowerSync(): Promise<void> {
  if (!database) {
    return;
  }

  try {
    await database.disconnectAndClear();
  } catch {
    await database.disconnect();
  }
}

export async function clearPowerSyncWorkingSet(): Promise<void> {
  await disconnectAndClearPowerSync();
  setLookbackDays(POWER_SYNC_DEFAULT_LOOKBACK_DAYS);
  requestPowerSyncReconnect();
}

export async function measurePowerSyncSizeBytes(db: AbstractPowerSyncDatabase): Promise<number | null> {
  try {
    const row = await db.getOptional<{ size: number }>(
      'SELECT page_count * page_size AS size FROM pragma_page_count(), pragma_page_size()',
    );

    return typeof row?.size === 'number' ? row.size : null;
  } catch {
    return null;
  }
}
