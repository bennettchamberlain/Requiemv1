import { createWriteStream, promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { Injectable } from '@nestjs/common';
import ffmpeg from 'fluent-ffmpeg';
import sharp from 'sharp';

import { toServiceContext, UserServiceContext } from '@ci/common/context';
import { LoggerService } from '@ci/common/logging';
import { OnEvent, EventService } from '@ci/domains/events';

import { type File } from '../entities/FileEntity';
import { FileUploadedEvent, FileUploadedPayload, PreviewGeneratedEvent } from '../events';
import { FileService } from '../services/FileService';
import { MediaDimensions, MediaDimensionsService } from '../services/MediaDimensionsService';
import { FileVariant } from '../types';

const PREVIEW_MAX_DIMENSION = 300;
const IMAGE_MIME_PREFIX = 'image/';
const VIDEO_MIME_PREFIX = 'video/';

/**
 * A generated preview plus the dimensions of both the rendered preview JPEG
 * (always known; stored on the PREVIEW row so the FE has intrinsic sizes for
 * `<img>` aspect-ratio) and the source media (`null` if unreadable; backfilled
 * onto the ORIGINAL row).
 */
interface PreviewResult {
  buffer: Buffer;
  previewDimensions: MediaDimensions;
  sourceDimensions: MediaDimensions | null;
}

@Injectable()
export class FilePreviewGenerationListener {
  constructor(
    private readonly fileService: FileService,
    private readonly mediaDimensionsService: MediaDimensionsService,
    private readonly eventService: EventService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(FilePreviewGenerationListener.name);
  }

  @OnEvent(FileUploadedEvent, { queue: 'file-preview-generation' })
  async generatePreview(payload: FileUploadedPayload) {
    const context = toServiceContext({ userId: payload.userId });

    const existingPreview = await this.fileService.findVariantByParentId(
      context,
      payload.fileId,
      FileVariant.PREVIEW,
    );

    if (existingPreview) {
      this.logger.log('Preview already exists, skipping generation', {
        fileId: payload.fileId,
        previewId: existingPreview.id,
      });

      return;
    }

    const file = await this.fileService.findById(context, payload.fileId);

    if (file == null) {
      this.logger.warn('File not found, skipping preview generation', {
        fileId: payload.fileId,
      });

      return;
    }

    if (file.bucket == null || file.key == null) {
      this.logger.log('File is not stored locally, skipping generation', {
        fileId: file.id,
      });

      return;
    }

    const fileWithKey = file as RequiredFields<typeof file, 'key', true>;

    let result: PreviewResult | null = null;

    if (file.contentType.startsWith(IMAGE_MIME_PREFIX)) {
      result = await this.generateImagePreview(context, fileWithKey);
    } else if (file.contentType.startsWith(VIDEO_MIME_PREFIX)) {
      result = await this.generateVideoPreview(context, fileWithKey);
    } else {
      this.logger.log('File type not supported, skipping preview generation', {
        fileId: payload.fileId,
        contentType: file.contentType,
      });

      return;
    }

    if (result == null) {
      // The generators return null for input they cannot decode; they have
      // already logged the file id, content type and the underlying libvips
      // message. The job completes so the file is not retried forever.
      this.logger.warn('No preview generated, skipping', {
        fileId: payload.fileId,
        contentType: file.contentType,
      });

      return;
    }

    // Record the source's intrinsic dimensions onto the ORIGINAL row so
    // EventMediaLoader (and the drawer "Dimensions" row) can surface them. A
    // targeted write that doesn't re-trigger preview generation or re-indexing.
    if (result.sourceDimensions != null) {
      await this.fileService.setDimensions(context, file.id, result.sourceDimensions);
    }

    const preview = await this.fileService.create(context, {
      contentType: 'image/jpeg',
      size: result.buffer.length,
      // Always known — captured from sharp's resolveWithObject. Lets the FE
      // thumbnail loader size the slot before the image decodes.
      width: result.previewDimensions.width,
      height: result.previewDimensions.height,
      variant: FileVariant.PREVIEW,
      buffer: result.buffer,
      parentId: file.id,
    });

    await this.eventService.send(PreviewGeneratedEvent, {
      userId: payload.userId,
      previewId: preview.id,
      model: payload.model,
      skipDescription: payload.skipDescription,
    });

    this.logger.log('Generated preview', {
      fileId: payload.fileId,
      previewId: preview.id,
    });
  }

  private async generateImagePreview(
    context: UserServiceContext,
    file: RequiredFields<File, 'key', true>,
  ): Promise<PreviewResult | null> {
    // Buffer the original once so the dimensions probe and the resize read the
    // same bytes (one object-storage fetch, and metadata is reliable on a
    // Buffer where it isn't on a partially-consumed stream).
    //
    // Deliberately OUTSIDE the try below: an object-storage read failure is
    // transient and worth the queue's retries, a decode failure is not. Same
    // split MediaDimensionsStage makes between `object_storage_read_failed`
    // (retry) and `probe_failed` (skip).
    const original = Buffer.from(await this.fileService.getFileContent(context, file.key));

    const sourceDimensions = await this.mediaDimensionsService.fromImageBuffer(original);

    // .rotate() (no args) reads EXIF orientation, rotates the pixels, and
    // strips the tag. Must come before .resize() so the resize box applies to
    // the *display* orientation, not the stored one. Without this the JPEG
    // bytes are saved as-is and browsers don't reliably honour the tag on
    // derivative JPEGs — photos come back upside-down or sideways.
    //
    // failOn: 'error' (not the 'warning' default): real phone JPEGs — Samsung
    // above all — routinely trip warning-level libjpeg quirks ("Corrupt JPEG
    // data: N extraneous bytes before marker 0xdN", "Invalid SOS parameters
    // for sequential JPEG") that every mainstream viewer decodes fine; the
    // default turned them into failed preview jobs (~8% of a sampled Takeout
    // batch). Verified against an independent decoder that the tolerant decode
    // is artifact-free.
    try {
      const { data, info } = await sharp(original, { failOn: 'error' })
        .rotate()
        .resize(PREVIEW_MAX_DIMENSION, PREVIEW_MAX_DIMENSION, {
          fit: 'inside',
        })
        .jpeg({
          quality: 80,
        })
        .toBuffer({ resolveWithObject: true });

      return {
        buffer: data,
        previewDimensions: { width: info.width, height: info.height },
        sourceDimensions,
      };
    } catch (err: unknown) {
      // A decode failure on INTACT bytes is a SKIP; on truncated bytes it is a
      // retry. Routing on the MIME prefix alone means anything labelled image/*
      // reaches sharp, and libvips throws "Input buffer contains unsupported
      // image format" for every byte sequence it has no loader for — a verdict
      // it returns identically for "this format has no loader" and "this read
      // came back short". Those need opposite handling, and the exception alone
      // cannot tell them apart.
      //
      // `file.size` is the recorded length at upload, so comparing it against
      // what we just read is the discriminator. It matters here specifically:
      // the 32 dead letters that motivated this fix turned out to be COMPLETE,
      // valid JPEGs that decode cleanly today, i.e. the failures were transient
      // and the retries were the only recovery they ever had. Skipping on the
      // first attempt would have removed it.
      const expected = file.size;
      const truncated = expected != null && expected > 0 && original.length !== expected;

      if (truncated) {
        this.logger.warn('Image decode failed on a short read; retrying', {
          fileId: file.id,
          contentType: file.contentType,
          bytes: original.length,
          expectedBytes: expected,
          error: errorMessage(err),
        });

        throw err;
      }

      // Intact and still undecodable: the format genuinely has no loader.
      // Returning null lands in the `result == null` branch of generatePreview:
      // logged, job completes. fileId + contentType are on the warn line so the
      // undecodable corpus is countable from the logs (`grep 'Image decode
      // failed'`), which is what tells us whether a whole format is missing a
      // loader rather than a few odd files.
      //
      // The dimensions probe above already succeeded on these bytes more often
      // than not (MediaDimensionsService uses its own tolerant path), so persist
      // what it found before giving up — it is free, already in hand, and the
      // drawer's "Dimensions" row is the one thing a preview-less file can still
      // show. The caller only reaches setDimensions on the success path.
      if (sourceDimensions != null) {
        await this.fileService.setDimensions(context, file.id, sourceDimensions);
      }

      this.logger.warn('Image decode failed, skipping preview generation', {
        fileId: file.id,
        contentType: file.contentType,
        bytes: original.length,
        error: errorMessage(err),
      });

      return null;
    }
  }

  private async generateVideoPreview(
    context: UserServiceContext,
    file: RequiredFields<File, 'key', true>,
  ): Promise<PreviewResult | null> {
    const stream = await this.fileService.getFileStream(context, file.key);
    const tempInput = join(tmpdir(), `ci-preview-${crypto.randomUUID()}`);
    const tempOutput = `${tempInput}-frame.jpg`;

    try {
      // Write stream to temp file so ffmpeg can seek (required for most video containers)
      await new Promise<void>((resolve, reject) => {
        const ws = createWriteStream(tempInput);
        stream.pipe(ws);
        stream.on('error', (err) => reject(err));
        ws.on('finish', () => resolve());
        ws.on('error', (err) => reject(err));
      });

      // Probe the source stream's dimensions from the same spooled file, before
      // collapsing it to a single frame.
      const sourceDimensions = await this.mediaDimensionsService.fromVideoFile(tempInput);

      // Extract a single frame. Classified the same way the image path is: a
      // container or codec ffmpeg cannot decode is a FORMAT gap — retrying it
      // three times and dead-lettering buys nothing — while the spool above and
      // the read below are IO and stay retryable, so they deliberately sit
      // outside this catch.
      try {
        await new Promise<void>((resolve, reject) => {
          ffmpeg(tempInput)
            .frames(1)
            .output(tempOutput)
            .on('end', () => resolve())
            .on('error', (err: Error) => reject(err))
            .run();
        });
      } catch (err: unknown) {
        this.logger.warn('Video frame extraction failed, skipping preview generation', {
          fileId: file.id,
          contentType: file.contentType,
          error: errorMessage(err),
        });

        // Dimensions survive a failed frame extract — fromVideoFile read them
        // off the spooled container above and returns null rather than throwing.
        if (sourceDimensions != null) {
          await this.fileService.setDimensions(context, file.id, sourceDimensions);
        }

        return null;
      }

      const frame = await fs.readFile(tempOutput);

      // ffmpeg already auto-rotates the extracted frame, so .rotate() is a
      // safety net for any orientation tag still on the JPEG bytes. Same
      // failOn: 'error' tolerance as the image path, and the same
      // skip-don't-throw contract: an undecodable extracted frame is a file
      // we cannot preview, not a job worth retrying three times and
      // dead-lettering.
      try {
        const { data, info } = await sharp(frame, { failOn: 'error' })
          .rotate()
          .resize(PREVIEW_MAX_DIMENSION, PREVIEW_MAX_DIMENSION, {
            fit: 'inside',
          })
          .jpeg({ quality: 80 })
          .toBuffer({ resolveWithObject: true });

        return {
          buffer: data,
          previewDimensions: { width: info.width, height: info.height },
          sourceDimensions,
        };
      } catch (err: unknown) {
        this.logger.warn('Video frame decode failed, skipping preview generation', {
          fileId: file.id,
          contentType: file.contentType,
          bytes: frame.length,
          error: errorMessage(err),
        });

        if (sourceDimensions != null) {
          await this.fileService.setDimensions(context, file.id, sourceDimensions);
        }

        return null;
      }
    } finally {
      await fs.unlink(tempInput).catch(() => {});
      await fs.unlink(tempOutput).catch(() => {});
    }
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
