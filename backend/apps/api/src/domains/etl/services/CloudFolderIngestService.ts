import { createWriteStream } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { Injectable } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';

import { LoggerService } from '@ci/common/logging';
import { DropboxClient, type Connection } from '@ci/domains/connections';
import { FileService } from '@ci/domains/files';
import {
  ImportRunService,
  recognizeListingRoots,
  sanitizeFilename,
  StagedSourceService,
  uploadsRoot,
} from '@ci/domains/import';

import type { CloudFolderExport } from '../entities/CloudFolderExportEntity';

import { DROPBOX_PROVIDER } from './CloudFileIngestService';
import { CloudFolderExportLedgerService } from './CloudFolderExportLedgerService';
import { dropboxWebLink } from './Dropbox/dropboxWebLink';

/** How deep under the drive's root an export folder may sit. Meta's is four down. */
const EXPORT_ROOT_MAX_DEPTH = 10;

/** Files fetched at once while downloading a folder. */
const DOWNLOAD_CONCURRENCY = 4;

/** Heartbeat the ledger row every this many files, so a long download is not taken for dead. */
const HEARTBEAT_EVERY_FILES = 25;

/** A stream or fetch failure is not always an `Error` of this realm; keep whatever it says. */
function errorMessage(error: unknown): string {
  const message = (error as { message?: unknown } | null)?.message;

  return typeof message === 'string' && message ? message : String(error);
}

/** A file as a sync listing describes it, reduced to what folder handling needs. */
export interface CloudListedFile {
  /** The provider's normalized path (Dropbox: `path_lower`), with a leading slash. */
  path: string;
}

/** One file of an export folder, as listed fresh at download time. */
interface FolderFile {
  id: string;
  /** Path relative to the export folder, in the provider's display casing. */
  relativePath: string;
  size: number;
  /** The pointer row a sync may have written for this file before the folder was recognised. */
  pointerExternalId: string | null;
}

/** The provider-specific half: how to list a folder and fetch a file. */
interface CloudFolderSource {
  provider: string;
  label: string;
  list(rootPath: string): Promise<FolderFile[]>;
  download(fileId: string): Promise<Response>;
}

interface DropboxEntry {
  '.tag': string;
  id: string;
  name: string;
  path_display?: string;
  path_lower?: string;
  size?: number;
}

/**
 * Data exports that sit in a cloud drive as a FOLDER of loose files.
 *
 * Meta's "transfer a copy of your information" writes a Facebook export into
 * Dropbox this way — hundreds or thousands of individual files under
 * `/Apps/Meta/meta-<date>/facebook-<user>-<date>-<id>/`, written a few at a
 * time over the better part of an hour. Handled file by file they would each
 * become a pointer row and the export would never be imported; and the folder
 * cannot be imported until it is whole, or its media arrives with no message
 * or post to attach to.
 *
 * So, in three steps spread over several sync ticks:
 *
 *  1. {@link claimFiles} — as a sync lists files, the folders an importer
 *     recognises (the same recognisers a zip's listing is run past, see
 *     recognizeListingRoots) are recorded, and their files are withheld from
 *     ordinary per-file handling.
 *  2. The folder waits until no sync has seen it change for FOLDER_SETTLE_MS.
 *  3. {@link ingestSettled} — the whole folder is downloaded into one drop,
 *     structure intact, and handed to the import pipeline as ONE run, exactly
 *     as if the person had dropped that folder on the import page.
 *
 * Dropbox is the only provider wired today. Drive needs its files' folder
 * paths first: its listing reports names and parent ids, not paths.
 */
@Injectable()
export class CloudFolderIngestService {
  constructor(
    private readonly dropboxClient: DropboxClient,
    private readonly stagedSources: StagedSourceService,
    private readonly importRuns: ImportRunService,
    private readonly fileService: FileService,
    private readonly ledger: CloudFolderExportLedgerService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(CloudFolderIngestService.name);
  }

