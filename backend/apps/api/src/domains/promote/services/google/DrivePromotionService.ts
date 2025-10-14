import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v7 as uuid7 } from 'uuid';

import { LoggerService } from '@ci/common/services';
import { ContentService, GraphUtilityService } from '@ci/domains/memory';
import { CreateContentDto } from '@ci/domains/memory/types';
import { UserEntity } from '@ci/domains/user';

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
    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,
    private readonly contentService: ContentService,
    private readonly graphUtilityService: GraphUtilityService,
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
    const webViewLink = file.webViewLink || '';

    // Get user's entity ID (create if missing)
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      this.logger.warn('User not found, skipping file', { userId, fileId });

      return;
    }

    let userEntityId = user.entityId;
    if (!userEntityId) {
      userEntityId = await this.ensureUserHasEntity(user);
    }

    // Determine if this is a document, folder, or other file type
    const isDocument = this.isDocumentType(mimeType);
    const isFolder = mimeType === 'application/vnd.google-apps.folder';

    // Create file entity
    const fileEntityId = uuid7();
    const entityType = isFolder ? 'Folder' : isDocument ? 'Document' : 'File';

    await this.graphUtilityService.createGraphNode({
      entityId: fileEntityId,
      entityType,
      name: fileName,
      description: `Google Drive ${entityType.toLowerCase()}: ${fileName}`,
      properties: {
        file_id: fileId,
        mime_type: mimeType,
        url: webViewLink,
        platform: 'google_drive',
        size: file.size ? parseInt(file.size, 10) : null,
        modified_time: file.modifiedTime,
        icon_link: file.iconLink,
        owner_user_id: userId,
      },
      searchContent: fileName,
      ownerUserId: userId,
    });

    // Create relationship to user
    await this.graphUtilityService.createRelationship(
      userEntityId,
      fileEntityId,
      'OWNS',
      {
        platform: 'google_drive',
        connection_id: connectionId,
        file_type: entityType.toLowerCase(),
      },
      1.0,
      userId,
    );

    // If it's a document type, also save as content for searchability
    if (isDocument) {
      const contentDto = {
        id: '',
        type: 'google_drive_document',
        title: fileName,
        text: `Google Drive document: ${fileName}`,
        url: webViewLink,
        mimetype: mimeType,
        external_id: fileId,
        user: { id: userId },
      };

      await this.contentService.create({ userId }, contentDto as CreateContentDto);
    }

    // If file has owners different from user, create Person entities for them
    if (file.owners && file.owners.length > 0) {
      for (const owner of file.owners) {
        if (owner.emailAddress) {
          try {
            // Create owner as person entity
            const ownerEntityId = uuid7();
            await this.graphUtilityService.createGraphNode({
              entityId: ownerEntityId,
              entityType: 'Person',
              name: owner.displayName || owner.emailAddress,
              description: `Google Drive file owner`,
              properties: {
                email: owner.emailAddress,
                display_name: owner.displayName,
                source: 'google_drive',
                owner_user_id: userId,
              },
              searchContent: `${owner.displayName || ''} ${owner.emailAddress}`,
              ownerUserId: userId,
            });

            // Create relationship: owner CREATED file
            await this.graphUtilityService.createRelationship(
              ownerEntityId,
              fileEntityId,
              'CREATED',
              {
                platform: 'google_drive',
                connection_id: connectionId,
              },
              1.0,
              userId,
            );

            // Create relationship: user KNOWS owner
            await this.graphUtilityService.createRelationship(
              userEntityId,
              ownerEntityId,
              'KNOWS',
              {
                platform: 'google_drive',
                context: 'file_sharing',
              },
              1.0,
              userId,
            );
          } catch (error) {
            this.logger.warn('Failed to create owner entity', {
              ownerEmail: owner.emailAddress,
              error: error instanceof Error ? error.message : 'Unknown error',
            });
          }
        }
      }
    }

    this.logger.log('Processed Drive file', {
      fileId,
      fileName,
      entityType,
    });
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

  /**
   * Ensure a user has an entity in the graph
   * Creates one if it doesn't exist (for legacy users)
   */
  private async ensureUserHasEntity(user: UserEntity): Promise<string> {
    const entityId = uuid7();
    const nameParts = (user.name ?? '').trim().split(/\s+/).filter(Boolean);
    const [firstName, ...restName] = nameParts;

    const properties: Record<string, unknown> = {
      email: user.email,
      owner_user_id: user.id,
    };

    if (firstName) {
      properties.first_name = firstName;
    }

    if (restName.length > 0) {
      properties.last_name = restName.join(' ');
    }

    await this.graphUtilityService.createGraphNode({
      entityId,
      entityType: 'Person',
      name: user.name || user.email,
      description: `User: ${user.name || user.email}`,
      properties,
      searchContent: `${user.name || ''} ${user.email}`,
      linkedTable: 'users',
      linkedId: user.id,
      ownerUserId: user.id,
    });

    // Update the user record with the new entity ID
    await this.userRepository.update(user.id, { entityId });

    this.logger.log('Created entity for legacy user', {
      userId: user.id,
      entityId,
    });

    return entityId;
  }
}
