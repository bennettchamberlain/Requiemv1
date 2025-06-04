import { Module } from '@nestjs/common';

import { FilesController } from './controllers/FilesController';

@Module({
  imports: [],
  providers: [],
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
