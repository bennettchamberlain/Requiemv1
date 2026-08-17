import { describe, expect, it } from 'vitest';

import { collectDroppedFiles } from './collectDroppedFiles';

describe('collectDroppedFiles', () => {
  it('drops a 0-byte directory placeholder that would break FormData', async () => {
    const folder = new File([], 'chatgpt-export');
    const dataTransfer = {
      items: [],
      files: [folder],
    } as unknown as DataTransfer;

    await expect(collectDroppedFiles(dataTransfer)).resolves.toEqual([]);
  });

  it('keeps a real empty file that has a type', async () => {
    const empty = new File([], 'notes.txt', { type: 'text/plain' });
    const dataTransfer = {
      items: [],
      files: [empty],
    } as unknown as DataTransfer;

    await expect(collectDroppedFiles(dataTransfer)).resolves.toEqual([empty]);
  });
});
