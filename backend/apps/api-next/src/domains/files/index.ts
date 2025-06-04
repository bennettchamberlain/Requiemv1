import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { FilesController } from './controllers/FilesController';
import { FileEntity } from './entities/FileEntity';
import { FileService } from './services/FileService';

@Module({
  imports: [TypeOrmModule.forFeature([FileEntity])],
  providers: [FileService],
  controllers: [FilesController],
  exports: [],
})
export class FilesModule {}

// Entities
export { FileEntity };

// Services
export { FileService };

// Types
export type { File, FileUploadDto } from './types';
