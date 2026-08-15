import { Injectable } from '@nestjs/common';

import { type ServiceContext } from '@ci/common/context';
import { LoggerService } from '@ci/common/logging';
import { ApiKeyService } from '@ci/domains/auth';
import { CloudOAuthProxyService, type PortalDeviceApplication } from '@ci/domains/connections';

export type AgentHarnessId = 'hermes' | 'openclaw';

export interface AgentHarnessStatus {
  id: AgentHarnessId;
  name: string;
  /** Hub connect flow minted a memory key for this agent app. */
  connectedToMemory: boolean;
  /** Portal listed the app with a browser-reachable URL. */
  installed: boolean;
  /** HTTP probe against {@link openUrl} succeeded (when probed). */
  running: boolean;
  openUrl: string | null;
  /** Ready to open from Memory — installed with a resolvable open URL. */
  accessible: boolean;
}

interface AgentHarnessDefinition {
  id: AgentHarnessId;
  name: string;
  appNames: string[];
  connectKeyPrefix: string;
}

const AGENT_HARNESSES: AgentHarnessDefinition[] = [
  {
    id: 'hermes',
    name: 'Hermes',
    appNames: ['ci-hermes'],
    connectKeyPrefix: 'app:ci-hermes:',
  },
  {
    id: 'openclaw',
    name: 'OpenClaw',
    appNames: ['ci-openclaw'],
    connectKeyPrefix: 'app:ci-openclaw:',
  },
];

const PROBE_TIMEOUT_MS = 3_000;

@Injectable()
export class AgentHarnessService {
  constructor(
    private readonly apiKeyService: ApiKeyService,
    private readonly cloudOAuthProxyService: CloudOAuthProxyService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(AgentHarnessService.name);
  }

  async getHarnesses(context: ServiceContext): Promise<AgentHarnessStatus[]> {
    const [keys, portalApps] = await Promise.all([
      this.apiKeyService.findAllByUser(context),
      this.cloudOAuthProxyService.getDeviceApplications(),
    ]);

    const statuses = AGENT_HARNESSES.map((definition) =>
      this.buildHarnessStatus(definition, keys, portalApps),
    );

    await Promise.all(
      statuses.map(async (status) => {
        if (!status.openUrl) {
          return;
        }

        status.running = await this.probeOpenUrl(status.openUrl);
        status.accessible = status.running;
      }),
    );

    return statuses;
  }

  private buildHarnessStatus(
    definition: AgentHarnessDefinition,
    keys: Awaited<ReturnType<ApiKeyService['findAllByUser']>>,
    portalApps: PortalDeviceApplication[],
  ): AgentHarnessStatus {
    const connectedToMemory = keys.some(
      (key) => key.managed_by === 'connect' && key.name.startsWith(definition.connectKeyPrefix),
    );

    const portalApp = portalApps.find((app) => definition.appNames.includes(app.name));
    const openUrl = portalApp ? resolvePortalOpenUrl(portalApp) : null;

    return {
      id: definition.id,
      name: definition.name,
      connectedToMemory,
      installed: portalApp != null,
      running: false,
      openUrl,
      accessible: false,
    };
  }

  private async probeOpenUrl(url: string): Promise<boolean> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
        signal: controller.signal,
      });

      return response.ok || (response.status >= 300 && response.status < 400);
    } catch (error) {
      this.logger.debug('Agent harness probe failed', {
        url,
        error: error instanceof Error ? error.message : String(error),
      });

      return false;
    } finally {
      clearTimeout(timeout);
    }
  }
}

function resolvePortalOpenUrl(app: PortalDeviceApplication): string | null {
  const fromPortal = app.openUrl?.trim();

  if (fromPortal) {
    return fromPortal.replace(/\/$/, '');
  }

  return buildLegacyPortalOpenUrl(app);
}

/** Fallback for Portals predating the `openUrl` field on device applications. */
function buildLegacyPortalOpenUrl(app: PortalDeviceApplication): string | null {
  const domain = app.publicDomain?.trim();

  if (!domain) {
    return null;
  }

  if (domain.startsWith('http://') || domain.startsWith('https://')) {
    return domain.replace(/\/$/, '');
  }

  return `https://${domain.replace(/\/$/, '')}`;
}
