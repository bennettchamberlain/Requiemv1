import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import config from '@ci/configuration';

import type { CloudFolderExport } from '../../entities/CloudFolderExportEntity';
import { CloudFolderIngestService } from '../CloudFolderIngestService';

let uploadsDir: string;
let previousUploadsDir: string;

beforeEach(async () => {
  uploadsDir = await mkdtemp(path.join(os.tmpdir(), 'ci-folder-ingest-'));
  previousUploadsDir = config.import.uploadsDir;
  (config.import as { uploadsDir: string }).uploadsDir = uploadsDir;
});

afterEach(() => {
  (config.import as { uploadsDir: string }).uploadsDir = previousUploadsDir;
});

const ROOT = '/apps/meta/meta-2026-oct-05/facebook-user-2026-10-05-abc';
const DISPLAY_ROOT = '/Apps/Meta/meta-2026-oct-05/facebook-user-2026-10-05-abc';

/** The export as Dropbox holds it: display path → contents. */
const REMOTE: Record<string, string> = {
  [`${DISPLAY_ROOT}/your_facebook_activity/messages/inbox/Friends_1/message_1.json`]: '{"messages":[]}',
  [`${DISPLAY_ROOT}/your_facebook_activity/messages/inbox/Friends_1/photos/a.jpg`]: 'jpeg-bytes',
  [`${DISPLAY_ROOT}/your_facebook_activity/posts/your_videos.json`]: '[]',
};

function build(remote: Record<string, string> = REMOTE) {
  const entries = Object.entries(remote).map(([display, body], i) => ({
    '.tag': 'file',
    id: `id:${i}`,
    name: path.posix.basename(display),
    path_display: display,
    path_lower: display.toLowerCase(),
    size: Buffer.byteLength(body),
  }));

  const dropboxClient = {
    rpc: jest.fn(async () => ({ entries, cursor: 'c', has_more: false })),
    download: jest.fn(async (_connection: unknown, fileId: string) => {
      const body = Object.values(remote)[Number(fileId.slice(3))];

      return new Response(body, { status: 200 });
    }),
  };
  const stagedSources = { registerUpload: jest.fn(async () => ({})) };
  const importRuns = { startRun: jest.fn(async () => ({ run: { id: 'run-1' }, stages: [] })) };
  const fileService = { removePointersByExternalIds: jest.fn(async () => 2) };

  const known: CloudFolderExport[] = [];
  const ledger = {
    listForConnection: jest.fn(async () => known),
    recordChange: jest.fn(async () => undefined),
    claimSettled: jest.fn(async (): Promise<CloudFolderExport[]> => []),
    heartbeat: jest.fn(async () => undefined),
    markImported: jest.fn(async () => undefined),
    markFailed: jest.fn(async () => undefined),
  };
  const logger = {
    setContext: jest.fn(),
    log: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
  };

  const service = new CloudFolderIngestService(
    dropboxClient as never,
    stagedSources as never,
    importRuns as never,
    fileService as never,
    ledger as never,
    logger as never,
  );

  return { service, dropboxClient, stagedSources, importRuns, fileService, ledger, known };
}

const connection = { id: 'conn-1', accessToken: 'token' } as never;
const folder = (overrides: Partial<CloudFolderExport> = {}) =>
  ({
    id: 'folder-1',
    userId: 'user-1',
    connectionId: 'conn-1',
    provider: 'dropbox',
    rootPath: ROOT,
    importers: ['facebook'],
    status: 'downloading',
    ...overrides,
  }) as CloudFolderExport;

describe('CloudFolderIngestService.claimDropboxFiles', () => {
  const listed = (paths: string[]) => paths.map((p) => ({ path: p }));

  it('recognises an export folder from the listing and claims only the files inside it', async () => {
    const { service, ledger } = build();
    const files = listed([
      `${ROOT}/your_facebook_activity/messages/inbox/friends_1/message_1.json`,
      `${ROOT}/your_facebook_activity/posts/media/a.jpg`,
      '/camera uploads/2012-07-15 14.50.40.jpg',
      '/keys/ssh/me.pub',
    ]);

    const claimed = await service.claimDropboxFiles({ connection, userId: 'user-1', files });

    expect([...claimed].map((f) => f.path)).toEqual([files[0].path, files[1].path]);
    expect(ledger.recordChange).toHaveBeenCalledTimes(1);
    expect(ledger.recordChange).toHaveBeenCalledWith(
      { userId: 'user-1' },
      { connectionId: 'conn-1', provider: 'dropbox', rootPath: ROOT, importers: ['facebook'] },
    );
  });

  it('claims a file under an already-known folder without needing to recognise it again', async () => {
    const { service, ledger, known } = build();
    known.push(folder({ status: 'imported' }));
    // On its own this path would not be recognised as anything.
    const files = listed([`${ROOT}/late_arrival.jpg`, '/notes.txt']);

    const claimed = await service.claimDropboxFiles({ connection, userId: 'user-1', files });

    expect([...claimed].map((f) => f.path)).toEqual([`${ROOT}/late_arrival.jpg`]);
    // Recorded as a change, which is what sends an imported folder round again.
    expect(ledger.recordChange).toHaveBeenCalledWith(
      { userId: 'user-1' },
      expect.objectContaining({ rootPath: ROOT }),
    );
  });

  it('claims nothing from an ordinary Dropbox', async () => {
    const { service, ledger } = build();

    const claimed = await service.claimDropboxFiles({
      connection,
      userId: 'user-1',
      files: listed(['/camera uploads/a.jpg', '/docs/report.pdf', '/project/messages/readme.md']),
    });

    expect(claimed.size).toBe(0);
    expect(ledger.recordChange).not.toHaveBeenCalled();
  });

  it('never treats the whole Dropbox as one export', async () => {
    const { service, ledger } = build();

    // A Facebook export unpacked straight into the Dropbox root.
    const claimed = await service.claimDropboxFiles({
      connection,
      userId: 'user-1',
      files: listed(['/your_facebook_activity/posts/your_posts_1.json', '/camera uploads/a.jpg']),
    });

    expect(claimed.size).toBe(0);
    expect(ledger.recordChange).not.toHaveBeenCalled();
  });

  it('treats every file as ordinary when the ledger cannot be read', async () => {
    const { service, ledger } = build();
    ledger.listForConnection.mockRejectedValue(new Error('db away'));

    const claimed = await service.claimDropboxFiles({
      connection,
      userId: 'user-1',
      files: listed([`${ROOT}/your_facebook_activity/posts/media/a.jpg`]),
    });

    expect(claimed.size).toBe(0);
  });
});

