import { Body, Controller, Post, UseGuards } from '@nestjs/common';

import { Context, type RequestContext, toServiceContext } from '@ci/common/context';
import { JwtOrApiKeyAuthGuard } from '@ci/common/guards';
import { ValidationPipe } from '@ci/common/pipes';
import { BrowserActivityService } from '@ci/domains/browser-activity';
import {
  CommunicationService,
  CommunicationType,
  ContentService,
  ItemService,
  type CreateCommunicationDto,
} from '@ci/domains/memory';
import { PositionService } from '@ci/domains/position';

import {
  type BulkIngestResponse,
  type IngestBrowserActivityRequest,
  type IngestCommunicationsRequest,
  type IngestContentsRequest,
  type IngestInventoryRequest,
  type IngestPositionsRequest,
  ingestBrowserActivitySchema,
  ingestCommunicationsSchema,
  ingestContentsSchema,
  ingestInventorySchema,
  ingestPositionsSchema,
} from '../types';

/**
 * REST bulk-ingest plane: `/v1/*` batch endpoints for every bulk kind the
 * set-based ingest services support, so a machine client (importer, capture
 * device, migration script) can drive a full bulk load over plain REST without
 * touching GraphQL. Mirrors `POST /v1/events` (EventsIngestController): same
 * auth (JwtOrApiKeyAuthGuard), same batch envelope style, same response shape.
 *
 * All five routes delegate to the EXISTING chunk-safe bulk services
 * (CommunicationService.createMany, ContentService.createMany,
 * ItemService.createMany, BrowserActivityService.createMany,
 * PositionService.create) — idempotent on the provenance triple
 * (source_type, source_system, source_id) via INSERT … ON CONFLICT, internally
 * chunked under the 65535 bind-param limit, and `emitCreated: false`
 * throughout: no per-row *CreatedEvent fan-out, so search indexing and
 * enrichment are DEFERRED until the client calls `POST /v1/ingest/finish`
 * (see IngestLifecycleController). Up to 10,000 records per request; the 10mb
 * `/v1/*` body limit lives in BodyParserMiddleware.
 */
@Controller('v1')
export class BulkIngestController {
  constructor(
    private readonly communicationService: CommunicationService,
    private readonly contentService: ContentService,
    private readonly itemService: ItemService,
    private readonly browserActivityService: BrowserActivityService,
    private readonly positionService: PositionService,
  ) {}

  @UseGuards(JwtOrApiKeyAuthGuard)
  @Post('communications')
  async ingestCommunications(
    @Context() context: RequestContext,
    @Body(new ValidationPipe(ingestCommunicationsSchema)) body: IngestCommunicationsRequest,
  ): Promise<BulkIngestResponse> {
    const serviceContext = toServiceContext(context);

    const rows = await this.communicationService.createMany(
      serviceContext,
      body.records.map(
        (record): CreateCommunicationDto => ({
          ...record,
          // The zod enum vocabulary IS the CommunicationType value set; the
          // cast bridges string-literal union → TS enum (same as the GraphQL
          // createCommunications resolver).
          communication_type: record.communication_type as CommunicationType,
          time: new Date(record.time),
          // Stored verbatim; default to 'inbound' when omitted — mirrors the
          // GraphQL createCommunications resolver.
          direction: record.direction ?? 'inbound',
        }),
      ),
    );

    return toBulkResponse(body.records.length, rows.length);
  }

  @UseGuards(JwtOrApiKeyAuthGuard)
  @Post('contents')
  async ingestContents(
    @Context() context: RequestContext,
    @Body(new ValidationPipe(ingestContentsSchema)) body: IngestContentsRequest,
  ): Promise<BulkIngestResponse> {
    const serviceContext = toServiceContext(context);

    const rows = await this.contentService.createMany(
      serviceContext,
      body.records.map(({ event_id, ...record }) => ({
        ...record,
        // ContentEntity carries the event FK only via the relation, so a flat
        // event_id maps to `event: { id }` (same as the GraphQL resolver). An
        // explicit event wins; otherwise rows auto-link by provenance triple.
        event: event_id ? { id: event_id } : undefined,
      })),
      // Bulk default anyway; explicit for symmetry with the deferred-indexing
      // contract (index via POST /v1/ingest/finish).
      { emitCreated: false },
    );

    return toBulkResponse(body.records.length, rows.length);
  }

  @UseGuards(JwtOrApiKeyAuthGuard)
  @Post('inventory')
  async ingestInventory(
    @Context() context: RequestContext,
    @Body(new ValidationPipe(ingestInventorySchema)) body: IngestInventoryRequest,
  ): Promise<BulkIngestResponse> {
    const serviceContext = toServiceContext(context);

    const rows = await this.itemService.createMany(
      serviceContext,
      body.records.map((record) => ({
        ...record,
        acquiredAt: record.acquiredAt !== undefined ? new Date(record.acquiredAt) : undefined,
      })),
    );

    return toBulkResponse(body.records.length, rows.length);
  }

  @UseGuards(JwtOrApiKeyAuthGuard)
  @Post('browser-activity')
  async ingestBrowserActivity(
    @Context() context: RequestContext,
    @Body(new ValidationPipe(ingestBrowserActivitySchema)) body: IngestBrowserActivityRequest,
  ): Promise<BulkIngestResponse> {
    const serviceContext = toServiceContext(context);

    // CreateBrowserActivityDto keeps `time` as an ISO string (the service does
    // its own new Date(...)), so the parsed records pass through unchanged.
    const rows = await this.browserActivityService.createMany(serviceContext, body.records);

    return toBulkResponse(body.records.length, rows.length);
  }

  @UseGuards(JwtOrApiKeyAuthGuard)
  @Post('positions')
  async ingestPositions(
    @Context() context: RequestContext,
    @Body(new ValidationPipe(ingestPositionsSchema)) body: IngestPositionsRequest,
  ): Promise<BulkIngestResponse> {
    const serviceContext = toServiceContext(context);

    // Same bulk path POST /position uses; CreatePositionDto keeps `time` as an
    // ISO string. PositionService collapses intra-batch same-time records and
    // returns existing + created rows, so `duplicate` here counts the in-batch
    // time collisions.
    const rows = await this.positionService.create(serviceContext, body.records);

    return toBulkResponse(body.records.length, rows.length);
  }
}

/**
 * Shared response derivation (see {@link BulkIngestResponse} for the exact
 * duplicate-counting contract): the services return one row per ACCEPTED record
 * — created now or found pre-existing — and silently collapse intra-request
 * duplicates (same provenance triple / same position time), so the collapsed
 * remainder is reported as `duplicate`. Whole-batch failures surface as HTTP
 * errors, so a 200 always has an empty `rejected`.
 */
function toBulkResponse(received: number, accepted: number): BulkIngestResponse {
  return {
    ingested: accepted,
    duplicate: Math.max(0, received - accepted),
    rejected: [],
  };
}
