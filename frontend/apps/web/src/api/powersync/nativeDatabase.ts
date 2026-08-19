/**
 * Native PowerSync database: Capacitor SQLite on disk, not IndexedDB.
 *
 * The working set is this one file. Eviction is unsubscribe (a later cutoff), never
 * a second LRU database. `@powersync/capacitor` does not support SQLCipher yet, so
 * this file is unencrypted SQLite in `Library/LocalDatabase` (excluded from iCloud
 * backup). Local Hub's outbox stays SQLCipher. Gate G-2 still holds: do not put
 * health, location, or contacts in this replica until the adapter encrypts.
 */
import { CapacitorSQLiteOpenFactory, PowerSyncDatabase } from '@powersync/capacitor';

import { AppSchema } from './schema';

export function openNativePowerSyncDatabase(): PowerSyncDatabase {
  return new PowerSyncDatabase({
    schema: AppSchema,
    database: new CapacitorSQLiteOpenFactory({
      dbFilename: 'ci-powersync.db',
    }),
  });
}
