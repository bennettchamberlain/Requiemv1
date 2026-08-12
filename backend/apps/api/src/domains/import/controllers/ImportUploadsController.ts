import { mkdir, rename, unlink } from 'node:fs/promises';
import path from 'node:path';

import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  Logger,
  NotFoundException,
  Param,
  Post,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
  type OnModuleInit,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { v7 as uuidv7 } from 'uuid';

import { Context, type RequestContext } from '@ci/common/context';
import { JwtOrApiKeyAuthGuard } from '@ci/common/guards';
import config from '@ci/configuration';

import { ImportRunService } from '../services/ImportRunService';
import { StagedSourceService } from '../services/StagedSourceService';
import { sanitizeFilename } from '../sources/sanitizeFilename';

/**
 * Ceiling on a single uploaded archive. Real exports are large — Google Takeout
 * splits run 40-50GB — so this is a sanity bound on one file, not a policy about
 * how much someone may import.
 */
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024 * 1024;

/** What the caller gets back per uploaded file. */
export interface DropSummary {
  dropId: string;
  originalFilename: string | null;
  sizeBytes: number | null;
  status: string;
  expiresAt: Date | null;
}

/**
 * Intake for bulk exports: bytes in, a registered staged upload out.
 *
 * Upload and import are deliberately separate steps. The upload lands the
 * archive in the importer's own uploads directory and registers it; nothing is
 * unpacked, recognized or parsed here. That happens later, in the run's
 * `unpack` stage — which MOVES the staged copy into the run's scratch, so the
 * bytes are written once and never copied again — because a 40GB Takeout
 * cannot be expanded inside a request and because the user has not yet said
 * what they want done with it.
 *
 * Starting that import is `POST /import/runs` on {@link ImportRunsController},
 * which owns the run surface. This controller ends at the registered upload.
 */
/** Where multer lands the bytes before they hop into a drop directory. */
function incomingDir(): string {
  return path.join(config.import.uploadsDir, 'incoming');
}

@Controller('import/uploads')
export class ImportUploadsController implements OnModuleInit {
  constructor(
    private readonly sources: StagedSourceService,
    private readonly runs: ImportRunService,
  ) {}

  /**
   * Prepare the incoming directory, best-effort, so the first upload does not
   * pay the mkdir and a misconfigured deployment says so ONCE, legibly, at
   * boot. Never throws: an unwritable uploads directory must cost the upload
   * routes, not take the whole API down with it.
   */
  async onModuleInit(): Promise<void> {
    try {
      await mkdir(incomingDir(), { recursive: true });
    } catch (err: unknown) {
      Logger.warn(
        `The uploads staging directory is not writable (${(err as Error).message}). ` +
          `Uploads will fail until CI_IMPORT_UPLOADS_DIR points somewhere this process can write.`,
        ImportUploadsController.name,
      );
    }
  }

