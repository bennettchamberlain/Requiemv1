import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v7 as uuidv7 } from 'uuid';

import { LoggerService } from '@ci/common/logging';

import { FileChunkEntity, type FileChunk } from '../entities/FileChunkEntity';
import { type CreateChunkDto } from '../types';

@Injectable()
export class DocumentChunkService {
  constructor(
    @InjectRepository(FileChunkEntity)
    private readonly chunkRepository: Repository<FileChunkEntity>,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(DocumentChunkService.name);
  }

  async createMany(chunks: CreateChunkDto[]): Promise<FileChunk[]> {
    if (chunks.length === 0) {
      return [];
    }

    const entities = chunks.map((chunk) =>
      this.chunkRepository.create({
        id: uuidv7(),
        fileId: chunk.fileId,
        userId: chunk.userId,
        chunkIndex: chunk.chunkIndex,
        content: chunk.content,
        sectionTitle: chunk.sectionTitle,
        sourceLocator: chunk.sourceLocator,
        parserName: chunk.parserName,
        parserVersion: chunk.parserVersion,
        chunkerVersion: chunk.chunkerVersion,
      }),
    );

    const saved = await this.chunkRepository.save(entities);

    this.logger.log('Persisted document chunks', { count: saved.length });

    return saved;
  }

  async deleteByFileId(fileId: string): Promise<void> {
    await this.chunkRepository.delete({ fileId });
  }

  async findByFileId(fileId: string): Promise<FileChunk[]> {
    return this.chunkRepository.find({
      where: { fileId },
      order: { chunkIndex: 'ASC' },
    });
  }

  async findByIds(ids: string[]): Promise<FileChunk[]> {
    if (ids.length === 0) {
      return [];
    }

    return this.chunkRepository.find({
      where: ids.map((id) => ({ id })),
      order: { chunkIndex: 'ASC' },
    });
  }
}
