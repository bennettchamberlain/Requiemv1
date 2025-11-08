import { Readable } from 'node:stream';

import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v7 as uuidv7 } from 'uuid';

import { RequestContext } from '@ci/common/types';
import { EventPayloads, Events, OnEvent } from '@ci/domains/events';
import { FileService as FileStorageService, type File } from '@ci/domains/files';

import { FileEntity } from '../entities/FileEntity';

type FileUploadFields = {
  userId: string;
  fileId?: string;
  externalId?: string;
  fileName: string;
  mimeType: string;
  size: number;
  buffer?: Buffer;
};

@Injectable()
export class FileService {
  constructor(
    private readonly fileService: FileStorageService,
    @InjectRepository(FileEntity)
    private readonly fileRepository: Repository<FileEntity>,
  ) {}

  async create(context: RequestContext, data: FileUploadFields): Promise<{ file: File; entity: FileEntity }> {
    const { fileName, mimeType, size, buffer } = data;
    const file = {
      fieldname: 'attachment', //Multer requires this, but it's not actually used in our logic
      originalname: fileName, //Multer requires this, but it's not actually used in our logic
      mimetype: mimeType,
      size: size,
      encoding: 'base64',
      destination: '',
      stream: '' as unknown as Readable,
      filename: fileName,
      path: '',
      buffer: buffer || Buffer.from(''),
    };

    const newFile = await this.fileService.upload({ userId: context.userId }, file);

    const existingEntity = await this.fileRepository
      .createQueryBuilder('entity')
      .andWhere("entity.properties->>'fileId' = :fileId", { fileId: newFile.id })
      .getOne();

    let entity = !existingEntity
      ? await this.fileRepository.create({
          id: uuidv7(),
          name: fileName,
          entity_type: 'File',
          description: 'File',
          linked_table: 'files',
          linked_id: newFile.id,
          user: {
            id: context.userId,
          },
        })
      : existingEntity;

    entity = await this.fileRepository.save(entity);

    return { file: newFile, entity };
  }

  @OnEvent(Events.FILE_UPLOAD)
  async handleFileUploaded(payload: EventPayloads[Events.FILE_UPLOAD]) {
    const file = await this.fileService.findOne({ userId: payload.userId }, payload.fileId);

    const existingEntity = await this.fileRepository
      .createQueryBuilder('entity')
      .andWhere("entity.properties->>'fileId' = :fileId", { fileId: file.id })
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