describe('CloudFolderIngestService.ingestSettledDropboxFolders', () => {
  it('downloads a settled folder with its structure intact and starts ONE run for it', async () => {
    const { service, dropboxClient, stagedSources, importRuns, fileService, ledger } = build();
    ledger.claimSettled.mockResolvedValue([folder()]);

    await service.ingestSettledDropboxFolders({ connection, userId: 'user-1' });

    // Listed fresh from Dropbox at download time, by the folder's own path.
    expect(dropboxClient.rpc).toHaveBeenCalledWith(
      connection,
      '/2/files/list_folder',
      expect.objectContaining({ path: ROOT, recursive: true }),
    );

    const [dropId] = await readdir(uploadsDir);
    const exportDir = path.join(uploadsDir, dropId, 'facebook-user-2026-10-05-abc');

    // Display casing preserved: the importer matches on these names.
    expect(
      await readFile(
        path.join(exportDir, 'your_facebook_activity/messages/inbox/Friends_1/photos/a.jpg'),
        'utf8',
      ),
    ).toBe('jpeg-bytes');
    expect(
      await readFile(path.join(exportDir, 'your_facebook_activity/posts/your_videos.json'), 'utf8'),
    ).toBe('[]');

    const totalBytes = Object.values(REMOTE).reduce((n, body) => n + Buffer.byteLength(body), 0);

    expect(stagedSources.registerUpload).toHaveBeenCalledWith(
      { userId: 'user-1' },
      expect.objectContaining({ dropId, sourcePath: exportDir, kind: 'directory', sizeBytes: totalBytes }),
    );
    expect(importRuns.startRun).toHaveBeenCalledTimes(1);
    expect(importRuns.startRun).toHaveBeenCalledWith(
      { userId: 'user-1' },
      expect.objectContaining({
        dropId,
        source: 'connections',
        declaredSources: ['facebook'],
        originPlatform: 'dropbox',
        originConnectionId: 'conn-1',
      }),
    );
    expect(ledger.markImported).toHaveBeenCalledWith(
      'folder-1',
      expect.objectContaining({ fileCount: 3, byteSize: totalBytes, dropId, importRunId: 'run-1' }),
    );

    // The pointer rows an earlier sync wrote for these files are cleared.
    expect(fileService.removePointersByExternalIds).toHaveBeenCalledWith(
      { userId: 'user-1' },
      expect.arrayContaining([
        'https://www.dropbox.com/home/Apps/Meta/meta-2026-oct-05/facebook-user-2026-10-05-abc/your_facebook_activity/posts?preview=your_videos.json',
      ]),
    );
  });

  it('does nothing when no folder has settled', async () => {
    const { service, dropboxClient, importRuns } = build();

    await service.ingestSettledDropboxFolders({ connection, userId: 'user-1' });

    expect(dropboxClient.rpc).not.toHaveBeenCalled();
    expect(importRuns.startRun).not.toHaveBeenCalled();
  });

  it('gives the folder back for a retry, and leaves nothing on disk, when a file fails to download', async () => {
    const { service, dropboxClient, importRuns, ledger } = build();
    ledger.claimSettled.mockResolvedValue([folder()]);
    dropboxClient.download.mockImplementation(async (_c: unknown, fileId: string) =>
      fileId === 'id:1'
        ? new Response('expired', { status: 401, statusText: 'Unauthorized' })
        : new Response(Object.values(REMOTE)[Number(fileId.slice(3))], { status: 200 }),
    );

    await service.ingestSettledDropboxFolders({ connection, userId: 'user-1' });

    expect(importRuns.startRun).not.toHaveBeenCalled();
    expect(ledger.markImported).not.toHaveBeenCalled();
    expect(ledger.markFailed).toHaveBeenCalledWith('folder-1', expect.stringContaining('401'));
    expect(await readdir(uploadsDir)).toEqual([]);
  });

  it('fails the folder rather than import a file that came up short', async () => {
    const { service, dropboxClient, importRuns, ledger } = build();
    ledger.claimSettled.mockResolvedValue([folder()]);
    dropboxClient.download.mockImplementation(async () => new Response('x', { status: 200 }));

    await service.ingestSettledDropboxFolders({ connection, userId: 'user-1' });

    expect(importRuns.startRun).not.toHaveBeenCalled();
    expect(ledger.markFailed).toHaveBeenCalledWith('folder-1', expect.stringContaining('ended at 1 of'));
  });

  it('refuses a listing entry that would be written outside the export folder', async () => {
    const { service, importRuns, ledger } = build({
      [`${DISPLAY_ROOT}/../../../escape.txt`]: 'x',
    });
    ledger.claimSettled.mockResolvedValue([folder()]);

    await service.ingestSettledDropboxFolders({ connection, userId: 'user-1' });

    expect(importRuns.startRun).not.toHaveBeenCalled();
  });
});
