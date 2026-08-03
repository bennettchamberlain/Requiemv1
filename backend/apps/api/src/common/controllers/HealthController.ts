import { Controller, Get, HttpCode } from '@nestjs/common';

import config from '@ci/configuration';

@Controller('health')
export class HealthController {
  @Get()
  @HttpCode(200)
  check() {
    return {
      status: 'ok',
      // Whether this server accepts CI-Portal OIDC tokens. Capture clients
      // (the browser extension, the applet, the importer) authenticate ONLY
      // with a portal token, so when this is false every one of their requests
      // 401s — and the guard cannot say why, because a rejected token is
      // indistinguishable from an absent one. Surfacing it here turns a silent
      // total failure into something a client can check and report.
      portalAuthEnabled: config.auth.portal.enabled === true,
    };
  }
}