  /**
   * Which of these freshly listed Dropbox files belong to an export folder —
   * one already known, or one recognised just now from this listing. The
   * caller leaves those files alone; everything else is an ordinary file.
   *
   * Recognition failing is not a reason to fail the sync: the files are then
   * simply treated as ordinary ones, as they were before this existed.
   */
  async claimDropboxFiles<T extends CloudListedFile>({
    connection,
    userId,
    files,
  }: {
    connection: Connection;
    userId: string;
    files: T[];
  }): Promise<Set<T>> {
    const key = { connectionId: connection.id, provider: DROPBOX_PROVIDER };
    const claimed = new Set<T>();

    if (files.length === 0) {
      return claimed;
    }

    try {
      const importersByRoot = new Map<string, string[]>();
      for (const known of await this.ledger.listForConnection({ userId }, key)) {
        importersByRoot.set(known.rootPath, known.importers);
      }

      const under = (root: string, file: T): boolean => file.path.startsWith(`${root}/`);
      const unclaimed = files.filter(
        (file) => ![...importersByRoot.keys()].some((root) => under(root, file)),
      );

      if (unclaimed.length > 0) {
        const recognised = await recognizeListingRoots(
          unclaimed.map((file) => file.path),
          { maxDepth: EXPORT_ROOT_MAX_DEPTH },
        );

        for (const { root, importers } of recognised) {
          // `''` would be the person's entire Dropbox. No export is written
          // there, and treating it as one would download everything they own.
          if (root !== '') {
            importersByRoot.set(`/${root}`, importers);
          }
        }
      }

      for (const [root, importers] of importersByRoot) {
        const members = files.filter((file) => under(root, file));

        if (members.length === 0) {
          continue;
        }

        await this.ledger.recordChange({ userId }, { ...key, rootPath: root, importers });
        members.forEach((file) => claimed.add(file));
      }
    } catch (error) {
      this.logger.warn('Could not check Dropbox files for export folders; treating them as ordinary files', {
        connectionId: connection.id,
        error: errorMessage(error),
      });

      return new Set<T>();
    }

    return claimed;
  }

  /**
   * Download every export folder of this connection that has settled, and
   * start an import run for each. Resolves when they have all finished, and
   * never rejects.
   *
   * The SYNC does not await this: a full export with media is thousands of
   * files and can outlast the sync job that noticed it, so the transform
   * starts it and moves on. A download that dies with the process is picked
   * up again by a later tick (see FOLDER_DOWNLOAD_STALE_MS).
   */
  async ingestSettledDropboxFolders({
    connection,
    userId,
  }: {
    connection: Connection;
    userId: string;
  }): Promise<void> {
    const key = { connectionId: connection.id, provider: DROPBOX_PROVIDER };
    let ready: CloudFolderExport[];

    try {
      ready = await this.ledger.claimSettled({ userId }, key);
    } catch (error) {
      this.logger.warn('Could not check for settled Dropbox export folders', {
        connectionId: connection.id,
        error: errorMessage(error),
      });

      return;
    }

    const source = this.dropboxSource(connection);

    await Promise.all(ready.map((folder) => this.ingestFolder(source, userId, folder)));
  }

  private dropboxSource(connection: Connection): CloudFolderSource {
    return {
      provider: DROPBOX_PROVIDER,
      label: 'Dropbox',
      list: async (rootPath) => {
        const files: FolderFile[] = [];
        let page = await this.dropboxClient.rpc<{
          entries: DropboxEntry[];
          cursor: string;
          has_more: boolean;
        }>(connection, '/2/files/list_folder', {
          path: rootPath,
          recursive: true,
          include_deleted: false,
          include_non_downloadable_files: false,
        });

        for (;;) {
          for (const entry of page.entries) {
            if (
              entry['.tag'] !== 'file' ||
              !entry.path_display ||
              !entry.path_lower?.startsWith(`${rootPath}/`)
            ) {
              continue;
            }

            files.push({
              id: entry.id,
              // Same length as path_lower, so the root's length cuts the
              // display path at the same place.
              relativePath: entry.path_display.slice(rootPath.length + 1),
              size: entry.size ?? 0,
              pointerExternalId: dropboxWebLink(entry),
            });
          }

          if (!page.has_more) {
            return files;
          }

          page = await this.dropboxClient.rpc(connection, '/2/files/list_folder/continue', {
            cursor: page.cursor,
          });
        }
      },
      download: (fileId) => this.dropboxClient.download(connection, fileId),
    };
  }

