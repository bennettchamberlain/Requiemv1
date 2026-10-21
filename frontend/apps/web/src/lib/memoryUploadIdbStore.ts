export const UPLOAD_IDB_DATABASE = 'ci-memory-upload-blobs';
export const UPLOAD_IDB_STORE = 'queued_blobs';
export const DEFAULT_MAX_TOTAL_BYTES = 250 * 1024 * 1024; // 250 MiB

export interface QueuedBlobMetadata {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
  attempts: number;
  lastError?: string;
}

export interface QueuedBlobRecord extends QueuedBlobMetadata {
  /** Binary payload (`Uint8Array` or `Blob`) persisted outside the 5 MB `localStorage` limit. */
  payload: Uint8Array | Blob;
}

interface StorageDriver {
  getAll(): Promise<QueuedBlobRecord[]>;
  get(id: string): Promise<QueuedBlobRecord | null>;
  put(record: QueuedBlobRecord): Promise<void>;
  delete(id: string): Promise<boolean>;
  clear(): Promise<void>;
}

const memoryFallbackStore = new Map<string, QueuedBlobRecord>();

function hasIndexedDb(): boolean {
  return typeof globalThis !== 'undefined' && typeof globalThis.indexedDB?.open === 'function';
}

function openIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = globalThis.indexedDB.open(UPLOAD_IDB_DATABASE, 1);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(UPLOAD_IDB_STORE)) {
        db.createObjectStore(UPLOAD_IDB_STORE, { keyPath: 'id' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Failed to open IndexedDB upload store'));
  });
}

const idbDriver: StorageDriver = {
  async getAll(): Promise<QueuedBlobRecord[]> {
    const db = await openIdb();
    try {
      return await new Promise<QueuedBlobRecord[]>((resolve, reject) => {
        const tx = db.transaction(UPLOAD_IDB_STORE, 'readonly');
        const store = tx.objectStore(UPLOAD_IDB_STORE);
        const req = store.getAll();
        req.onsuccess = () => resolve((req.result as QueuedBlobRecord[]) ?? []);
        req.onerror = () => reject(req.error ?? new Error('Failed to read queued blobs'));
      });
    } finally {
      db.close();
    }
  },

  async get(id: string): Promise<QueuedBlobRecord | null> {
    const db = await openIdb();
    try {
      return await new Promise<QueuedBlobRecord | null>((resolve, reject) => {
        const tx = db.transaction(UPLOAD_IDB_STORE, 'readonly');
        const store = tx.objectStore(UPLOAD_IDB_STORE);
        const req = store.get(id);
        req.onsuccess = () => resolve((req.result as QueuedBlobRecord | undefined) ?? null);
        req.onerror = () => reject(req.error ?? new Error(`Failed to read queued blob ${id}`));
      });
    } finally {
      db.close();
    }
  },

  async put(record: QueuedBlobRecord): Promise<void> {
    const db = await openIdb();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(UPLOAD_IDB_STORE, 'readwrite');
        const store = tx.objectStore(UPLOAD_IDB_STORE);
        const req = store.put(record);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error ?? new Error(`Failed to store queued blob ${record.id}`));
      });
    } finally {
      db.close();
    }
  },

  async delete(id: string): Promise<boolean> {
    const existing = await this.get(id);
    if (!existing) {
      return false;
    }

    const db = await openIdb();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(UPLOAD_IDB_STORE, 'readwrite');
        const store = tx.objectStore(UPLOAD_IDB_STORE);
        const req = store.delete(id);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error ?? new Error(`Failed to delete queued blob ${id}`));
      });

      return true;
    } finally {
      db.close();
    }
  },

  async clear(): Promise<void> {
    const db = await openIdb();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(UPLOAD_IDB_STORE, 'readwrite');
        const store = tx.objectStore(UPLOAD_IDB_STORE);
        const req = store.clear();
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error ?? new Error('Failed to clear queued blobs'));
      });
    } finally {
      db.close();
    }
  },
};

const fallbackDriver: StorageDriver = {
  async getAll(): Promise<QueuedBlobRecord[]> {
    return [...memoryFallbackStore.values()];
  },
  async get(id: string): Promise<QueuedBlobRecord | null> {
    return memoryFallbackStore.get(id) ?? null;
  },
  async put(record: QueuedBlobRecord): Promise<void> {
    memoryFallbackStore.set(record.id, record);
  },
  async delete(id: string): Promise<boolean> {
    return memoryFallbackStore.delete(id);
  },
  async clear(): Promise<void> {
    memoryFallbackStore.clear();
  },
};

function selectDriver(): StorageDriver {
  return hasIndexedDb() ? idbDriver : fallbackDriver;
}

function toMetadata(record: QueuedBlobRecord): QueuedBlobMetadata {
  return {
    id: record.id,
    fileName: record.fileName,
    mimeType: record.mimeType,
    sizeBytes: record.sizeBytes,
    createdAt: record.createdAt,
    attempts: record.attempts,
    ...(record.lastError !== undefined ? { lastError: record.lastError } : {}),
  };
}

/**
 * Enqueues or updates a large media capture in IndexedDB (with automatic in-memory fallback
 * in test/SSR environments). Evicts oldest entries FIFO when total queued bytes would
 * exceed `maxTotalBytes`.
 */
export async function putQueuedBlob(
  record: QueuedBlobRecord,
  options?: { maxTotalBytes?: number },
): Promise<void> {
  const maxTotalBytes = options?.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES;
  if (record.sizeBytes > maxTotalBytes) {
    throw new Error(
      `Queued media payload (${record.sizeBytes} bytes) exceeds maximum offline queue budget (${maxTotalBytes} bytes)`,
    );
  }

  const driver = selectDriver();
  const existing = await driver.getAll();
  const others = existing
    .filter((item) => item.id !== record.id)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  let currentBytes = others.reduce((sum, item) => sum + item.sizeBytes, 0);
  while (currentBytes + record.sizeBytes > maxTotalBytes && others.length > 0) {
    const oldest = others.shift()!;
    await driver.delete(oldest.id);
    currentBytes -= oldest.sizeBytes;
  }

  await driver.put(record);
}

export async function getQueuedBlob(id: string): Promise<QueuedBlobRecord | null> {
  return selectDriver().get(id);
}

export async function deleteQueuedBlob(id: string): Promise<boolean> {
  return selectDriver().delete(id);
}

export async function listQueuedBlobMetadata(): Promise<QueuedBlobMetadata[]> {
  const records = await selectDriver().getAll();

  return records.sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map(toMetadata);
}

export async function recordQueuedBlobAttempt(
  id: string,
  lastError?: string,
): Promise<QueuedBlobMetadata | null> {
  const driver = selectDriver();
  const existing = await driver.get(id);
  if (!existing) {
    return null;
  }

  const updated: QueuedBlobRecord = {
    ...existing,
    attempts: existing.attempts + 1,
    ...(lastError !== undefined ? { lastError } : {}),
  };
  await driver.put(updated);

  return toMetadata(updated);
}

export async function clearAllQueuedBlobs(): Promise<void> {
  await selectDriver().clear();
}
