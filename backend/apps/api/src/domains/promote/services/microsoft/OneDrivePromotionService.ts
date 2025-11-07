import { createHmac } from 'crypto';
import { buffer } from 'node:stream/consumers';

import { Injectable } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';

import { LoggerService } from '@ci/common/services';
import config from '@ci/configuration';
import { ConnectionService } from '@ci/domains/connections';
import { OneDrivePageEntity, OneDriveFileEntity } from '@ci/domains/connections/clients/MicrosoftClient';
import { EventService as DomainEventService, Events } from '@ci/domains/events';
import { FileService } from '@ci/domains/files';
import {
  EventService as MemoryEventService,
  type CreateEventDto,
  MemoryService,
  PersonService,
} from '@ci/domains/memory';

interface RawData {
  data: object;
  syncState: object;
}

interface FileParticipant {
  email: string;
  name: string;
}

interface ExtractedFile {
  id: string;
  startTime: Date;
  participants: FileParticipant[];
  content?: OneDriveFileEntity;
}

@Injectable()
export class OneDrivePromotionService {
  private logger = new LoggerService(OneDrivePromotionService.name);

  constructor(
    private readonly memoryService: MemoryService,
    private readonly eventService: MemoryEventService,
    private readonly personService: PersonService,
    private readonly connectionService: ConnectionService,
    private readonly fileService: FileService,
    private readonly domainEventService: DomainEventService,
  ) {}

  async promoteOneDriveFiles(apiLogContent: unknown, userId: string, connectionId: string): Promise<void> {
    this.logger.log('Starting OneDrive file promotion', {
      userId,
      connectionId,
      contentType: typeof apiLogContent,
      contentKeys: apiLogContent && typeof apiLogContent === 'object' ? Object.keys(apiLogContent) : [],
    });

    try {
      // Extract event ids from the API log content
      const files = this.extractOneDriveFiles(apiLogContent as RawData[]);

      // Get the connection
      const connection = await this.connectionService.findById(connectionId);
      if (!connection || !connection.accessToken) {
        this.logger.error('Connection not found or missing access token', { connectionId });

        return;
      }

      // Process each event individually
      for (const file of files) {
        if (!file.id) {
          this.logger.warn('Skipping event without ID', { file });
          continue;
        }

        // Process the event
        await this.processOneDriveFile(file, userId, connectionId);
      }
    } catch (error) {
      this.logger.error('Error promoting Outlook Calendar events', {
        userId,
        connectionId,
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      });
      throw error;
    }
  }

  private async enqueueEventEmbedding(ownerId: string, eventId: string, searchContent: string | null) {
    if (!searchContent || searchContent.trim().length === 0) {
      return;
    }

    try {
      await this.domainEventService.send(Events.SEARCH_EMBED_EVENT, {
        ownerId,
        eventId,
        searchContent,
      });
    } catch (error) {
      this.logger.error('Failed to enqueue OneDrive event embedding', {
        ownerId,
        eventId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private buildEventSearchContent(fileDetails: ExtractedFile, newEvent: CreateEventDto): string | null {
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

    push(newEvent.title);
    push(fileDetails.content?.name);
    push(fileDetails.content?.file?.mimeType);

    for (const participant of fileDetails.participants) {
      push(participant.name);
      push(participant.email);
    }

    if (parts.size === 0) {
      return null;
    }

    return Array.from(parts).join(' ');
  }

  private extractOneDriveFiles(content: RawData[]): OneDrivePageEntity[] {
    if (!content || typeof content !== 'object') {
      this.logger.warn('Invalid content type for OutlookCalendar events', {
        contentType: typeof content,
        contentNull: content === null,
      });

      return [];
    }

    let returned = [] as OneDrivePageEntity[];

    content.map((obj) => {
      const dataObj = obj.data as Record<string, unknown>;

      // Handle the structure from OutlookCalendar API - events array
      if (dataObj.files && Array.isArray(dataObj.files)) {
        this.logger.log('Extracting events from events array', {
          eventCount: dataObj.files.length,
        });

        returned = returned.concat(dataObj.files as OneDrivePageEntity[]);
      }

      if (returned.length === 0) {
        this.logger.warn('No files found in content', {
          contentKeys: Object.keys(dataObj),
        });
      }
    });

    return returned;
  }

  private async processOneDriveFile(
    file: OneDrivePageEntity,
    userId: string,
    connectionId: string,
  ): Promise<void> {
    // Extract event details
    const fileDetails = await this.extractFileDetails(file);

    this.logger.log('Processing OneDrive file', {
      eventId: fileDetails.id,
    });

    const participantEntityIds = await this.personService.processParticipants(
      fileDetails.participants,
      userId,
      connectionId,
      'drive',
      'EDITED_WITH',
    );

    if (fileDetails.content) {
      if (fileDetails.content['@microsoft.graph.downloadUrl']) {
        const downloadResponse = await fetch(fileDetails.content['@microsoft.graph.downloadUrl']);
        fileDetails.content.raw = await buffer(downloadResponse.body!);
      }

      const buff = fileDetails.content.raw ? fileDetails.content.raw : Buffer.from('');
      const fileHash = createHmac('sha256', config.auth.session.fieldPepper).update(buff).digest('hex');
      const file = {
        userId,
        mimeType: fileDetails.content.file?.mimeType,
        size: fileDetails.content.size,
        fileName: fileDetails.content.name,
        fileHash,
        buffer: buff,
      };

      const existingFiles = await this.fileService.search(
        { userId },
        {
          content_type: fileDetails.content.file?.mimeType,
          size: fileDetails.content.size,
          file_hash: fileHash,
          filename: fileDetails.content.name,
        },
      );

      if (existingFiles.length === 0) {
        await this.memoryService.createFile(file);
      }
    }

    const eventSearch = {
      start_time: new Date(fileDetails.startTime),
      title: 'Edited ' + fileDetails.content?.name,
      category: 'document_edit',
      source_system: 'Microsoft OneDrive',
      event_type: 'work',
      source_type: 'ETL',
    };

    const existingEvents = await this.eventService.search({ userId }, eventSearch);

    if (existingEvents.length === 0) {
      const newEvent = {
        id: uuidv7(),
        start_time: new Date(fileDetails.startTime),
        title: 'Edited ' + fileDetails.content?.name,
        user: {
          id: userId,
        },
        category: 'document_edit',
        source_system: 'Microsoft OneDrive',
        event_type: 'work',
        source_type: 'ETL',
        participant_entity_ids: participantEntityIds,
        metadata: {
          connection_id: connectionId,
        },
      } as CreateEventDto;

      const created = await this.eventService.create({ userId }, newEvent);
      const createdEvent = Array.isArray(created) ? created[0] : created;
      const searchContent = this.buildEventSearchContent(fileDetails, newEvent);
      await this.enqueueEventEmbedding(userId, createdEvent.id, searchContent);
    }
  }

  private async extractFileDetails(file: OneDrivePageEntity): Promise<ExtractedFile> {
    const { eTag, lastModifiedDateTime, createdBy, lastModifiedBy, content } = file;

    // Extract participants
    const participants: FileParticipant[] = [
      {
        name: createdBy.user.displayName,
        email: createdBy.user.email,
      },
      {
        name: lastModifiedBy.user.displayName,
        email: lastModifiedBy.user.email,
      },
    ];

    return {
      id: eTag || 'unknown',
      startTime: new Date(lastModifiedDateTime),
      participants,
      content,
    };
  }
}
