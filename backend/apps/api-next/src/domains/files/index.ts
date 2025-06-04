import { Module } from '@nestjs/common';

import { FilesController } from './controllers/FilesController';
import { FileService } from './services/FileService';

@Module({
  imports: [],
  providers: [FileService],
  controllers: [FilesController],
  exports: [],
})
export class FilesModule {}

// Entities
export {};

// Services
export {};

// Types
export type { FileUploadDto } from './types';
