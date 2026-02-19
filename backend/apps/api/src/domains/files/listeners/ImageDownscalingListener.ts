import { Injectable } from '@nestjs/common';
import sharp from 'sharp';

import { toServiceContext } from '@ci/common/context';
import { LoggerService } from '@ci/common/logging';
import { OnEvent, EventService } from '@ci/domains/events';

import { FileUploadedEvent, FileUploadedPayload, PreviewGeneratedEvent } from '../events';
import { FileService } from '../services/FileService';
import { FileVariant } from '../types';

const PREVIEW_MAX_DIMENSION = 300;
const IMAGE_MIME_PREFIX = 'image/';

@Injectable()
export class ImageDownscalingListener {
  constructor(
    private readonly fileService: FileService,
    private readonly eventService: EventService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(ImageDownscalingListener.name);
  }

  @OnEvent(FileUploadedEvent, { queue: 'image-downscaling' })
  async generatepreview(payload: FileUploadedPayload) {
    const context = toServiceContext({ userId: payload.userId });

    const existingpreview = await this.fileService.findVariantByParentId(
      context,
      payload.fileId,
      FileVariant.PREVIEW,
    );

    if (existingpreview) {
      this.logger.log('preview already exists, skipping generation', {
        fileId: payload.fileId,
        previewId: existingpreview.id,
      });

      return;
    }

    const file = await this.fileService.findById(context, payload.fileId);

    if (!file.contentType.startsWith(IMAGE_MIME_PREFIX)) {
      this.logger.log('File is not an image, skipping generation', {
        fileId: payload.fileId,
        contentType: file.contentType,
      });

      return;
    }

    if (file.bucket == null || file.key == null) {
      this.logger.warn('File is not stored locally, skipping generation', {
        fileId: payload.fileId,
      });

      return;
    }

    const stream = await this.fileService.getFileStream(context, file.key);

    const transformer = sharp()
      .resize(PREVIEW_MAX_DIMENSION, PREVIEW_MAX_DIMENSION, {
        fit: 'inside',
      })
      .jpeg({
        quality: 80,
      });

    stream.pipe(transformer);

    const buffer = await transformer.toBuffer();

    const preview = await this.fileService.create(context, {
      contentType: 'image/jpeg',
      size: buffer.length,
      variant: FileVariant.PREVIEW,
      buffer,
      parentId: file.id,
    });

    await this.eventService.send(PreviewGeneratedEvent, {
      userId: payload.userId,
      previewId: preview.id,
      model: payload.model,
    });

    this.logger.log('Generated preview', {
      fileId: payload.fileId,
      previewId: preview.id,
    });
  }
}
