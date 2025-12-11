/**
 * This module is executing search queries against the Companion Intelligence
 * search index and for manipulating entity tags.
 *
 * @module SearchNextModule
 */

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { type EntityTag, EntityTagEntity } from './entities/EntityTagEntity';
import { type Tag, TagEntity } from './entities/TagEntity';

/**
 * @internal
 */
@Module({
  imports: [TypeOrmModule.forFeature([TagEntity, EntityTagEntity])],
})
export class SearchNextModule {}

export type { Tag, EntityTag };
