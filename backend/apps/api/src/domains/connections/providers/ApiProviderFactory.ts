import { Injectable } from '@nestjs/common';
import config from '@ci/configuration';
import { GoogleApiProvider } from './GoogleApiProvider';
import { MicrosoftApiProvider } from './MicrosoftApiProvider';
import type { ApiProvider } from './types';

@Injectable()
export class ApiProviderFactory {
  private readonly providers = new Map<string, ApiProvider>();

  constructor() {
    // Register providers by provider ID from configuration
    this.providers.set(config.providers.google.id, new GoogleApiProvider());
    this.providers.set(config.providers.microsoft.id, new MicrosoftApiProvider());
  }

  getProvider(providerId: string): ApiProvider {
    const provider = this.providers.get(providerId);
    if (!provider) {
      throw new Error(`Unsupported provider ID: ${providerId}`);
    }
    return provider;
  }

  hasProvider(providerId: string): boolean {
    return this.providers.has(providerId);
  }
}
