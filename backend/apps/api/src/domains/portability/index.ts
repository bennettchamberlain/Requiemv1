/**
 * User data export and import — portable archives for backup and Hub migration.
 *
 * @module PortabilityModule
 */

import { Module } from '@nestjs/common';

import { LoggingModule } from '@ci/common/logging';
import { FilesModule } from '@ci/domains/files';
import { UserModule } from '@ci/domains/user';

import { UserDataPortabilityService } from './services/UserDataPortabilityService';

@Module({
  imports: [LoggingModule, FilesModule, UserModule],
  providers: [UserDataPortabilityService],
  exports: [UserDataPortabilityService],
})
export class PortabilityModule {}

export { UserDataPortabilityService };
export type { UserDataArchive, ImportResult } from './types';
export {
  PORTABILITY_NDJSON_CONTENT_TYPE,
  isPortabilityNdjsonImport,
  serializePortabilityLine,
} from './portabilityNdjson';
