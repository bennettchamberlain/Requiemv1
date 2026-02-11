import { Injectable } from '@nestjs/common';

import { LoggerService } from '@ci/common/logging';
import { OnEvent } from '@ci/domains/events';

import { FileUploadedEvent, FileCreatedPayload } from '../events';

@Injectable()
export class ThumbnailGenerationListener {
  constructor(private readonly logger: LoggerService) {
    this.logger.setContext(ThumbnailGenerationListener.name);
  }

  @OnEvent(FileUploadedEvent, { queue: 'thumbnail-generation' })
  async generateThumbnail(payload: FileCreatedPayload) {
    this.logger.log(`Handled thumbnail generation for file ${payload.fileId}`);
  }
}
