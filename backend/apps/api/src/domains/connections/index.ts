import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ConnectionsController } from './controllers/ConnectionsController';
import { ConnectionEntity } from './entities/ConnectionEntity';
import { ConnectionService } from './services/ConnectionService';
import { ApiProviderFactory } from './providers';

@Module({
  imports: [TypeOrmModule.forFeature([ConnectionEntity])],
  providers: [ConnectionService, ApiProviderFactory],
  controllers: [ConnectionsController],
  exports: [ConnectionService],
})
export class ConnectionsModule {}

// Entities
export { ConnectionEntity };

// Services
export { ConnectionService };

// Types
export type { CreateConnectionDto, Connection, UpdateConnectionDto } from './types';
