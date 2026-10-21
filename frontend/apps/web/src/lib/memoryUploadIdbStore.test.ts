import { beforeEach, describe, expect, it } from 'vitest';

import {
  clearAllQueuedBlobs,
  deleteQueuedBlob,
  getQueuedBlob,
  listQueuedBlobMetadata,
  putQueuedBlob,
  recordQueuedBlobAttempt,
} from './memoryUploadIdbStore';

describe('memoryUploadIdbStore', () => {
  beforeEach(async () => {
    await clearAllQueuedBlobs();
  });

  it('stores, lists metadata, updates attempts, and deletes large binary payloads', async () => {
    const payload = new Uint8Array(4 * 1024 * 1024); // 4 MiB audio capture
    payload[0] = 0x4f;
    payload[1] = 0x67;

    await putQueuedBlob({
      id: 'blob-audio-1',
      fileName: 'voice-memo.ogg',
      mimeType: 'audio/ogg',
      sizeBytes: payload.byteLength,
      createdAt: '2026-10-20T18:00:00.000Z',
      attempts: 0,
      payload,
    });

    const list = await listQueuedBlobMetadata();
    expect(list).toEqual([
      {
        id: 'blob-audio-1',
        fileName: 'voice-memo.ogg',
        mimeType: 'audio/ogg',
        sizeBytes: payload.byteLength,
        createdAt: '2026-10-20T18:00:00.000Z',
        attempts: 0,
      },
    ]);

    const updated = await recordQueuedBlobAttempt('blob-audio-1', '503 Service Unavailable');
    expect(updated?.attempts).toBe(1);
    expect(updated?.lastError).toBe('503 Service Unavailable');

    const loaded = await getQueuedBlob('blob-audio-1');
    expect(loaded?.sizeBytes).toBe(4 * 1024 * 1024);

    await expect(deleteQueuedBlob('blob-audio-1')).resolves.toBe(true);
    await expect(getQueuedBlob('blob-audio-1')).resolves.toBeNull();
  });

  it('evicts oldest FIFO entries when total bytes exceed maxTotalBytes budget', async () => {
    const maxTotalBytes = 10 * 1024 * 1024; // 10 MiB

    await putQueuedBlob(
      {
        id: 'blob-1',
        fileName: 'clip-1.mp4',
        mimeType: 'video/mp4',
        sizeBytes: 6 * 1024 * 1024,
        createdAt: '2026-10-20T18:00:01.000Z',
        attempts: 0,
        payload: new Uint8Array(16),
      },
      { maxTotalBytes },
    );

    await putQueuedBlob(
      {
        id: 'blob-2',
        fileName: 'clip-2.mp4',
        mimeType: 'video/mp4',
        sizeBytes: 6 * 1024 * 1024,
        createdAt: '2026-10-20T18:00:02.000Z',
        attempts: 0,
        payload: new Uint8Array(16),
      },
      { maxTotalBytes },
    );

    const remaining = await listQueuedBlobMetadata();
    expect(remaining.map((r) => r.id)).toEqual(['blob-2']);
  });

  it('rejects a single blob that exceeds maxTotalBytes', async () => {
    await expect(
      putQueuedBlob(
        {
          id: 'too-big',
          fileName: 'raw-4k.mov',
          mimeType: 'video/quicktime',
          sizeBytes: 20 * 1024 * 1024,
          createdAt: '2026-10-20T18:00:03.000Z',
          attempts: 0,
          payload: new Uint8Array(16),
        },
        { maxTotalBytes: 10 * 1024 * 1024 },
      ),
    ).rejects.toThrow(/exceeds maximum offline queue budget/);
  });
});
