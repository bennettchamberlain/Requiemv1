import { Module, OnModuleInit, Logger } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ModuleRef } from '@nestjs/core';

import { ConnectionEntity } from './entities/ConnectionEntity';
import { ConnectionsController } from './controllers/ConnectionsController';
import { OAuthCallbackController } from './controllers/OAuthCallbackController';
import { PublicTestController } from './controllers/PublicTestController';
import { ConnectionService } from './services/ConnectionService';

@Module({
  imports: [TypeOrmModule.forFeature([ConnectionEntity])],
  controllers: [ConnectionsController, OAuthCallbackController, PublicTestController],
  providers: [ConnectionService],
  exports: [ConnectionService],
})
export class ConnectionsModule implements OnModuleInit {
  private readonly logger = new Logger(ConnectionsModule.name);

  constructor(private moduleRef: ModuleRef) {}

  onModuleInit() {
    this.logger.log('********** ConnectionsModule initialized **********');
    this.logger.log('Registered routes should include /connections/callback');
  }
}
