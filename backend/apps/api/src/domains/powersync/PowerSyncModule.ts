import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

import { PowerSyncController } from './controllers/PowerSyncController';
import { PowerSyncTokenService } from './services/PowerSyncTokenService';

/**
 * Issues short-lived PowerSync auth tokens for the local-first sync engine. The
 * actual sync (Postgres logical replication → PowerSync service → on-device SQLite)
 * runs in the `powersync` container; see infrastructure/powersync/.
 */
@Module({
  // Empty JwtModule registration: tokens are signed with an explicit per-call
  // secret (the PowerSync secret), not the module-default auth secret.
  imports: [JwtModule.register({})],
  controllers: [PowerSyncController],
  providers: [PowerSyncTokenService],
})
export class PowerSyncModule {}
