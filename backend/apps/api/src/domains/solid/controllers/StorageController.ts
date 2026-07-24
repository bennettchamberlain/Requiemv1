import { Controller, Get, NotFoundException, Param, Req, Res, UseGuards } from '@nestjs/common';
import { Request, Response } from 'express';

import { Context, type RequestContext, toServiceContext } from '@ci/common/context';
import { FeatureService } from '@ci/common/feature';
import { JwtOrApiKeyAuthGuard } from '@ci/common/guards';
import { GraphQueryService } from '@ci/domains/memory';

import { negotiateRdf } from '../rdf';
import { EntityProjectionService } from '../services/EntityProjectionService';
import { WebIdService } from '../services/WebIdService';

import { requestOrigin } from './requestOrigin';

/**
 * Serves the user's pod: RDF resources projected from their private data.
 * Currently a single entity resource at
 * `GET /solid/storage/:userId/entity/:entityId`, content-negotiated between
 * Turtle and JSON-LD.
 *
 * Unlike the public WebID profile, pod contents are PRIVATE, so this surface
 * is authenticated (`JwtOrApiKeyAuthGuard`) and **owner-only**: the caller may
 * read only their own pod. That owner check is the facade's WAC-lite stand-in
 * until real per-resource ACLs land — a mismatch (or a missing entity) both
 * return 404 so the endpoint never reveals whether another user's resource
 * exists. Everything is additionally gated behind the `solid.protocol` flag.
 */
@Controller('solid/storage')
@UseGuards(JwtOrApiKeyAuthGuard)
export class StorageController {
  constructor(
    private readonly features: FeatureService,
    private readonly graph: GraphQueryService,
    private readonly webIds: WebIdService,
    private readonly projection: EntityProjectionService,
  ) {}

  @Get(':userId/entity/:entityId')
  async getEntity(
    @Param('userId') userId: string,
    @Param('entityId') entityId: string,
    @Context() context: RequestContext,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    if (!(await this.features.isFeatureEnabled('solid.protocol'))) {
      throw new NotFoundException();
    }

    // Owner-only: the authenticated principal may read only their own pod.
    // 404 (not 403) so a foreign pod path is indistinguishable from an absent
    // one — no cross-user existence leak.
    const { userId: authUserId } = toServiceContext(context);
    if (authUserId !== userId) {
      throw new NotFoundException();
    }

    const node = await this.graph.getNode(authUserId, entityId);
    if (!node) {
      throw new NotFoundException();
    }

    // Outbound edges of this entity, already owner-scoped by the query.
    const relationships = await this.graph.getRelationships(authUserId, {
      entityIds: [entityId],
      direction: 'outbound',
    });

    const origin = this.webIds.resolveOrigin(requestOrigin(req));
    const quads = this.projection.build(node, relationships, origin, authUserId);
    const serialization = negotiateRdf(req.headers.accept);

    res.type(serialization.mediaType).send(serialization.serialize(quads));
  }
}