  /**
   * Stage one or more uploaded files.
   *
   * Multer writes to `<uploadsDir>/incoming` rather than a buffer, so a
   * multi-GB upload never sits in the heap — and rather than the OS tmpdir,
   * so the hop into `<uploadsDir>/<dropId>/` is an atomic same-filesystem
   * rename instead of a copy across the container boundary (the uploads dir
   * is a bind mount; `tmpdir()` is not). A crash between multer's write and
   * the rename, or between the rename and the registration, leaves bytes only
   * the orphan sweep can see — which is exactly what the sweep is for.
   *
   * The destination is a FUNCTION, deliberately. Multer given a string `dest`
   * mkdirs it while the class is still being DEFINED, which turns an
   * unwritable directory into a boot failure for the entire API — the
   * importer being unavailable must never cost more than the importer. With a
   * function, the filesystem is first touched when an upload arrives, and a
   * failure is this route's error response.
   */
  @UseGuards(JwtOrApiKeyAuthGuard)
  @Post()
  @UseInterceptors(
    FilesInterceptor('files', undefined, {
      storage: diskStorage({
        destination: (_req, _file, callback) => {
          mkdir(incomingDir(), { recursive: true }).then(
            () => callback(null, incomingDir()),
            (err: Error) => callback(err, incomingDir()),
          );
        },
      }),
      limits: { fileSize: MAX_UPLOAD_BYTES },
    }),
  )
  async upload(
    @Context() context: RequestContext,
    @UploadedFiles() files: Express.Multer.File[],
  ): Promise<DropSummary[]> {
    const userId = requireUserId(context);

    if (!files || files.length === 0) {
      throw new BadRequestException('At least one file is required');
    }

    try {
      const staged: DropSummary[] = [];

      // Sequential, not Promise.all: a multi-part export arriving at once
      // should settle into the registry in a stable order, and there is no
      // wall-clock win to parallel renames on one filesystem.
      for (const file of files) {
        const dropId = uuidv7();
        // The name is attacker-controlled text landing on a real filesystem;
        // sanitizing it is containment, not cosmetics.
        const filename = sanitizeFilename(file.originalname);
        const dropDir = path.join(config.import.uploadsDir, dropId);
        const sourcePath = path.join(dropDir, filename);

        await mkdir(dropDir, { recursive: true });
        await rename(file.path, sourcePath);

        const source = await this.sources.registerUpload(
          { userId },
          {
            dropId,
            sourcePath,
            originalFilename: file.originalname,
            contentType: file.mimetype,
            sizeBytes: file.size,
          },
        );

        staged.push(toSummary(source));
      }

      return staged;
    } finally {
      // On success every file was renamed away and these unlinks no-op; on
      // failure the incoming copies must not sit until the orphan sweep.
      for (const file of files) {
        if (file.path) {
          await unlink(file.path).catch((err: NodeJS.ErrnoException) => {
            if (err.code !== 'ENOENT') {
              Logger.error(`Failed to delete incoming upload ${file.path}`, ImportUploadsController.name);
            }
          });
        }
      }
    }
  }

  /** Uploads still awaiting an import decision. */
  @UseGuards(JwtOrApiKeyAuthGuard)
  @Get()
  async list(@Context() context: RequestContext): Promise<DropSummary[]> {
    const userId = requireUserId(context);
    const uploads = await this.sources.listStagedUploads({ userId });

    return uploads.map(toSummary);
  }

  /**
   * Start importing a staged upload.
   *
   * Provisional, and deliberately minimal: the run surface proper — listing
   * runs, watching stages, cancelling, re-running a failed stage — is the import
   * API's job. This exists so an upload can actually become staged rows without
   * waiting for it, and so the intake path is demonstrable end to end.
   */
  @UseGuards(JwtOrApiKeyAuthGuard)
  @Post(':dropId/start')
  async start(
    @Context() context: RequestContext,
    @Param('dropId') dropId: string,
  ): Promise<{ runId: string; stages: string[] }> {
    const userId = requireUserId(context);
    const { run, stages } = await this.runs.startRun({ userId }, { dropId });

    return { runId: run.id, stages: stages.map((stage) => stage.kind) };
  }

  /**
   * Discard a staged upload and reclaim its bytes, or dismiss an expired
   * tombstone. An upload a run has CLAIMED is refused — deleting bytes out
   * from under a running unpack is a race, not a cleanup; cancel the run
   * instead.
   */
  @UseGuards(JwtOrApiKeyAuthGuard)
  @Delete(':dropId')
  async remove(
    @Context() context: RequestContext,
    @Param('dropId') dropId: string,
  ): Promise<{ released: boolean }> {
    const userId = requireUserId(context);
    const released = await this.sources.releaseUpload({ userId }, dropId);

    if (!released) {
      throw new NotFoundException(`No staged upload ${dropId}`);
    }

    return { released };
  }
}

function requireUserId(context: RequestContext): string {
  if (!context.userId) {
    throw new BadRequestException('An authenticated user is required to stage an upload');
  }

  return context.userId;
}

function toSummary(source: {
  dropId: string | null;
  originalFilename: string | null;
  sizeBytes: number | null;
  status: string;
  expiresAt: Date | null;
}): DropSummary {
  return {
    dropId: source.dropId ?? '',
    originalFilename: source.originalFilename,
    sizeBytes: source.sizeBytes,
    status: source.status,
    expiresAt: source.expiresAt,
  };
}
