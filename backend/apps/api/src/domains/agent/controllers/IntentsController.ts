import { BadRequestException, Controller, Get, Param, NotFoundException, Query, UseGuards } from '@nestjs/common';

import { INTENTS_SCOPE, READ_CAPABILITY, RequireCapability, RequireScopes } from '@ci/common/decorators';
import { JwtOrApiKeyAuthGuard } from '@ci/common/guards';
import {
  DISPATCH_TIERS,
  IntentCatalogService,
  type CiEntityDescriptor,
  type DispatchTier,
  type IntentDomain,
  type IntentManifest,
  type ManifestIntent,
} from '@ci/domains/tools';

/**
 * Publishes the CI Intent catalog — the discoverable, typed capability declaration. Any agent
 * (CI-Hermes, CI-OpenClaw, an external MCP client) can read one catalog here instead of
 * re-implementing bespoke integration glue.
 *
 * Scope-limited connect keys need the `intents` scope to read it (CI-OpenClaw's
 * key carries it); session/JWT and empty-scope keys are unaffected.
 */
@UseGuards(JwtOrApiKeyAuthGuard)
@RequireScopes(INTENTS_SCOPE)
// The whole controller is reads — it publishes a catalog and changes nothing.
@RequireCapability(READ_CAPABILITY)
@Controller('api/intents')
export class IntentsController {
  constructor(private readonly catalog: IntentCatalogService) {}

  /**
   * The full manifest: domains + entities + intents.
   *
   * `?tier=local` additionally attaches this server's own dispatch ruling to each intent, which is
   * what the on-device tier should ask for — it reads `dispatch.decision` rather than shipping a
   * Kotlin and a Swift copy of the policy. Omitting `tier` returns the manifest unchanged.
   */
  @Get()
  getManifest(@Query('tier') tier?: string): IntentManifest {
    return this.catalog.getManifest({ tier: parseTier(tier) });
  }

  /** The standardized schema-domain vocabulary. */
  @Get('domains')
  getDomains(): { domains: IntentDomain[] } {
    return { domains: this.catalog.getDomains() };
  }

  /** The entity registry. */
  @Get('entities')
  getEntities(): { entities: CiEntityDescriptor[] } {
    return { entities: this.catalog.getEntities() };
  }

  /** A single intent by its dotted name, e.g. `memory.recall`. Honours `?tier=` as above. */
  @Get(':name')
  getIntent(@Param('name') name: string, @Query('tier') tier?: string): ManifestIntent {
    const manifest = this.catalog.getManifest({ tier: parseTier(tier) });
    const intent = manifest.intents.find((i) => i.name === name);

    if (!intent) {
      throw new NotFoundException(`Unknown intent: ${name}`);
    }

    return intent;
  }
}

/**
 * Validates the optional `tier` query param. Rejects an unrecognized value rather than ignoring it:
 * a client that asks for rulings and silently receives none would read every `dispatch` as
 * `undefined` and, depending on how it defaults, either refuse everything or run everything.
 */
function parseTier(tier: string | undefined): DispatchTier | undefined {
  if (tier == null || tier === '') {
    return undefined;
  }

  if (!(DISPATCH_TIERS as readonly string[]).includes(tier)) {
    throw new BadRequestException(`Unknown dispatch tier: ${tier}. Expected one of: ${DISPATCH_TIERS.join(', ')}`);
  }

  return tier as DispatchTier;
}
