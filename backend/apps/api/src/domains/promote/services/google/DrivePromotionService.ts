import { Injectable } from '@nestjs/common';

import { LoggerService } from '@ci/common/services';
import { EventService, Events } from '@ci/domains/events';
import { FileService } from '@ci/domains/files';
import { ContentService, type CreateContentDto } from '@ci/domains/memory';

interface DriveFile {
  id?: string;
  name?: string;
  mimeType?: string;
  modifiedTime?: string;
  owners?: Array<{
    displayName?: string;
    emailAddress?: string;
  }>;
  iconLink?: string;
  webViewLink?: string;
  size?: string;
}

@Injectable()
export class DrivePromotionService {
  private logger = new LoggerService(DrivePromotionService.name);

  constructor(
    private readonly contentService: ContentService,
    private readonly fileService: FileService,
    private readonly eventService: EventService,
  ) {}

  async promoteDriveData(apiLogContent: unknown, userId: string, connectionId: string): Promise<void> {
    this.logger.log('Starting Drive data promotion', {
      userId,
      connectionId,
    });

    try {
      const files = this.extractDriveFiles(apiLogContent);

      if (files.length === 0) {
        this.logger.log('No Drive files found to promote', { userId, connectionId });

        return;
      }

      this.logger.log(`Processing ${files.length} Drive files`, {
        userId,
        connectionId,
        fileCount: files.length,
      });

      for (const file of files) {
        try {
          await this.processDriveFile(file, userId, connectionId);
        } catch (error) {
          this.logger.error('Error processing Drive file', {
            fileId: file.id,
            fileName: file.name,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }

      this.logger.log('Drive data promotion completed', {
        userId,
        connectionId,
        processedCount: files.length,
      });
    } catch (error) {
      this.logger.error('Error promoting Drive data', {
        userId,
        connectionId,
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      });
      throw error;
    }
  }

  private extractDriveFiles(content: unknown): DriveFile[] {
    if (!content || typeof content !== 'object') {
      return [];
    }

    const contentObj = content as Record<string, unknown>;

    if ('files' in contentObj && Array.isArray(contentObj.files)) {
      return contentObj.files as DriveFile[];
    }

    return [];
  }

  private async processDriveFile(file: DriveFile, userId: string, connectionId: string): Promise<void> {
    const fileId = file.id || 'unknown';
    const fileName = file.name || 'Untitled File';
    const mimeType = file.mimeType || 'application/octet-stream';
    const webViewLink = file.webViewLink || null;

    if (mimeType === 'application/vnd.google-apps.folder') {
      this.logger.debug('Skipping Google Drive folder', {
        userId,
        connectionId,
        fileId,
        fileName,
      });

      return;
    }

    await this.fileService.upsertExternal(
      { userId },
      {
        externalId: fileId,
        provider: 'google_drive',
        filename: fileName,
        mimeType,
        url: webViewLink,
        size: file.size ?? null,
        modifiedAt: file.modifiedTime ?? null,
        storageAccount: file.owners?.[0]?.emailAddress ?? null,
      },
    );

    if (this.isDocumentType(mimeType)) {
      const contentDto = {
        id: '',
        type: 'google_drive_document',
        title: fileName,
        text: `Google Drive document: ${fileName}`,
        url: webViewLink ?? undefined,
        mimetype: mimeType,
        external_id: fileId,
        // event_id omitted because no value is available
        user: { id: userId },
      };

      const createdContent = await this.contentService.create({ userId }, contentDto as CreateContentDto);
      const contentRecord = Array.isArray(createdContent) ? createdContent[0] : createdContent;
      const contentId = contentRecord?.id ?? fileId;
      await this.enqueueContentEmbedding(userId, contentId, this.buildContentSearchText(contentDto));
    }

    this.logger.log('Processed Drive file', {
      userId,
      connectionId,
      fileId,
      fileName,
      mimeType,
    });
  }

  private async enqueueContentEmbedding(ownerId: string, contentId: string, searchContent: string | null) {
    if (!searchContent || searchContent.trim().length === 0) {
      return;
    }

    try {
      await this.eventService.send(Events.SEARCH_EMBED_CONTENT, {
        ownerId,
        contentId,
        text: searchContent,
      });
    } catch (error) {
      this.logger.error('Failed to enqueue Drive content embedding', {
        ownerId,
        contentId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private buildContentSearchText(contentDto: CreateContentDto): string | null {
    const parts = new Set<string>();
    const push = (value: unknown) => {
      if (typeof value !== 'string') {
        return;
      }

      const normalized = value.trim();
      if (normalized.length === 0) {
        return;
      }

      parts.add(normalized);
    };

    push(contentDto.title ?? null);
    push((contentDto as { text?: string }).text ?? null);
    push(contentDto.mimetype ?? null);
    push(contentDto.url ?? null);

    if (parts.size === 0) {
      return null;
    }

    return Array.from(parts).join(' ');
  }

  private isDocumentType(mimeType: string): boolean {
    const documentTypes = [
      'application/vnd.google-apps.document',
      'application/vnd.google-apps.spreadsheet',
      'application/vnd.google-apps.presentation',
      'application/vnd.google-apps.form',
      'application/vnd.google-apps.drawing',
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'text/plain',
      'text/html',
      'text/markdown',
    ];

    return documentTypes.includes(mimeType);
  }
}
