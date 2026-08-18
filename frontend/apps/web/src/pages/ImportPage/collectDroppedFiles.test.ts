import { describe, expect, it } from 'vitest';

import { collectDroppedFiles } from './collectDroppedFiles';

/**
 * A `FileSystemFileEntry` stand-in — what `webkitGetAsEntry()` hands back for a
 * dropped file, whether loose or inside a walked directory.
 */
function fileEntry(name: string, fullPath: string, content: string) {
  return {
    isFile: true as const,
    isDirectory: false as const,
    name,
    fullPath,
    file: (ok: (file: File) => void) => ok(new File([content], name)),
  };
}

/**
 * A `FileSystemDirectoryEntry` stand-in whose reader answers in PAGES — the
 * real Chromium API never hands back a directory's children in one call, and
 * `readDirectoryEntries` has to keep calling `readEntries` until it gets an
 * empty batch. `pages` is consumed one array per call; running past the end
 * (or an explicit trailing `[]`) is what ends the walk.
 */
function dirEntry(name: string, fullPath: string, pages: unknown[][]) {
  let call = 0;

  return {
    isFile: false as const,
    isDirectory: true as const,
    name,
    fullPath,
    createReader: () => ({
      readEntries: (ok: (entries: unknown[]) => void) => {
        const batch = pages[call] ?? [];

        call += 1;
        ok(batch);
      },
    }),
  };
}

function dataTransferOf(entries: unknown[], files: File[] = []): DataTransfer {
  return {
    items: entries.map((entry) => ({ webkitGetAsEntry: () => entry })),
    files,
  } as unknown as DataTransfer;
}

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

  describe('walking a dropped folder', () => {
    it('recurses into subdirectories, giving every file its full relative path', async () => {
      // Three pages for the root reader (two batches of real children, then the
      // empty batch that ends the walk) proves readDirectoryEntries' pump loop
      // does not stop after the first page.
      const conversations = fileEntry('conversations.json', '/chatgpt-export/conversations.json', '{}');
      const avatar = fileEntry('avatar.png', '/chatgpt-export/media/avatar.png', 'binary');
      const mediaDir = dirEntry('media', '/chatgpt-export/media', [[avatar], []]);
      const rootDir = dirEntry('chatgpt-export', '/chatgpt-export', [[conversations], [mediaDir], []]);

      const files = await collectDroppedFiles(dataTransferOf([rootDir]));

      expect(files.map((file) => file.name)).toEqual(['conversations.json', 'avatar.png']);
      expect(files.map((file) => file.webkitRelativePath)).toEqual([
        'chatgpt-export/conversations.json',
        'chatgpt-export/media/avatar.png',
      ]);
      expect(files[0].size).toBe(2); // '{}'
    });

    it('strips only the leading slash from a top-level file, not a directory prefix that is not there', async () => {
      const lone = fileEntry('export.zip', '/export.zip', 'zip-bytes');

      const files = await collectDroppedFiles(dataTransferOf([lone]));

      expect(files).toHaveLength(1);
      expect(files[0].webkitRelativePath).toBe('export.zip');
    });

    it('walks every top-level item dropped together, files and directories alike', async () => {
      const readme = fileEntry('README.txt', '/README.txt', 'read me');
      const nested = fileEntry('data.json', '/export/data.json', '{}');
      const exportDir = dirEntry('export', '/export', [[nested], []]);

      const files = await collectDroppedFiles(dataTransferOf([readme, exportDir]));

      expect(files.map((file) => file.webkitRelativePath)).toEqual(['README.txt', 'export/data.json']);
    });

    it('skips an item with no filesystem entry rather than falling back to a 0-byte placeholder', async () => {
      // Chromium hands back `null` from webkitGetAsEntry for some drag sources
      // (e.g. plain text). One real file entry alongside it must still walk —
      // and because SOMETHING was walked, the 0-byte-placeholder fallback in
      // `files` must not run over it.
      const real = fileEntry('export.zip', '/export.zip', 'zip-bytes');
      const dataTransfer = {
        items: [{ webkitGetAsEntry: () => null }, { webkitGetAsEntry: () => real }],
        files: [new File([], 'unrelated-placeholder')],
      } as unknown as DataTransfer;

      const files = await collectDroppedFiles(dataTransfer);

      expect(files.map((file) => file.name)).toEqual(['export.zip']);
    });
  });
});
