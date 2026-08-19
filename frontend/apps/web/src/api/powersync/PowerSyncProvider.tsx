import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { isNativePlatform } from '@ci/common';
import { PowerSyncContext } from '@powersync/react';
import type { AbstractPowerSyncDatabase } from '@powersync/web';

import { useAuth } from '@/hooks';

import { GraphQLBackendConnector } from './connector';
import { bindPowerSyncDatabase, measurePowerSyncSizeBytes } from './session';
import { openWebPowerSyncDatabase } from './webDatabase';
import { POWER_SYNC_CACHE_BUDGET_BYTES, shrinkToBudget } from './workingSet';

/**
 * Mounts the local-first PowerSync database and exposes it via `PowerSyncContext`.
 *
 * On native this is Capacitor SQLite (one 8 GB rolling working set). On web it is
 * WASQLite IndexedDB. GraphQL remains the source of truth when PowerSync is down
 * (token endpoint 503) or a row is outside the subscribed window.
 */
export function PowerSyncProvider({ children }: { children: ReactNode }) {
  const [{ authToken, authenticated }] = useAuth();
  const tokenRef = useRef(authToken);

  tokenRef.current = authToken;

  const webDatabase = useMemo(() => openWebPowerSyncDatabase(), []);
  const [database, setDatabase] = useState<AbstractPowerSyncDatabase>(webDatabase);
  const [reconnectNonce, setReconnectNonce] = useState(0);

  useEffect(() => {
    bindPowerSyncDatabase(webDatabase);
    setDatabase(webDatabase);

    if (!isNativePlatform()) {
      return () => {
        bindPowerSyncDatabase(null);
        void webDatabase.close();
      };
    }

    let cancelled = false;
    let native: AbstractPowerSyncDatabase | undefined;

    void import('./nativeDatabase')
      .then(({ openNativePowerSyncDatabase }) => {
        if (cancelled) {
          return;
        }

        native = openNativePowerSyncDatabase() as AbstractPowerSyncDatabase;
        bindPowerSyncDatabase(native);
        setDatabase(native);
        void webDatabase.close();
      })
      .catch((error: unknown) => {
        console.warn('[PowerSync] Native SQLite adapter unavailable; using IndexedDB VFS', error);
        bindPowerSyncDatabase(webDatabase);
      });

    return () => {
      cancelled = true;
      bindPowerSyncDatabase(null);
      void native?.close();
    };
  }, [webDatabase]);

  useEffect(() => {
    const onReconnect = () => setReconnectNonce((n) => n + 1);

    window.addEventListener('ci-powersync-reconnect', onReconnect);

    return () => window.removeEventListener('ci-powersync-reconnect', onReconnect);
  }, []);

  useEffect(() => {
    if (!authenticated) {
      void database.disconnect();

      return;
    }

    const connector = new GraphQLBackendConnector(() => tokenRef.current ?? null);

    void database.connect(connector).catch((error: unknown) => {
      console.warn('[PowerSync] Connect skipped; GraphQL remains the source of truth', error);
    });
  }, [database, authenticated, reconnectNonce]);

  useEffect(() => {
    if (!authenticated) {
      return;
    }

    let cancelled = false;

    const tick = async () => {
      const size = await measurePowerSyncSizeBytes(database);

      if (cancelled || size == null || size <= POWER_SYNC_CACHE_BUDGET_BYTES) {
        return;
      }

      shrinkToBudget(size);
      await database.disconnect();
      setReconnectNonce((n) => n + 1);
    };

    void tick();
    const id = window.setInterval(() => void tick(), 60_000);

    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [database, authenticated, reconnectNonce]);

  return <PowerSyncContext.Provider value={database as never}>{children}</PowerSyncContext.Provider>;
}