  /** Download one claimed folder and start its import run. Never throws. */
  private async ingestFolder(
    source: CloudFolderSource,
    userId: string,
    folder: CloudFolderExport,
  ): Promise<void> {
    // The claim stamped updated_at; anything a sync sees change after that
    // moment is something this download may have missed.
    const claimedAt = new Date();
    const dropId = uuidv7();
    const dropDir = path.join(uploadsRoot(), dropId);
    const folderName = sanitizeFilename(path.posix.basename(folder.rootPath)) || 'export';
    const exportDir = path.join(dropDir, folderName);

    try {
      const files = await source.list(folder.rootPath);

      if (files.length === 0) {
        throw new Error('the folder is empty');
      }

      await mkdir(exportDir, { recursive: true });

      let byteSize = 0;
      let done = 0;
      const queue = [...files];

      const worker = async (): Promise<void> => {
        for (let file = queue.shift(); file; file = queue.shift()) {
          // Not `byteSize += await …`: that reads the total BEFORE the await,
          // and with several workers each would overwrite the others' sums.
          const written = await this.downloadFile(source, exportDir, file);

          byteSize += written;
          done += 1;

          if (done % HEARTBEAT_EVERY_FILES === 0) {
            await this.ledger.heartbeat(folder.id);
          }
        }
      };

      await Promise.all(Array.from({ length: DOWNLOAD_CONCURRENCY }, worker));

      await this.stagedSources.registerUpload(
        { userId },
        {
          dropId,
          sourcePath: exportDir,
          originalFilename: folderName,
          contentType: 'application/x-directory',
          sizeBytes: byteSize,
          kind: 'directory',
        },
      );

      const { run } = await this.importRuns.startRun(
        { userId },
        {
          dropId,
          label: folderName,
          source: 'connections',
          declaredSources: folder.importers,
          originPlatform: source.provider,
          originConnectionId: folder.connectionId,
        },
      );

      await this.ledger.markImported(folder.id, {
        claimedAt,
        fileCount: files.length,
        byteSize,
        dropId,
        importRunId: run.id,
      });

      // Files of this folder that a sync listed before the folder was
      // recognised were written as ordinary pointer rows. The import run now
      // owns them.
      const pointers = files.map((file) => file.pointerExternalId).filter((id): id is string => id != null);
      const removed = await this.fileService.removePointersByExternalIds({ userId }, pointers).catch(() => 0);

      this.logger.log(`Downloaded a ${source.label} export folder and started an import run for it`, {
        rootPath: folder.rootPath,
        importers: folder.importers,
        fileCount: files.length,
        byteSize,
        dropId,
        runId: run.id,
        pointerRowsRemoved: removed,
      });
    } catch (error) {
      const reason = errorMessage(error);

      await rm(dropDir, { recursive: true, force: true }).catch(() => undefined);
      await this.ledger.markFailed(folder.id, reason).catch(() => undefined);

      this.logger.warn(`${source.label} export folder download failed; it will be retried`, {
        rootPath: folder.rootPath,
        error: reason,
      });
    }
  }

  /** Stream one file to its place under `exportDir`; returns the bytes written. */
  private async downloadFile(
    source: CloudFolderSource,
    exportDir: string,
    file: FolderFile,
  ): Promise<number> {
    const target = path.resolve(exportDir, ...file.relativePath.split('/'));

    // The path comes from the provider, not from us. Nothing is written
    // outside the export's own directory, whatever it says.
    if (!target.startsWith(exportDir + path.sep)) {
      throw new Error(`refusing to write outside the export folder: ${file.relativePath}`);
    }

    const response = await source.download(file.id);

    if (!response.ok || response.body == null) {
      throw new Error(
        `${source.label} download of ${file.relativePath} failed: ${response.status} ${response.statusText}`,
      );
    }

    await mkdir(path.dirname(target), { recursive: true });

    let written = 0;

    await pipeline(
      Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]),
      new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          written += chunk.length;
          callback(null, chunk);
        },
      }),
      createWriteStream(target),
    );

    if (written !== file.size) {
      throw new Error(
        `${source.label} download of ${file.relativePath} ended at ${written} of ${file.size} bytes`,
      );
    }

    return written;
  }
}
