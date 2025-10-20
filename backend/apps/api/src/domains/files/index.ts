/**
 * Manages file uploads, storage, and retrieval. This module provides the necessary
 * services and controllers to handle file-related operations, persisting file
 * metadata in the database and storing the actual files in an object storage service.
 *
 * ### Key Components:
 * - **FileService**: Contains the core business logic for uploading, downloading,
 *   and managing file metadata.
 * - **FilesController**: Exposes REST API endpoints for client-side file interactions.
 * - **FileEntity**: The TypeORM entity representing file metadata stored in the database.
 * - **Event Integration**: Integrates with the `EventsModule` to publish or handle
 *   events related to file activities, such as post-upload processing.
 *
 * @module FilesModule
 */

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { EventsModule } from '@ci/domains/events';

import { FilesController } from './controllers/FilesController';
import { FileEntity } from './entities/FileEntity';
import { FileService } from './services/FileService';

/**
 * @internal
 */
@Module({
  imports: [TypeOrmModule.forFeature([FileEntity]), EventsModule],
  providers: [FileService],
  controllers: [FilesController],
  exports: [FileService],
})
export class FilesModule {}

// Entities
export { FileEntity };

// Services
export { FileService };

// Types
export type { File } from './types';
