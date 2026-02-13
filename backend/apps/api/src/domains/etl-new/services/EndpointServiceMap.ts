import { Injectable } from '@nestjs/common';
import { syncGmail } from "../services/Google/SyncGmail";
import {LoggerService} from "@ci/common/logging";

import { BaseClient } from "@ci/domains/connections/clients/BaseClient";
import {Connection} from "@ci/domains/connections";

const ENDPOINT_SERVICE_MAP: {
  [providerName: string]: {
    [endpointName: string]: ({ connection, client, nextCursor, historical }: { connection: Connection, client: BaseClient, nextCursor: Record<string, unknown>, historical: boolean }) => Promise<{ data: Record<string, unknown>; nextCursor?: Record<string, unknown> }>;
  };
} = {
  Google: {
    Gmail: syncGmail,
  }
}

@Injectable()
export class EndpointServiceMap {
  constructor(
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(EndpointServiceMap.name);
  }

  getSyncFunction(providerName: string, endpointName: string) {
    return ENDPOINT_SERVICE_MAP[providerName]?.[endpointName];
  }
}
