import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { FilesModule } from '@ci/domains/files';
import { LLMModule } from '@ci/domains/llm';
import { ItemEntity, MemoryModule } from '@ci/domains/memory';
import { PositionModule } from '@ci/domains/position';

import { InventoryListener } from './listeners/InventoryListener';

@Module({
  imports: [FilesModule, LLMModule, MemoryModule, PositionModule, TypeOrmModule.forFeature([ItemEntity])],
  providers: [InventoryListener],
  exports: [],
})
export class InventoryModule {}
