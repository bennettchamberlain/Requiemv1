/**
 * Peer federation — two Companion Memory boxes exchanging asks.
 *
 * Discovery is CI-Portal's job (handle → endpoint + issuer); the relationship,
 * the consent policy, and every answer stay on the two boxes involved, so the
 * cloud plane never accumulates the social graph. See `protocol.ts` for the
 * wire contract and `docs/peer-federation.md` for the end-to-end flow.
 */
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AsksModule } from '@ci/domains/asks';
import { AuthModule } from '@ci/domains/auth';
import { MemoryModule, EventEntity } from '@ci/domains/memory';

import { PeerAskController } from './controllers/PeerAskController';
import { PeerLinkEntity } from './entities/PeerLinkEntity';
import { PeerAskClient } from './services/PeerAskClient';
import { PeerAskService } from './services/PeerAskService';
import { PeerDirectoryService } from './services/PeerDirectoryService';
import { PeerLinkService } from './services/PeerLinkService';

@Module({
  imports: [TypeOrmModule.forFeature([PeerLinkEntity, EventEntity]), AsksModule, AuthModule, MemoryModule],
  controllers: [PeerAskController],
  providers: [PeerLinkService, PeerDirectoryService, PeerAskClient, PeerAskService],
  exports: [PeerLinkService, PeerDirectoryService, PeerAskClient, PeerAskService],
})
export class PeersModule {}

export { PeerLinkEntity };
export { PeerLinkService, PeerDirectoryService, PeerAskClient, PeerAskService };
export { computeFreeBusy, summarizeAvailability } from './availability';
export { PEER_ASK_ARCHETYPES, peerAskBodySchema } from './protocol';
export type { PeerLink, PeerTrustTier, PeerLinkStatus } from './entities/PeerLinkEntity';
export type {
  PeerAskArchetype,
  PeerAskBody,
  PeerAskResponse,
  PeerDescriptor,
  BusyInterval,
} from './protocol';
