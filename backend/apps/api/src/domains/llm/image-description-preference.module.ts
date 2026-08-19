import { Module } from '@nestjs/common';

import { EventsModule } from '@ci/domains/events';
import { MemoryModule } from '@ci/domains/memory';

import { ImageDescriptionPreferenceService } from './services/ImageDescriptionPreferenceService';

/**
 * Tiny module so vision listeners and Settings can share the describe-images
 * preference without LLMModule ↔ PersonalizationModule circular imports.
 */
@Module({
  imports: [MemoryModule, EventsModule],
  providers: [ImageDescriptionPreferenceService],
  exports: [ImageDescriptionPreferenceService],
})
export class ImageDescriptionPreferenceModule {}

export { ImageDescriptionPreferenceService } from './services/ImageDescriptionPreferenceService';
