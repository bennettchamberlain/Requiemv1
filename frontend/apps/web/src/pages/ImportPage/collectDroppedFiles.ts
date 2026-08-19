/**
 * Turn a drop into real Files, including a dropped folder.
 *
 * `dataTransfer.files` is the file list. On Chromium, dropping a folder often
 * puts a single 0-byte directory placeholder there — appending that to
 * FormData is what surfaces as "Failed to fetch". The items list has
 * `webkitGetAsEntry()`, which walks the tree and yields the actual files with
 * a relative path the upload can reconstruct.
 */

interface FileSystemFileEntryLike {
  isFile: true;
  isDirectory: false;
  name: string;
  fullPath: string;
  file: (ok: (file: File) => void, err?: (error: DOMException) => void) => void;
}

interface FileSystemDirectoryReaderLike {
  readEntries: (ok: (entries: FileSystemEntryLike[]) => void, err?: (error: DOMException) => void) => void;
}

interface FileSystemDirectoryEntryLike {
  isFile: false;
  isDirectory: true;
  name: string;
  fullPath: string;
  createReader: () => FileSystemDirectoryReaderLike;
}

type FileSystemEntryLike = FileSystemFileEntryLike | FileSystemDirectoryEntryLike;

function withRelativePath(file: File, relativePath: string): File {
  if (file.webkitRelativePath === relativePath) {
    return file;
  }

  try {
    Object.defineProperty(file, 'webkitRelativePath', { value: relativePath, configurable: true });
  } catch {
    // Some browsers freeze the property; the filename still uploads.
  }

  return file;
}

function relativeFromFullPath(fullPath: string): string {
  return fullPath.replace(/^\/+/, '');
}

function readFile(entry: FileSystemFileEntryLike): Promise<File> {
  return new Promise((resolve, reject) => {
    entry.file((file) => resolve(withRelativePath(file, relativeFromFullPath(entry.fullPath))), reject);
  });
}

function readDirectoryEntries(dir: FileSystemDirectoryEntryLike): Promise<FileSystemEntryLike[]> {
  const reader = dir.createReader();
  const all: FileSystemEntryLike[] = [];

  const pump = (): Promise<FileSystemEntryLike[]> =>
    new Promise((resolve, reject) => {
      reader.readEntries((batch) => {
        if (batch.length === 0) {
          resolve(all);

          return;
        }

        all.push(...batch);
        resolve(pump());
      }, reject);
    });

  return pump();
}

async function collectEntry(entry: FileSystemEntryLike, into: File[]): Promise<void> {
  if (entry.isFile) {
    into.push(await readFile(entry));

    return;
  }

  const children = await readDirectoryEntries(entry);

  for (const child of children) {
    await collectEntry(child, into);
  }
}

function entryOf(item: DataTransferItem): FileSystemEntryLike | null {
  const getter = (item as DataTransferItem & { webkitGetAsEntry?: () => FileSystemEntryLike | null })
    .webkitGetAsEntry;

  if (typeof getter !== 'function') {
    return null;
  }

  return getter.call(item);
}

/** Walk a drop. Falls back to `files` when the browser has no directory entries. */
export async function collectDroppedFiles(dataTransfer: DataTransfer | null): Promise<File[]> {
  if (!dataTransfer) {
    return [];
  }

  const walked: File[] = [];

  for (const item of Array.from(dataTransfer.items ?? [])) {
    const entry = entryOf(item);

    if (entry) {
      await collectEntry(entry, walked);
    }
  }

  if (walked.length > 0) {
    return walked;
  }

  // Never send a 0-byte directory placeholder — that is the "Failed to fetch"
  // path when someone drops a folder on Chromium.
  return Array.from(dataTransfer.files ?? []).filter((file) => file.size > 0 || file.type !== '');
}
