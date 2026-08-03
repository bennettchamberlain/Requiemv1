import { Controller, Get, HttpCode, UseGuards } from '@nestjs/common';

import { JwtOrApiKeyAuthGuard } from '@ci/common/guards';
import config from '@ci/configuration';

/**
 * Runtime Google Maps config for the Memory web UI.
 *
 * Hub injects `GOOGLE_MAPS_KEY` / `GEOCODING_API_KEY` into the api container
 * from Portal's wrangler secret. The frontend must not rely on build-time
 * `VITE_GOOGLE_MAPS_API_KEY` (baked into gateway images). This endpoint
 * exposes the same key for Maps JS / Directions after the user authenticates.
 */
@Controller('config')
export class MapsConfigController {
  @UseGuards(JwtOrApiKeyAuthGuard)
  @Get('maps')
  @HttpCode(200)
  maps() {
    const apiKey = (config.geocoding.apiKey ?? '').trim();

    if (!apiKey) {
      return { configured: false as const };
    }

    return {
      configured: true as const,
      apiKey,
    };
  }
}
