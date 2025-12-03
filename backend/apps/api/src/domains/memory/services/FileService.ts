import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v7 as uuidv7 } from 'uuid';

import { RequestContext } from '@ci/common/types';
import { OnEvent } from '@ci/domains/events';
import { FileService as FileStorageService } from '@ci/domains/files';
import { CreateFileDto } from '@ci/domains/memory/types';

import { FileEntity } from '../entities/FileEntity';
import {FileUploadedEvent, FileUploadedPayload} from "@ci/domains/files/events";

@Injectable()
export class FileService {
  constructor(
    private readonly fileService: FileStorageService,
    @InjectRepository(FileEntity)
    private readonly fileRepository: Repository<FileEntity>,
  ) {}

  async create(context: RequestContext, data: CreateFileDto): Promise<{ entity: FileEntity }> {
    const { name, linkedId } = data;

    const existingEntity = await this.fileRepository
      .createQueryBuilder('entity')
      .andWhere("entity.linked_table = 'files'")
      .andWhere('entity.linked_id = :linkedId', { linkedId })
      .getOne();

    let entity = !existingEntity
      ? await this.fileRepository.create({
          id: uuidv7(),
          name,
          entity_type: 'File',
          description: 'File',
          linked_table: 'files',
          linked_id: linkedId,
          user: {
            id: context.userId,
          },
        })
      : existingEntity;

    entity = await this.fileRepository.save(entity);

    return { entity };
  }

  @OnEvent(FileUploadedEvent)
  async handleFileUploaded(payload: FileUploadedPayload) {
    const file = await this.fileService.findOne({ userId: payload.userId }, payload.fileId);

    const existingEntity = await this.fileRepository
      .createQueryBuilder('entity')
      .andWhere("entity.linked_table = 'files'")
      .andWhere('entity.linked_id = :fileId', { fileId: file.id })
      .getOne();

    const entity = !existingEntity
      ? await this.fileRepository.create({
          id: uuidv7(),
          name: file.name,
          entity_type: 'File',
          description: 'File',
          linked_table: 'files',
          linked_id: file.id,
          user: {
            id: payload.userId,
          },
        })
      : existingEntity;

    await this.fileRepository.save(entity);
  }
}
