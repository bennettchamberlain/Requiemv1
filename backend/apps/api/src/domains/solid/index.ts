/**
 * Solid Protocol facade (Path B: an adapter over the existing store).
 *
 * This module projects CI-Server's existing data as a Solid-compatible surface
 * without changing the Postgres source of truth. It is intentionally
 * self-contained — it only *reads* other domains (currently `UserService`) — so
 * it can grow the Solid pillars (WebID → Solid-OIDC → LDP resources → RDF
 * projection → WAC) with minimal blast radius on the rest of the API.
 *
 * The entire surface is gated behind the `solid.protocol` feature flag (off by
 * default), so merging incremental slices to main is safe.
 *
 * Slice 1 (this commit): WebID Profile Documents at `GET /solid/profile/:userId`
 * with Turtle/JSON-LD content negotiation.
 *
 * @module SolidModule
 */

import { Module } from '@nestjs/common';

import { UserModule } from '@ci/domains/user';

import { WebIdController } from './controllers/WebIdController';
import { ProfileDocumentService } from './services/ProfileDocumentService';
import { WebIdService } from './services/WebIdService';

/**
 * @internal
 */
@Module({
  imports: [UserModule],
  controllers: [WebIdController],
  providers: [WebIdService, ProfileDocumentService],
  exports: [WebIdService, ProfileDocumentService],
})
export class SolidModule {}

export { WebIdService } from './services/WebIdService';
export { ProfileDocumentService } from './services/ProfileDocumentService';
