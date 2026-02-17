import { Injectable } from '@nestjs/common';

import { LoggerService } from '@ci/common/logging';
import { FileService } from '@ci/domains/files';

@Injectable()
export class FacebookPromotionUtils {
  constructor(
    private readonly fileService: FileService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(FacebookPromotionUtils.name);
  }

  async downloadAndSaveFile(
    url: string,
    externalId: string,
    userId: string,
    connectionId: string,
    mediaType: 'image' | 'video',
    filename: string,
  ): Promise<{ id: string; contentType: string } | null> {
    try {
      // Download the file
      const response = await fetch(url);
      if (!response.ok) {
        this.logger.error('Failed to download file', {
          url,
          status: response.status,
          statusText: response.statusText,
        });

        return null;
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      const contentType =
        response.headers.get('content-type') || (mediaType === 'image' ? 'image/jpeg' : 'video/mp4');

      const fileHash = await this.fileService.getFileHash({ buffer });
      const existingFile = fileHash ? await this.fileService.findByHash({ userId }, fileHash) : null;

      const fileExtension = this.getFileExtension(contentType, url);
      const fullFilename = filename.includes('.') ? filename : `${filename}.${fileExtension}`;

      if (existingFile) {
        return {
          id: existingFile.id,
          contentType: existingFile.contentType,
        };
      }

      const file = await this.fileService.upload(
        { userId },
        {
          filename: fullFilename,
          contentType,
          size: buffer.length,
          buffer,
        },
      );

      return {
        id: file.id,
        contentType: file.contentType,
      };
    } catch (error) {
      this.logger.error('Error downloading and saving file', {
        url,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      return null;
    }
  }

  getFileExtension(contentType: string, url: string): string {
    // Try to get extension from content type
    if (contentType.includes('jpeg') || contentType.includes('jpg')) {
      return 'jpg';
    }

    if (contentType.includes('png')) {
      return 'png';
    }

    if (contentType.includes('gif')) {
      return 'gif';
    }

    if (contentType.includes('webp')) {
      return 'webp';
    }

    if (contentType.includes('mp4')) {
      return 'mp4';
    }

    if (contentType.includes('webm')) {
      return 'webm';
    }

    // Try to get extension from URL
    try {
      const urlObj = new URL(url);
      const pathname = urlObj.pathname;
      const match = pathname.match(/\.([a-zA-Z0-9]+)$/);
      if (match) {
        return match[1].toLowerCase();
      }
    } catch {
      // Invalid URL, continue
    }

    // Default based on media type
    return 'jpg';
  }

  getBestImageSource(photo: {
    images?: Array<{ height: number; width: number; source: string }>;
    picture?: string;
    link?: string;
  }): string | null {
    if (!photo.images || photo.images.length === 0) {
      return photo.picture || photo.link || null;
    }

    // Sort by width * height to get the largest image
    const sortedImages = [...photo.images].sort((a, b) => b.width * b.height - a.width * a.height);

    return sortedImages[0]?.source || photo.picture || photo.link || null;
  }
}
