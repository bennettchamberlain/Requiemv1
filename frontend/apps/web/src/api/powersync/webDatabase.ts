import { PowerSyncDatabase, WASQLiteOpenFactory, WASQLiteVFS } from '@powersync/web';

import { AppSchema } from './schema';

export function openWebPowerSyncDatabase(): PowerSyncDatabase {
  return new PowerSyncDatabase({
    schema: AppSchema,
    database: new WASQLiteOpenFactory({
      dbFilename: 'ci-powersync.db',
      // IDBBatchAtomicVFS (IndexedDB-backed) is the only VFS that works without
      // cross-origin-isolation headers, which the Capacitor webview can't set.
      // Native uses Capacitor SQLite instead (see nativeDatabase.ts).
      vfs: WASQLiteVFS.IDBBatchAtomicVFS,
    }),
  });
}
